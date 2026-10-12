/**
 * Date/time helpers. Booking dates are stored as `YYYY-MM-DD` strings and times as
 * `HH:mm:ss` (MySQL TIME, where `24:00:00` means midnight closing). All "now"
 * comparisons use the server's local time zone (TZ=Asia/Kolkata).
 */

export const OPEN_HOUR = 6;
export const CLOSE_HOUR = 24;
export const NIGHT_START_HOUR = 18;
export const SLOT_MINUTES = 30;
export const MAX_BOOKING_MINUTES = 6 * 60;
/** How far ahead customers can book online. */
export const BOOKING_WINDOW_DAYS = 14;

const pad = (n: number) => String(n).padStart(2, '0');

export function toISODate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fromISODate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** "07:30" | "07:30:00" → 450 */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + (m || 0);
}

/** 450 → "07:30:00" */
export function minutesToTime(min: number): string {
  return `${pad(Math.floor(min / 60))}:${pad(min % 60)}:00`;
}

/** 450 → "7:30 AM", 1440 → "12:00 AM" */
export function minutesToLabel(min: number): string {
  const h = Math.floor(min / 60) % 24;
  const m = min % 60;
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

export function addDays(d: Date, days: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + days);
  return copy;
}

export function nowMinutes(now = new Date()): number {
  return now.getHours() * 60 + now.getMinutes();
}

export function isWeekend(date: string): boolean {
  const day = fromISODate(date).getDay();
  return day === 0 || day === 6;
}

/** Inclusive `from`/`to` dates for the dashboard/booking range filters. */
export function rangeBounds(
  range: 'today' | 'week' | 'month',
  now = new Date(),
): { from: string; to: string } {
  if (range === 'today') {
    const today = toISODate(now);
    return { from: today, to: today };
  }
  if (range === 'week') {
    // Monday → Sunday
    const offset = (now.getDay() + 6) % 7;
    const monday = addDays(now, -offset);
    return { from: toISODate(monday), to: toISODate(addDays(monday, 6)) };
  }
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  const last = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  return { from: toISODate(first), to: toISODate(last) };
}
