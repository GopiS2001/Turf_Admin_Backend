import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { randomBytes } from 'node:crypto';
import {
  Brackets,
  DataSource,
  EntityManager,
  QueryFailedError,
  Repository,
  SelectQueryBuilder,
} from 'typeorm';
import { paginate } from '../common/dto/pagination.dto';
import {
  BookingStatus,
  DateRange,
  InvoiceStatus,
  PaymentKind,
  PaymentStatus,
} from '../common/enums';
import { money } from '../common/utils/decimal.transformer';
import {
  BOOKING_WINDOW_DAYS,
  CLOSE_HOUR,
  OPEN_HOUR,
  addDays,
  minutesToLabel,
  minutesToTime,
  nowMinutes,
  rangeBounds,
  timeToMinutes,
  toISODate,
} from '../common/utils/time';
import { Invoice } from '../invoices/invoice.entity';
import { Payment } from '../payments/payment.entity';
import {
  calculatePrice,
  planCodeFor,
  PriceBreakdown,
} from '../pricing/pricing.calc';
import { PricingService } from '../pricing/pricing.service';
import {
  BOOKING_CREATED,
  BOOKING_PAID,
  type BookingEvent,
} from '../notifications/events';
import { User } from '../users/user.entity';
import { Booking } from './booking.entity';
import {
  bookingCode,
  deriveStatus,
  invoiceCode,
  isValidISODate,
  nextSequence,
  overlaps,
  summarizeLedger,
  validateWindow,
} from './booking.rules';
import {
  BookingCountsQueryDto,
  CreateBookingDto,
  ListBookingsQueryDto,
  PaymentInputDto,
  UpdateBookingDto,
} from './dto/booking.dto';

type Source = Booking['source'];

interface BookingInput extends Omit<CreateBookingDto, 'additionalGuests'> {
  additionalGuests?: number;
  /** Total players (website); used when additionalGuests isn't given. */
  guests?: number;
}

const PRICE_FIELDS = [
  'bookingDate',
  'timeIn',
  'timeOut',
  'additionalGuests',
  'pricePerHour',
  'maxGuests',
  'pricePerGuest',
] as const;

const RETRYABLE = new Set([
  'ER_DUP_ENTRY',
  'ER_LOCK_DEADLOCK',
  'ER_LOCK_WAIT_TIMEOUT',
]);

