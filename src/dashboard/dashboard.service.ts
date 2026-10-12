import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Booking } from '../bookings/booking.entity';
import { BookingsService } from '../bookings/bookings.service';
import { BookingStatus, DateRange, PaymentKind } from '../common/enums';
import { money } from '../common/utils/decimal.transformer';
import {
  minutesToTime,
  nowMinutes,
  rangeBounds,
  toISODate,
} from '../common/utils/time';
import { Payment } from '../payments/payment.entity';

@Injectable()
export class DashboardService {
  constructor(
    @InjectRepository(Booking) private readonly bookings: Repository<Booking>,
    @InjectRepository(Payment) private readonly payments: Repository<Payment>,
    private readonly bookingsService: BookingsService,
  ) {}

  /**
   * Headline numbers. Booking counts use the booking date; money uses when it was paid.
   * Without a range, totals are all-time.
   */
  async summary(range?: DateRange, from?: string, to?: string) {
    await this.bookingsService.syncStatuses();
    const bounds = this.bounds(range, from, to);
    const today = toISODate(new Date());

    const statusQb = this.bookings
      .createQueryBuilder('b')
      .select('b.status', 'status')
      .addSelect('COUNT(*)', 'count')
      .addSelect('COALESCE(SUM(b.totalAmount), 0)', 'value')
      .addSelect('COALESCE(SUM(b.totalAmount - b.amountPaid), 0)', 'due')
      .groupBy('b.status');
    if (bounds) statusQb.where('b.bookingDate BETWEEN :from AND :to', bounds);
    const rows = await statusQb.getRawMany<{
      status: BookingStatus;
      count: string;
      value: string;
      due: string;
    }>();

    const byStatus = Object.fromEntries(
      Object.values(BookingStatus).map((s) => [s, 0]),
    ) as Record<BookingStatus, number>;
    let bookingValue = 0;
    let outstanding = 0;
    for (const r of rows) {
      byStatus[r.status] = Number(r.count);
      if (r.status !== BookingStatus.CANCELLED) {
        bookingValue += Number(r.value);
        outstanding += Math.max(0, Number(r.due));
      }
    }

    const [collected, todayCollected] = await Promise.all([
      this.netPayments(bounds),
      this.netPayments({ from: today, to: today }),
    ]);

    return {
      range: bounds ?? 'all',
      totalBookings: byStatus.UPCOMING + byStatus.ONGOING + byStatus.COMPLETED,
      bookingsByStatus: byStatus,
      totalPayments: collected.net,
      paymentsBreakdown: collected,
      todayRevenue: todayCollected.net,
      bookingValue: money(bookingValue),
      outstandingAmount: money(outstanding),
    };
  }

  /** Next bookings by start time, including any in progress now. */
  async upcoming(limit = 5) {
    await this.bookingsService.syncStatuses();
    const now = new Date();
    return this.bookings
      .createQueryBuilder('b')
      .where('b.status IN (:...open)', {
        open: [BookingStatus.UPCOMING, BookingStatus.ONGOING],
      })
      .andWhere('TIMESTAMP(b.booking_date, b.time_out) > :ts', {
        ts: `${toISODate(now)} ${minutesToTime(nowMinutes(now))}`,
      })
      .orderBy('b.bookingDate', 'ASC')
      .addOrderBy('b.timeIn', 'ASC')
      .limit(Math.min(Math.max(limit, 1), 50))
      .getMany();
  }

  /** Net payments and booking counts per month for the last `months` months. */
  async revenue(months = 6) {
    months = Math.min(Math.max(months, 1), 24);
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth() - (months - 1), 1);
    const from = toISODate(start);

    const paid = await this.payments
      .createQueryBuilder('p')
      .select("DATE_FORMAT(p.paidAt, '%Y-%m')", 'month')
      .addSelect(
        `SUM(CASE WHEN p.kind = :refund THEN -p.amount ELSE p.amount END)`,
        'net',
      )
      .where('DATE(p.paidAt) >= :from', { from })
      .setParameter('refund', PaymentKind.REFUND)
      .groupBy('month')
      .getRawMany<{ month: string; net: string }>();

    const booked = await this.bookings
      .createQueryBuilder('b')
      .select("DATE_FORMAT(b.bookingDate, '%Y-%m')", 'month')
      .addSelect('COUNT(*)', 'count')
      .where('b.bookingDate >= :from', { from })
      .andWhere('b.status != :c', { c: BookingStatus.CANCELLED })
      .groupBy('month')
      .getRawMany<{ month: string; count: string }>();

    return Array.from({ length: months }, (_, i) => {
      const d = new Date(start.getFullYear(), start.getMonth() + i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      return {
        month: key,
        label: d.toLocaleString('en-IN', { month: 'short', year: 'numeric' }),
        revenue: money(Number(paid.find((r) => r.month === key)?.net ?? 0)),
        bookings: Number(booked.find((r) => r.month === key)?.count ?? 0),
      };
    });
  }

  private async netPayments(bounds: { from: string; to: string } | null) {
    const qb = this.payments
      .createQueryBuilder('p')
      .select('p.kind', 'kind')
      .addSelect('COALESCE(SUM(p.amount), 0)', 'total')
      .groupBy('p.kind');
    if (bounds) qb.where('DATE(p.paidAt) BETWEEN :from AND :to', bounds);
    const rows = await qb.getRawMany<{ kind: PaymentKind; total: string }>();
    const get = (k: PaymentKind) =>
      Number(rows.find((r) => r.kind === k)?.total ?? 0);
    const received = get(PaymentKind.PAID) + get(PaymentKind.ADVANCE);
    const refunded = get(PaymentKind.REFUND);
    return {
      received: money(received),
      refunded: money(refunded),
      net: money(received - refunded),
    };
  }

  private bounds(range?: DateRange, from?: string, to?: string) {
    if (!range) return null;
    if (range === DateRange.CUSTOM) {
      if (!from || !to)
        throw new BadRequestException('range=custom needs both from and to');
      return { from, to };
    }
    return rangeBounds(range);
  }
}
