import {
  BookingStatus,
  InvoiceStatus,
  PaymentKind,
  PaymentStatus,
} from '../common/enums';
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

const h = (hours: number) => hours * 60;

describe('validateWindow', () => {
  it('accepts a normal booking and one that ends at midnight', () => {
    expect(validateWindow(h(18), h(20))).toBeNull();
    expect(validateWindow(h(22), h(24))).toBeNull();
  });

  it.each([
    [h(5), h(7), /between/],
    [h(23), h(25), /between/],
    [h(20), h(20), /after/],
    [h(21), h(20), /after/],
    [h(6), h(13), /at most 6 hours/],
    [h(18) + 15, h(19), /half hour/],
  ])('rejects %i–%i', (start, end, message) => {
    expect(validateWindow(start, end)).toMatch(message);
  });
});

describe('overlaps', () => {
  it('treats back-to-back bookings as not overlapping', () => {
    expect(overlaps(h(18), h(19), h(19), h(20))).toBe(false);
    expect(overlaps(h(19), h(20), h(18), h(19))).toBe(false);
  });

  it('detects partial and full overlaps', () => {
    expect(overlaps(h(18), h(20), h(19), h(21))).toBe(true);
    expect(overlaps(h(18), h(22), h(19), h(20))).toBe(true);
    expect(overlaps(h(19), h(20), h(18), h(22))).toBe(true);
  });
});

describe('deriveStatus', () => {
  const at = (iso: string) => new Date(iso);

  it('moves through upcoming → ongoing → completed', () => {
    const args = [
      BookingStatus.UPCOMING,
      '2026-10-08',
      '18:00:00',
      '20:00:00',
    ] as const;
    expect(deriveStatus(...args, at('2026-10-08T17:59:00'))).toBe(
      BookingStatus.UPCOMING,
    );
    expect(deriveStatus(...args, at('2026-10-08T18:00:00'))).toBe(
      BookingStatus.ONGOING,
    );
    expect(deriveStatus(...args, at('2026-10-08T20:00:00'))).toBe(
      BookingStatus.COMPLETED,
    );
  });

  it('handles a booking that ends at midnight', () => {
    expect(
      deriveStatus(
        BookingStatus.UPCOMING,
        '2026-10-08',
        '22:00:00',
        '24:00:00',
        at('2026-10-08T23:59:00'),
      ),
    ).toBe(BookingStatus.ONGOING);
    expect(
      deriveStatus(
        BookingStatus.UPCOMING,
        '2026-10-08',
        '22:00:00',
        '24:00:00',
        at('2026-10-09T00:00:00'),
      ),
    ).toBe(BookingStatus.COMPLETED);
  });

  it('never changes a cancelled booking', () => {
    expect(
      deriveStatus(
        BookingStatus.CANCELLED,
        '2026-10-08',
        '18:00:00',
        '20:00:00',
        at('2026-10-08T19:00:00'),
      ),
    ).toBe(BookingStatus.CANCELLED);
  });
});

describe('summarizeLedger', () => {
  const pay = (amount: number, kind: PaymentKind, day: number) => ({
    amount,
    kind,
    paidAt: new Date(2026, 9, day),
  });

  it('is pending/unpaid with no payments', () => {
    expect(summarizeLedger([], 2400, BookingStatus.UPCOMING)).toMatchObject({
      netPaid: 0,
      paymentStatus: PaymentStatus.PENDING,
      invoiceStatus: InvoiceStatus.UNPAID,
      last: null,
    });
  });

  it('is advance/partial after a part payment', () => {
    const s = summarizeLedger(
      [pay(1000, PaymentKind.ADVANCE, 1)],
      2400,
      BookingStatus.UPCOMING,
    );
    expect(s).toMatchObject({
      netPaid: 1000,
      paymentStatus: PaymentStatus.ADVANCE,
      invoiceStatus: InvoiceStatus.PARTIAL,
    });
  });

  it('is paid once the total is covered, and reports the latest payment', () => {
    const s = summarizeLedger(
      [pay(1000, PaymentKind.ADVANCE, 1), pay(1400, PaymentKind.PAID, 3)],
      2400,
      BookingStatus.COMPLETED,
    );
    expect(s).toMatchObject({
      netPaid: 2400,
      paymentStatus: PaymentStatus.PAID,
      invoiceStatus: InvoiceStatus.PAID,
    });
    expect(s.last?.amount).toBe(1400);
  });

  it('is refund/refunded when everything paid was returned', () => {
    const s = summarizeLedger(
      [pay(1000, PaymentKind.ADVANCE, 1), pay(1000, PaymentKind.REFUND, 2)],
      2400,
      BookingStatus.CANCELLED,
    );
    expect(s).toMatchObject({
      netPaid: 0,
      paymentStatus: PaymentStatus.REFUND,
      invoiceStatus: InvoiceStatus.REFUNDED,
    });
  });

  it('marks the invoice cancelled when a booking is cancelled with nothing paid', () => {
    expect(
      summarizeLedger([], 2400, BookingStatus.CANCELLED).invoiceStatus,
    ).toBe(InvoiceStatus.CANCELLED);
  });
});

describe('codes', () => {
  it('formats booking and invoice codes', () => {
    expect(bookingCode('2026-10-08', 7)).toBe('NT-20261008-0007');
    expect(invoiceCode(2026, 12)).toBe('INV-2026-0012');
  });

  it('continues the sequence from the highest existing code', () => {
    expect(nextSequence(undefined)).toBe(1);
    expect(nextSequence('INV-2026-0041')).toBe(42);
    expect(nextSequence('NT-20261008-0009')).toBe(10);
  });
});

describe('isValidISODate', () => {
  it('rejects impossible dates', () => {
    expect(isValidISODate('2026-10-08')).toBe(true);
    expect(isValidISODate('2026-02-30')).toBe(false);
    expect(isValidISODate('08-10-2026')).toBe(false);
  });
});
