import { addDays, daysBetween, isValidDateOnly, startOfDayInTimeZone } from '../../common/util/timezone.util';

// Every report answers "what happened between two CALENDAR DAYS of the restaurant", both
// inclusive. The days are in the restaurant's time zone (Tenant.timezone): a sale at 22:30 in
// São Paulo belongs to that day, although it is already tomorrow in UTC.

export const DEFAULT_PERIOD_DAYS = 30;
// A year plus the leap day: enough for "this year so far" and bounded for the database.
export const MAX_PERIOD_DAYS = 366;

export type PeriodProblem = 'DATE_INVALID' | 'RANGE_INVERTED' | 'RANGE_TOO_LONG';

export interface ReportPeriod {
  // Calendar days, inclusive.
  from: string;
  to: string;
  timezone: string;
  days: number;
  // The same interval as instants: [fromInstant, toInstant).
  fromInstant: Date;
  toInstant: Date;
}

// Without dates: the last 30 days ending today. With only one of them, the other is derived
// (from -> today; to -> 30 days ending on it), so a half-filled form still means something.
export function resolvePeriod(
  input: { from?: string; to?: string },
  today: string,
  timezone: string,
): ReportPeriod | PeriodProblem {
  if (input.from !== undefined && !isValidDateOnly(input.from)) return 'DATE_INVALID';
  if (input.to !== undefined && !isValidDateOnly(input.to)) return 'DATE_INVALID';

  const to = input.to ?? (input.from !== undefined && input.from > today ? input.from : today);
  const from = input.from ?? addDays(to, -(DEFAULT_PERIOD_DAYS - 1));
  if (from > to) return 'RANGE_INVERTED';
  const days = daysBetween(from, to) + 1;
  if (days > MAX_PERIOD_DAYS) return 'RANGE_TOO_LONG';

  return {
    from,
    to,
    timezone,
    days,
    fromInstant: startOfDayInTimeZone(from, timezone),
    toInstant: startOfDayInTimeZone(addDays(to, 1), timezone),
  };
}

// Every day of the period, in order, so a chart has a bar (possibly empty) for each one.
export function daysOfPeriod(period: Pick<ReportPeriod, 'from' | 'days'>): string[] {
  return Array.from({ length: period.days }, (_, index) => addDays(period.from, index));
}

// Rows grouped by day in SQL only exist for days that had something; the report shows them all.
export function fillDays<T extends { day: string }>(period: Pick<ReportPeriod, 'from' | 'days'>, rows: T[], empty: (day: string) => T): T[] {
  const byDay = new Map(rows.map((row) => [row.day, row]));
  return daysOfPeriod(period).map((day) => byDay.get(day) ?? empty(day));
}

export function fillHours<T extends { hour: number }>(rows: T[], empty: (hour: number) => T): T[] {
  const byHour = new Map(rows.map((row) => [row.hour, row]));
  return Array.from({ length: 24 }, (_, hour) => byHour.get(hour) ?? empty(hour));
}

// Integer division for averages of cents: half-up, and 0 when there is nothing to divide by.
export function averageCents(totalCents: number, count: number): number {
  return count > 0 ? Math.round(totalCents / count) : 0;
}

// Minutes between two instants as a whole number, or null when either is missing.
export function averageMinutes(totalSeconds: number | null, count: number): number | null {
  if (totalSeconds === null || count <= 0) return null;
  return Math.round(totalSeconds / count / 60);
}
