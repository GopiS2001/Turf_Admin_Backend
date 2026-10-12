import {
  BookingStatus,
  InvoiceStatus,
  PaymentKind,
  PaymentStatus,
} from '../common/enums';
import { money } from '../common/utils/decimal.transformer';
import {
  CLOSE_HOUR,
  MAX_BOOKING_MINUTES,
  OPEN_HOUR,
  SLOT_MINUTES,
  fromISODate,
  minutesToLabel,
  timeToMinutes,
  toISODate,
} from '../common/utils/time';

/** Returns an error message, or null when the window is valid. */
export function validateWindow(
  startMin: number,
  endMin: number,
): string | null {
  if (startMin % SLOT_MINUTES || endMin % SLOT_MINUTES)
    return 'Times must be on the hour or half hour';
  if (startMin < OPEN_HOUR * 60 || endMin > CLOSE_HOUR * 60) {
    return `Bookings must be between ${minutesToLabel(OPEN_HOUR * 60)} and ${minutesToLabel(CLOSE_HOUR * 60)} (midnight)`;
  }
  if (endMin <= startMin) return 'timeOut must be after timeIn';
  if (endMin - startMin > MAX_BOOKING_MINUTES)
    return `A booking can be at most ${MAX_BOOKING_MINUTES / 60} hours`;
  return null;
}

/** Half-open intervals [start, end) overlap. */
export const overlaps = (
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number,
) => aStart < bEnd && aEnd > bStart;

export function deriveStatus(
  current: BookingStatus,
  bookingDate: string,
  timeIn: string,
  timeOut: string,
  now = new Date(),
): BookingStatus {
  if (current === BookingStatus.CANCELLED) return current;
  const day = fromISODate(bookingDate).getTime();
  const start = day + timeToMinutes(timeIn) * 60_000;
  const end = day + timeToMinutes(timeOut) * 60_000;
  const t = now.getTime();
  if (t < start) return BookingStatus.UPCOMING;
  if (t < end) return BookingStatus.ONGOING;
  return BookingStatus.COMPLETED;
}

export interface LedgerEntry {
  amount: number;
  kind: PaymentKind;
  paidAt: Date;
}

export interface LedgerSummary {
  netPaid: number;
  paymentStatus: PaymentStatus;
  invoiceStatus: InvoiceStatus;
  last: LedgerEntry | null;
}

/** Turns the list of payments/refunds into booking + invoice payment state. */
export function summarizeLedger(
  entries: LedgerEntry[],
  totalAmount: number,
  bookingStatus: BookingStatus,
): LedgerSummary {
  const paid = entries
    .filter((e) => e.kind !== PaymentKind.REFUND)
    .reduce((s, e) => s + e.amount, 0);
  const refunded = entries
    .filter((e) => e.kind === PaymentKind.REFUND)
    .reduce((s, e) => s + e.amount, 0);
  const netPaid = money(paid - refunded);
  const last =
    [...entries].sort((a, b) => b.paidAt.getTime() - a.paidAt.getTime())[0] ??
    null;
  const fullyPaid = netPaid >= totalAmount - 0.005;

  let paymentStatus = PaymentStatus.PENDING;
  if (refunded > 0 && netPaid <= 0) paymentStatus = PaymentStatus.REFUND;
  else if (netPaid > 0)
    paymentStatus = fullyPaid ? PaymentStatus.PAID : PaymentStatus.ADVANCE;

  let invoiceStatus = InvoiceStatus.UNPAID;
  if (refunded > 0 && netPaid <= 0) invoiceStatus = InvoiceStatus.REFUNDED;
  else if (bookingStatus === BookingStatus.CANCELLED && netPaid <= 0)
    invoiceStatus = InvoiceStatus.CANCELLED;
  else if (netPaid > 0)
    invoiceStatus = fullyPaid ? InvoiceStatus.PAID : InvoiceStatus.PARTIAL;

  return { netPaid, paymentStatus, invoiceStatus, last };
}

/** NT-20261008-0001 */
export const bookingCode = (date: string, seq: number) =>
  `NT-${date.replaceAll('-', '')}-${String(seq).padStart(4, '0')}`;

/** INV-2026-0001 */
export const invoiceCode = (year: number, seq: number) =>
  `INV-${year}-${String(seq).padStart(4, '0')}`;

/** Next sequence number after the highest existing code with the same prefix. */
export function nextSequence(lastCode: string | null | undefined): number {
  if (!lastCode) return 1;
  const n = Number(lastCode.split('-').pop());
  return Number.isFinite(n) ? n + 1 : 1;
}

export const isValidISODate = (s: string) =>
  /^\d{4}-\d{2}-\d{2}$/.test(s) && toISODate(fromISODate(s)) === s;