@Injectable()
export class BookingsService {
  private readonly logger = new Logger(BookingsService.name);

  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    private readonly pricing: PricingService,
    private readonly events: EventEmitter2,
  ) {}

  // ───────────────────────────── Reads ─────────────────────────────

  async list(query: ListBookingsQueryDto) {
    await this.syncStatuses();
    const qb = this.bookings
      .createQueryBuilder('b')
      .leftJoinAndSelect('b.invoice', 'invoice');
    this.applyFilters(qb, query);
    if (query.status)
      qb.andWhere('b.status = :status', { status: query.status });

    const upcomingFirst =
      query.status === BookingStatus.UPCOMING ||
      query.status === BookingStatus.ONGOING;
    const dir = (
      query.sort ?? (upcomingFirst ? 'asc' : 'desc')
    ).toUpperCase() as 'ASC' | 'DESC';
    qb.orderBy('b.bookingDate', dir)
      .addOrderBy('b.timeIn', dir)
      .addOrderBy('b.id', dir);

    const [data, total] = await qb
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return paginate(data, total, query.page, query.limit);
  }

  /** Booking counts per status tab for the same filters. */
  async counts(query: BookingCountsQueryDto) {
    await this.syncStatuses();
    const qb = this.bookings
      .createQueryBuilder('b')
      .select('b.status', 'status')
      .addSelect('COUNT(*)', 'count');
    this.applyFilters(qb, query);
    const rows = await qb
      .groupBy('b.status')
      .getRawMany<{ status: BookingStatus; count: string }>();

    const counts = Object.fromEntries(
      Object.values(BookingStatus).map((s) => [s, 0]),
    ) as Record<BookingStatus, number>;
    for (const r of rows) counts[r.status] = Number(r.count);
    return { ...counts, ALL: Object.values(counts).reduce((a, b) => a + b, 0) };
  }

  async findOne(id: number) {
    const booking = await this.bookings.findOne({
      where: { id },
      relations: { invoice: true, payments: true, user: true },
      order: { payments: { paidAt: 'ASC' } },
    });
    if (!booking) throw new NotFoundException('Booking not found');
    return booking;
  }

  /** Hourly availability for the website slot grid. */
  async slots(date: string) {
    if (!isValidISODate(date))
      throw new BadRequestException('date must be a valid YYYY-MM-DD date');
    const plans = await this.pricing.findAll();
    const taken = await this.bookings
      .createQueryBuilder('b')
      .where('b.bookingDate = :date', { date })
      .andWhere('b.status != :cancelled', {
        cancelled: BookingStatus.CANCELLED,
      })
      .getMany();

    const now = new Date();
    const today = toISODate(now);
    const currentMin = nowMinutes(now);

    const slots = [];
    for (let hour = OPEN_HOUR; hour < CLOSE_HOUR; hour++) {
      const start = hour * 60;
      const planId = planCodeFor(date, start);
      const plan = plans.find((p) => p.code === planId);
      const isPast =
        date < today ||
        (date === today && start <= currentMin - (currentMin % 60));
      const isBooked = taken.some((b) =>
        overlaps(
          start,
          start + 60,
          timeToMinutes(b.timeIn),
          timeToMinutes(b.timeOut),
        ),
      );
      slots.push({
        hour,
        status: isPast ? 'past' : isBooked ? 'booked' : 'available',
        planId,
        price: plan?.pricePerHour ?? 0,
      });
    }
    return slots;
  }

  // ──────────────────────────── Writes ────────────────────────────

  async create(dto: CreateBookingDto, source: Source = 'ADMIN') {
    const booking = await this.createInternal(dto, source);
    return this.findOne(booking.id);
  }

  /** Website booking: whole hours, today .. +13 days, priced from total guests. */
  async createFromWebsite(req: {
    date: string;
    startHour: number;
    hours: number;
    guests: number;
    name: string;
    phone: string;
    email?: string;
    notes?: string;
  }) {
    if (!isValidISODate(req.date))
      throw new BadRequestException('date must be a valid YYYY-MM-DD date');
    const now = new Date();
    const today = toISODate(now);
    const lastDay = toISODate(addDays(now, BOOKING_WINDOW_DAYS - 1));
    if (req.date < today || req.date > lastDay) {
      throw new BadRequestException(
        `Online bookings are open for the next ${BOOKING_WINDOW_DAYS} days`,
      );
    }
    if (req.date === today && req.startHour * 60 <= nowMinutes(now)) {
      throw new BadRequestException(
        'That time has already started. Please pick a later slot.',
      );
    }

    const userId = req.email
      ? ((
          await this.dataSource
            .getRepository(User)
            .findOneBy({ email: req.email.toLowerCase() })
        )?.id ?? undefined)
      : undefined;

    const booking = await this.createInternal(
      {
        userId,
        customerName: req.name,
        customerPhone: req.phone,
        customerEmail: req.email,
        bookingDate: req.date,
        timeIn: minutesToTime(req.startHour * 60).slice(0, 5),
        timeOut: minutesToTime((req.startHour + req.hours) * 60).slice(0, 5),
        guests: req.guests,
        notes: req.notes,
      },
      'WEBSITE',
    );

    return {
      bookingId: booking.id,
      bookingCode: booking.bookingCode,
      date: booking.bookingDate,
      timeIn: minutesToLabel(timeToMinutes(booking.timeIn)),
      timeOut: minutesToLabel(timeToMinutes(booking.timeOut)),
      totalHours: booking.totalHours,
      turfAmount: booking.turfAmount,
      additionalGuests: booking.additionalGuests,
      additionalGuestAmount: booking.additionalGuestAmount,
      totalAmount: booking.totalAmount,
      customerName: booking.customerName,
    };
  }

  async update(id: number, dto: UpdateBookingDto) {
    const existing = await this.findOne(id);
    const changesPrice = PRICE_FIELDS.some((f) => dto[f] !== undefined);
    if (
      existing.status === BookingStatus.CANCELLED &&
      (changesPrice || dto.userId !== undefined)
    ) {
      throw new BadRequestException(
        'A cancelled booking can only have its customer details or notes edited',
      );
    }

    await this.withRetry(() =>
      this.dataSource.transaction(async (em) => {
        const booking = await em.findOneOrFail(Booking, {
          where: { id },
          lock: { mode: 'pessimistic_write' },
        });
        Object.assign(booking, {
          userId: dto.userId ?? booking.userId,
          customerName: dto.customerName ?? booking.customerName,
          customerPhone: dto.customerPhone ?? booking.customerPhone,
          customerEmail: dto.customerEmail ?? booking.customerEmail,
          notes: dto.notes ?? booking.notes,
        });

        if (changesPrice) {
          const date = dto.bookingDate ?? booking.bookingDate;
          const startMin = timeToMinutes(dto.timeIn ?? booking.timeIn);
          const endMin = timeToMinutes(dto.timeOut ?? booking.timeOut);
          this.assertWindow(date, startMin, endMin);
          await this.assertNoOverlap(em, date, startMin, endMin, id);
          const price = await this.priceFor({
            date,
            startMin,
            endMin,
            additionalGuests: dto.additionalGuests ?? booking.additionalGuests,
            pricePerHour: dto.pricePerHour,
            maxGuests: dto.maxGuests,
            pricePerGuest: dto.pricePerGuest,
          });
          Object.assign(booking, this.priceColumns(price), {
            bookingDate: date,
            timeIn: minutesToTime(startMin),
            timeOut: minutesToTime(endMin),
          });
          booking.status = deriveStatus(
            BookingStatus.UPCOMING,
            date,
            booking.timeIn,
            booking.timeOut,
          );
        }

        await em.save(booking);
        await em.update(
          Invoice,
          { bookingId: id },
          { customerName: booking.customerName, amount: booking.totalAmount },
        );
        await this.recalculate(em, id);
      }),
    );
    return this.findOne(id);
  }

  async cancel(id: number) {
    const booking = await this.findOne(id);
    if (booking.status === BookingStatus.CANCELLED)
      throw new BadRequestException('Booking is already cancelled');
    if (booking.status === BookingStatus.COMPLETED)
      throw new BadRequestException('A completed booking cannot be cancelled');
    await this.dataSource.transaction(async (em) => {
      await em.update(Booking, { id }, { status: BookingStatus.CANCELLED });
      await this.recalculate(em, id);
    });
    return this.findOne(id);
  }

  async remove(id: number) {
    const booking = await this.findOne(id);
    await this.bookings.remove(booking);
    return { deleted: true };
  }

  // ─────────────────────────── Payments ───────────────────────────

  async addPayment(bookingId: number, dto: PaymentInputDto) {
    const kind = await this.dataSource.transaction(async (em) => {
      const booking = await em.findOne(Booking, {
        where: { id: bookingId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!booking) throw new NotFoundException('Booking not found');
      return this.applyPayment(em, booking, dto);
    });
    if (kind === PaymentKind.PAID) this.emit(BOOKING_PAID, bookingId);
    return this.findOne(bookingId);
  }

  async removePayment(paymentId: number) {
    const payment = await this.dataSource
      .getRepository(Payment)
      .findOneBy({ id: paymentId });
    if (!payment) throw new NotFoundException('Payment not found');
    await this.dataSource.transaction(async (em) => {
      await em.delete(Payment, { id: paymentId });
      await this.recalculate(em, payment.bookingId);
    });
    return this.findOne(payment.bookingId);
  }

  // ─────────────────────────── Status sync ───────────────────────────

  /** Moves UPCOMING → ONGOING → COMPLETED based on the current time. */
  async syncStatuses(now = new Date()) {
    const ts = `${toISODate(now)} ${minutesToTime(nowMinutes(now)).slice(0, 5)}:${String(now.getSeconds()).padStart(2, '0')}`;
    const completed = await this.bookings
      .createQueryBuilder()
      .update(Booking)
      .set({ status: BookingStatus.COMPLETED })
      .where('status IN (:...open)', {
        open: [BookingStatus.UPCOMING, BookingStatus.ONGOING],
      })
      .andWhere('TIMESTAMP(booking_date, time_out) <= :ts', { ts })
      .execute();
    const ongoing = await this.bookings
      .createQueryBuilder()
      .update(Booking)
      .set({ status: BookingStatus.ONGOING })
      .where('status = :upcoming', { upcoming: BookingStatus.UPCOMING })
      .andWhere('TIMESTAMP(booking_date, time_in) <= :ts', { ts })
      .andWhere('TIMESTAMP(booking_date, time_out) > :ts', { ts })
      .execute();
    const changed = (completed.affected ?? 0) + (ongoing.affected ?? 0);
    if (changed) this.logger.debug(`Status sync updated ${changed} booking(s)`);
    return changed;
  }

  // ──────────────────────────── Internals ────────────────────────────

  private async createInternal(input: BookingInput, source: Source) {
    const startMin = timeToMinutes(input.timeIn);
    const endMin = timeToMinutes(input.timeOut);
    this.assertWindow(input.bookingDate, startMin, endMin);
    const price = await this.priceFor({
      date: input.bookingDate,
      startMin,
      endMin,
      guests: input.guests,
      additionalGuests: input.additionalGuests,
      pricePerHour: input.pricePerHour,
      maxGuests: input.maxGuests,
      pricePerGuest: input.pricePerGuest,
    });

    const { booking, paidInFull } = await this.withRetry(() =>
      this.dataSource.transaction(async (em) => {
        await this.assertNoOverlap(em, input.bookingDate, startMin, endMin);

        const prefix = `NT-${input.bookingDate.replaceAll('-', '')}-`;
        const lastBooking = await em
          .getRepository(Booking)
          .createQueryBuilder('b')
          .select('b.bookingCode', 'code')
          .where('b.bookingCode LIKE :p', { p: `${prefix}%` })
          .orderBy('b.bookingCode', 'DESC')
          .limit(1)
          .getRawOne<{ code: string }>();

        const timeIn = minutesToTime(startMin);
        const timeOut = minutesToTime(endMin);
        const booking = em.create(Booking, {
          bookingCode: bookingCode(
            input.bookingDate,
            nextSequence(lastBooking?.code),
          ),
          userId: input.userId ?? null,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerEmail: input.customerEmail?.toLowerCase() ?? null,
          bookingDate: input.bookingDate,
          timeIn,
          timeOut,
          ...this.priceColumns(price),
          amountPaid: 0,
          status: deriveStatus(
            BookingStatus.UPCOMING,
            input.bookingDate,
            timeIn,
            timeOut,
          ),
          paymentStatus: PaymentStatus.PENDING,
          notes: input.notes ?? null,
          source,
        });
        await em.save(booking);

        const year = new Date().getFullYear();
        const lastInvoice = await em
          .getRepository(Invoice)
          .createQueryBuilder('i')
          .select('i.invoiceCode', 'code')
          .where('i.invoiceCode LIKE :p', { p: `INV-${year}-%` })
          .orderBy('i.invoiceCode', 'DESC')
          .limit(1)
          .getRawOne<{ code: string }>();
        await em.save(
          em.create(Invoice, {
            invoiceCode: invoiceCode(year, nextSequence(lastInvoice?.code)),
            bookingId: booking.id,
            customerName: booking.customerName,
            invoiceDate: new Date(),
            amount: booking.totalAmount,
            paidAmount: 0,
            status: InvoiceStatus.UNPAID,
            shareToken: randomBytes(24).toString('hex'),
          }),
        );

        const kind = input.payment
          ? await this.applyPayment(em, booking, input.payment)
          : null;
        return { booking, paidInFull: kind === PaymentKind.PAID };
      }),
    );

    // After commit: send the booking confirmation (and the invoice if already paid).
    this.emit(BOOKING_CREATED, booking.id);
    if (paidInFull) this.emit(BOOKING_PAID, booking.id);
    return booking;
  }

  private emit(event: string, bookingId: number) {
    const payload: BookingEvent = { bookingId };
    this.events.emit(event, payload);
  }

  /** Records a payment or refund and returns its kind (PAID = this payment completed the total). */
  private async applyPayment(
    em: EntityManager,
    booking: Booking,
    dto: PaymentInputDto,
  ): Promise<PaymentKind> {
    const entries = await em.find(Payment, {
      where: { bookingId: booking.id },
    });
    const { netPaid } = summarizeLedger(
      entries,
      booking.totalAmount,
      booking.status,
    );
    const amount = money(dto.amount);

    let kind: PaymentKind;
    if (dto.kind === PaymentKind.REFUND) {
      if (amount > netPaid + 0.005) {
        throw new BadRequestException(
          `Refund cannot exceed the amount paid (₹${netPaid})`,
        );
      }
      kind = PaymentKind.REFUND;
    } else {
      if (booking.status === BookingStatus.CANCELLED) {
        throw new BadRequestException(
          'A cancelled booking can only receive refunds',
        );
      }
      const balance = money(booking.totalAmount - netPaid);
      if (amount > balance + 0.005) {
        throw new BadRequestException(
          `Payment exceeds the balance due (₹${balance})`,
        );
      }
      kind =
        netPaid + amount >= booking.totalAmount - 0.005
          ? PaymentKind.PAID
          : PaymentKind.ADVANCE;
    }

    await em.save(
      em.create(Payment, {
        bookingId: booking.id,
        amount,
        kind,
        paymentType: dto.paymentType,
        transactionId: dto.transactionId ?? null,
        paidAt: dto.paidAt ?? new Date(),
        note: dto.note ?? null,
      }),
    );
    await this.recalculate(em, booking.id);
    return kind;
  }

  /** Re-derives booking + invoice payment fields from the payment ledger. */
  private async recalculate(em: EntityManager, bookingId: number) {
    const booking = await em.findOneByOrFail(Booking, { id: bookingId });
    const payments = await em.find(Payment, { where: { bookingId } });
    const s = summarizeLedger(payments, booking.totalAmount, booking.status);
    const lastPayment = s.last as Payment | null;

    await em.update(
      Booking,
      { id: bookingId },
      {
        amountPaid: s.netPaid,
        paymentStatus: s.paymentStatus,
        paymentType: lastPayment?.paymentType ?? null,
        transactionId: lastPayment?.transactionId ?? null,
        paymentDate: lastPayment?.paidAt ?? null,
      },
    );
    await em.update(
      Invoice,
      { bookingId },
      {
        paidAmount: s.netPaid,
        status: s.invoiceStatus,
        paidAt:
          s.invoiceStatus === InvoiceStatus.PAID
            ? (lastPayment?.paidAt ?? null)
            : null,
      },
    );
  }

  private async priceFor(input: {
    date: string;
    startMin: number;
    endMin: number;
    guests?: number;
    additionalGuests?: number;
    pricePerHour?: number;
    maxGuests?: number;
    pricePerGuest?: number;
  }): Promise<PriceBreakdown> {
    const plans = await this.pricing.findAll();
    const base = calculatePrice({ ...input, plans });
    const maxGuests = input.maxGuests ?? base.maxGuests;
    const pricePerGuest = input.pricePerGuest ?? base.pricePerGuest;
    const additionalGuests =
      input.additionalGuests ?? Math.max(0, (input.guests ?? 0) - maxGuests);
    const turfAmount =
      input.pricePerHour !== undefined
        ? money(input.pricePerHour * base.totalHours)
        : base.turfAmount;
    const additionalGuestAmount = money(additionalGuests * pricePerGuest);
    return {
      ...base,
      pricePerHour: input.pricePerHour ?? base.pricePerHour,
      turfAmount,
      maxGuests,
      pricePerGuest,
      additionalGuests,
      additionalGuestAmount,
      totalAmount: money(turfAmount + additionalGuestAmount),
    };
  }

  private priceColumns(p: PriceBreakdown) {
    return {
      totalHours: p.totalHours,
      pricePerHour: p.pricePerHour,
      turfAmount: p.turfAmount,
      maxGuests: p.maxGuests,
      pricePerGuest: p.pricePerGuest,
      additionalGuests: p.additionalGuests,
      additionalGuestAmount: p.additionalGuestAmount,
      totalAmount: p.totalAmount,
    };
  }

  private assertWindow(date: string, startMin: number, endMin: number) {
    if (!isValidISODate(date))
      throw new BadRequestException(
        'bookingDate must be a valid YYYY-MM-DD date',
      );
    const error = validateWindow(startMin, endMin);
    if (error) throw new BadRequestException(error);
  }

  /** Locks the day's bookings so two requests can't claim the same slot. */
  private async assertNoOverlap(
    em: EntityManager,
    date: string,
    startMin: number,
    endMin: number,
    excludeId?: number,
  ) {
    const sameDay = await em
      .createQueryBuilder(Booking, 'b')
      .setLock('pessimistic_write')
      .where('b.bookingDate = :date', { date })
      .andWhere('b.status != :cancelled', {
        cancelled: BookingStatus.CANCELLED,
      })
      .getMany();
    const clash = sameDay.find(
      (b) =>
        b.id !== excludeId &&
        overlaps(
          startMin,
          endMin,
          timeToMinutes(b.timeIn),
          timeToMinutes(b.timeOut),
        ),
    );
    if (clash) {
      throw new ConflictException(
        `This time overlaps booking ${clash.bookingCode} (${minutesToLabel(timeToMinutes(clash.timeIn))} – ${minutesToLabel(timeToMinutes(clash.timeOut))})`,
      );
    }
  }

  private applyFilters(
    qb: SelectQueryBuilder<Booking>,
    query: {
      range?: DateRange;
      from?: string;
      to?: string;
      q?: string;
      paymentStatus?: PaymentStatus;
    },
  ) {
    if (query.range) {
      let bounds: { from: string; to: string };
      if (query.range === DateRange.CUSTOM) {
        if (!query.from || !query.to)
          throw new BadRequestException('range=custom needs both from and to');
        if (query.from > query.to)
          throw new BadRequestException('from must be on or before to');
        bounds = { from: query.from, to: query.to };
      } else {
        bounds = rangeBounds(query.range);
      }
      qb.andWhere('b.bookingDate BETWEEN :from AND :to', bounds);
    }
    if (query.paymentStatus)
      qb.andWhere('b.paymentStatus = :ps', { ps: query.paymentStatus });
    if (query.q) {
      const q = `%${query.q}%`;
      qb.andWhere(
        new Brackets((w) =>
          w
            .where('b.customerName LIKE :q', { q })
            .orWhere('b.customerPhone LIKE :q', { q })
            .orWhere('b.bookingCode LIKE :q', { q }),
        ),
      );
    }
  }

  private async withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
    for (let i = 1; ; i++) {
      try {
        return await fn();
      } catch (err) {
        const code = (
          err as QueryFailedError & { driverError?: { code?: string } }
        ).driverError?.code;
        if (i >= attempts || !code || !RETRYABLE.has(code)) throw err;
        this.logger.warn(
          `Retrying booking write after ${code} (attempt ${i + 1})`,
        );
      }
    }
  }
}
