import type { Booking } from '../bookings/booking.entity';
import { BookingStatus, InvoiceStatus, PaymentKind } from '../common/enums';
import {
  fromISODate,
  minutesToLabel,
  timeToMinutes,
} from '../common/utils/time';
import type { Invoice } from '../invoices/invoice.entity';

export type DocumentType = 'invoice' | 'booking';
export const DOCUMENT_TYPES: DocumentType[] = ['invoice', 'booking'];

export interface BusinessInfo {
  name: string;
  address: string;
  phone: string;
  email: string;
}

const inrFormatter = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});
export const inr = (n: number) => inrFormatter.format(n);

const dateTime = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});
const longDate = new Intl.DateTimeFormat('en-IN', {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});
const shortDate = new Intl.DateTimeFormat('en-IN', {
  day: 'numeric',
  month: 'short',
});
const weekday = new Intl.DateTimeFormat('en-IN', { weekday: 'long' });
const yearOnly = new Intl.DateTimeFormat('en-IN', { year: 'numeric' });

export const formatDateTime = (d: Date | string | null | undefined) =>
  d ? dateTime.format(new Date(d)) : '—';
const hoursLabel = (h: number) => `${h} hour${h === 1 ? '' : 's'}`;
const humanize = (v: string) =>
  v
    .toLowerCase()
    .split('_')
    .map((w) => (w === 'upi' ? 'UPI' : w[0].toUpperCase() + w.slice(1)))
    .join(' ');

/** "90s Turf" → "90" + "s" (yellow) + "TURF", like the logo. */
function splitWordmark(name: string) {
  const m = /^(\d+)(s)\s+(.+)$/i.exec(name.trim());
  return m
    ? { namePrefix: m[1], nameAccent: m[2], nameRest: m[3].toUpperCase() }
    : { namePrefix: name.toUpperCase(), nameAccent: '', nameRest: '' };
}

const invoiceTone: Record<InvoiceStatus, string> = {
  PAID: 'paid',
  PARTIAL: 'partial',
  UNPAID: 'unpaid',
  CANCELLED: 'cancelled',
  REFUNDED: 'refunded',
};

/** Builds the data both templates render. Everything is pre-formatted. */
export function buildDocumentView(
  type: DocumentType,
  booking: Booking,
  invoice: Invoice,
  business: BusinessInfo,
) {
  const day = fromISODate(booking.bookingDate);
  const timeIn = minutesToLabel(timeToMinutes(booking.timeIn));
  const timeOut = minutesToLabel(timeToMinutes(booking.timeOut));
  const closed =
    invoice.status === InvoiceStatus.CANCELLED ||
    invoice.status === InvoiceStatus.REFUNDED;
  const balance = closed
    ? 0
    : Math.max(0, booking.totalAmount - booking.amountPaid);
  const paidInFull = invoice.status === InvoiceStatus.PAID;

  const lines = [
    {
      description: 'Turf booking',
      detail: `${longDate.format(day)} · ${timeIn} – ${timeOut}`,
      qty: hoursLabel(booking.totalHours),
      rate: `${inr(booking.pricePerHour)}/hr`,
      amount: inr(booking.turfAmount),
    },
  ];
  if (booking.additionalGuests > 0) {
    lines.push({
      description: 'Additional guests',
      detail: `Above the ${booking.maxGuests} players included`,
      qty: String(booking.additionalGuests),
      rate: inr(booking.pricePerGuest),
      amount: inr(booking.additionalGuestAmount),
    });
  }

  const payments = [...(booking.payments ?? [])]
    .sort((a, b) => new Date(a.paidAt).getTime() - new Date(b.paidAt).getTime())
    .map((p) => ({
      date: formatDateTime(p.paidAt),
      kind: humanize(p.kind),
      method: humanize(p.paymentType),
      txn: p.transactionId,
      amount: `${p.kind === PaymentKind.REFUND ? '−' : ''}${inr(p.amount)}`,
      isRefund: p.kind === PaymentKind.REFUND,
    }));

  const isInvoice = type === 'invoice';
  const bookingTone = booking.status.toLowerCase();
  const stamp = isInvoice
    ? paidInFull
      ? 'PAID'
      : invoice.status === InvoiceStatus.REFUNDED
        ? 'REFUNDED'
        : invoice.status === InvoiceStatus.CANCELLED
          ? 'CANCELLED'
          : null
    : null;

  return {
    business: { ...business, ...splitWordmark(business.name) },
    doc: isInvoice
      ? {
          kind: 'invoice',
          title: 'Invoice',
          number: invoice.invoiceCode,
          dateLabel: 'Issued',
          date: formatDateTime(invoice.invoiceDate),
          status: humanize(invoice.status),
          statusTone: invoiceTone[invoice.status],
        }
      : {
          kind: 'booking',
          title: 'Booking Confirmation',
          number: booking.bookingCode,
          dateLabel: 'Invoice',
          date: invoice.invoiceCode,
          status:
            booking.status === BookingStatus.UPCOMING
              ? 'Confirmed'
              : humanize(booking.status),
          statusTone:
            booking.status === BookingStatus.UPCOMING ? 'paid' : bookingTone,
        },
    stamp,
    customer: {
      name: booking.customerName,
      phone: booking.customerPhone,
      email: booking.customerEmail,
    },
    booking: {
      code: booking.bookingCode,
      date: longDate.format(day),
      dateShort: shortDate.format(day).toUpperCase(),
      weekday: `${weekday.format(day)}, ${yearOnly.format(day)}`,
      time: `${timeIn} – ${timeOut}`,
      timeIn,
      timeOut,
      hours: hoursLabel(booking.totalHours),
      players:
        booking.additionalGuests > 0
          ? `${booking.maxGuests} + ${booking.additionalGuests} extra players`
          : `Up to ${booking.maxGuests} players`,
      bookedAt: formatDateTime(booking.bookedAt),
      source: humanize(booking.source),
    },
    lines,
    totals: {
      total: inr(booking.totalAmount),
      paid: inr(booking.amountPaid),
      balance: inr(balance),
      balanceLabel: closed
        ? 'Balance'
        : balance > 0
          ? 'Balance due'
          : 'Paid in full',
      payNote:
        balance > 0
          ? `${inr(balance)} is payable at the venue by cash, UPI or bank transfer.`
          : 'This booking is fully paid — nothing more to pay at the venue.',
    },
    payments,
    generatedAt: formatDateTime(new Date()),
  };
}

export type DocumentView = ReturnType<typeof buildDocumentView>;
