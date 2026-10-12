/** Emitted by BookingsService after the transaction commits; handled by NotificationsService. */
export const BOOKING_CREATED = 'booking.created';
/** The booking's payments now cover the full amount. */
export const BOOKING_PAID = 'booking.paid';

export interface BookingEvent {
  bookingId: number;
}
