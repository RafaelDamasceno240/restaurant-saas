// Calendar days in the RESTAURANT's time zone (Tenant.timezone). "Is this installment overdue?"
// and "what did we sell today?" are questions about the local calendar day, never about the
// server's clock or UTC: at 22:00 in São Paulo it is already tomorrow in UTC.
//
// A calendar day is handled as the string 'YYYY-MM-DD' (it sorts and compares correctly) and
// stored in DATE columns as UTC midnight of that day, which is how Prisma maps @db.Date.

export const DEFAULT_TIME_ZONE = 'America/Sao_Paulo';

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone });
    return true;
  } catch {
    return false;
  }
}

// The calendar day it is right now in that zone.
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  return dayInTimeZone(now, timeZone);
}

// The calendar day an instant falls on in that zone.
export function dayInTimeZone(instant: Date, timeZone: string): string {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(instant);
}

// A real calendar day: 2026-02-30 and 2026-13-01 are not.
export function isValidDateOnly(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = DATE_ONLY.exec(value);
  if (!match) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

// 'YYYY-MM-DD' -> the Date a DATE column stores (UTC midnight).
export function dateOnlyToDate(value: string): Date {
  if (!isValidDateOnly(value)) throw new RangeError(`invalid calendar day: ${value}`);
  return new Date(`${value}T00:00:00.000Z`);
}

// What a DATE column returns -> 'YYYY-MM-DD'.
export function dateToDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function addDays(day: string, days: number): string {
  const date = dateOnlyToDate(day);
  date.setUTCDate(date.getUTCDate() + days);
  return dateToDateOnly(date);
}

// Same day of a later month, clamped to that month's last day: Jan 31 + 1 month = Feb 28/29,
// and the month after that is Mar 31 again (always counted from the ORIGINAL day).
export function addMonthsClamped(day: string, months: number): string {
  const date = dateOnlyToDate(day);
  const targetMonth = date.getUTCMonth() + months;
  const first = new Date(Date.UTC(date.getUTCFullYear(), targetMonth, 1));
  const lastDay = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 0)).getUTCDate();
  first.setUTCDate(Math.min(date.getUTCDate(), lastDay));
  return dateToDateOnly(first);
}

// Whole days from one calendar day to another (negative when `to` is earlier).
export function daysBetween(from: string, to: string): number {
  return Math.round((dateOnlyToDate(to).getTime() - dateOnlyToDate(from).getTime()) / 86_400_000);
}

// The UTC instant at which a calendar day STARTS in a zone (for filtering TIMESTAMP columns by
// local day). Works across daylight-saving changes: the offset is read for that very day.
export function startOfDayInTimeZone(day: string, timeZone: string): Date {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const utcMidnight = dateOnlyToDate(day);
  // What wall-clock time is it in the zone at UTC midnight of that day? The difference is the
  // zone's offset around that instant; apply it, then check once more in case the offset
  // changed between the guess and the answer (DST boundary).
  let guess = new Date(utcMidnight.getTime() - offsetMs(utcMidnight, zone));
  guess = new Date(utcMidnight.getTime() - offsetMs(guess, zone));
  return guess;
}

function offsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(instant);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value ?? 0);
  const asUtc = Date.UTC(value('year'), value('month') - 1, value('day'), value('hour'), value('minute'), value('second'));
  return asUtc - Math.floor(instant.getTime() / 1000) * 1000;
}
