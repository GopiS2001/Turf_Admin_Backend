export enum Role {
  ADMIN = 'ADMIN',
  CUSTOMER = 'CUSTOMER',
}

export enum AccountStatus {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
}

export enum BookingStatus {
  UPCOMING = 'UPCOMING',
  ONGOING = 'ONGOING',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
}

/** PENDING = nothing paid yet. */
export enum PaymentStatus {
  PENDING = 'PENDING',
  ADVANCE = 'ADVANCE',
  PAID = 'PAID',
  REFUND = 'REFUND',
}

export enum PaymentType {
  CASH = 'CASH',
  UPI = 'UPI',
  BANK_TRANSFER = 'BANK_TRANSFER',
}

/** What a single payment record represents. */
export enum PaymentKind {
  ADVANCE = 'ADVANCE',
  PAID = 'PAID',
  REFUND = 'REFUND',
}

export enum InvoiceStatus {
  UNPAID = 'UNPAID',
  PARTIAL = 'PARTIAL',
  PAID = 'PAID',
  REFUNDED = 'REFUNDED',
  CANCELLED = 'CANCELLED',
}

export enum EnquiryStatus {
  NEW = 'NEW',
  CONTACTED = 'CONTACTED',
  CLOSED = 'CLOSED',
}

export enum PlanCode {
  WEEKDAY_DAY = 'weekday-day',
  WEEKDAY_NIGHT = 'weekday-night',
  WEEKEND = 'weekend',
}

export enum DateRange {
  TODAY = 'today',
  WEEK = 'week',
  MONTH = 'month',
  CUSTOM = 'custom',
}
