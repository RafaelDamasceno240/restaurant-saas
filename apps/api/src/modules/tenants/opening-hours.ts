// Weekly opening hours of a branch. Pure (no I/O): validated by the DTO, normalized by the
// service and evaluated for the public menu with the same functions, so "valid", "stored" and
// "open now" can never disagree.
//
// An interval is a weekday (0 = Sunday ... 6 = Saturday, as Date#getDay) and two wall-clock
// times in the restaurant's time zone. A "closes" earlier than "opens" means the interval ends
// after midnight, on the next day (18:00 to 02:00). Equal times are refused: "open 24 hours" is
// 00:00 to 23:59. A weekday with no interval is closed.

import { DEFAULT_TIME_ZONE, isValidTimeZone } from '../../common/util/timezone.util';

export interface OpeningInterval {
  weekday: number;
  opens: string;
  closes: string;
}

export const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;
// Lunch and dinner, plus one spare: more than three shifts in a day is a typing mistake.
export const MAX_INTERVALS_PER_DAY = 3;
export const MAX_INTERVALS = 7 * MAX_INTERVALS_PER_DAY;

const MINUTES_PER_DAY = 24 * 60;
const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];

function toMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

// Position in the week where the interval starts, and how long it lasts (always > 0).
function span(interval: OpeningInterval): { start: number; length: number } {
  const opens = toMinutes(interval.opens);
  const closes = toMinutes(interval.closes);
  return {
    start: interval.weekday * MINUTES_PER_DAY + opens,
    length: closes > opens ? closes - opens : closes + MINUTES_PER_DAY - opens,
  };
}

// The week is a circle: Saturday 22:00 to 02:00 runs into Sunday.
function covers(interval: OpeningInterval, minuteOfWeek: number): boolean {
  const { start, length } = span(interval);
  return (
    (((minuteOfWeek - start) % MINUTES_PER_WEEK) + MINUTES_PER_WEEK) % MINUTES_PER_WEEK < length
  );
}

function overlaps(a: OpeningInterval, b: OpeningInterval): boolean {
  return covers(a, span(b).start) || covers(b, span(a).start);
}

function isInterval(value: unknown): value is OpeningInterval {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const { weekday, opens, closes, ...rest } = value as Record<string, unknown>;
  return (
    Object.keys(rest).length === 0 &&
    Number.isInteger(weekday) &&
    (weekday as number) >= 0 &&
    (weekday as number) <= 6 &&
    typeof opens === 'string' &&
    TIME_PATTERN.test(opens) &&
    typeof closes === 'string' &&
    TIME_PATTERN.test(closes)
  );
}

// First problem found, in Portuguese for the operator; null when the list can be stored.
export function openingHoursProblem(value: unknown): string | null {
  if (!Array.isArray(value)) return 'Horários devem ser uma lista.';
  if (value.length > MAX_INTERVALS) return `Informe no máximo ${MAX_INTERVALS} horários.`;
  if (!value.every(isInterval)) {
    return 'Cada horário precisa de dia da semana (0 a 6), abertura e fechamento no formato HH:MM.';
  }
  const intervals = value as OpeningInterval[];
  for (const interval of intervals) {
    if (interval.opens === interval.closes) {
      return `Abertura e fechamento iguais (${interval.opens}) na ${WEEKDAY_NAMES[interval.weekday]}.`;
    }
  }
  for (let day = 0; day < 7; day++) {
    if (intervals.filter((i) => i.weekday === day).length > MAX_INTERVALS_PER_DAY) {
      return `Informe no máximo ${MAX_INTERVALS_PER_DAY} horários na ${WEEKDAY_NAMES[day]}.`;
    }
  }
  for (let i = 0; i < intervals.length; i++) {
    for (let j = i + 1; j < intervals.length; j++) {
      if (overlaps(intervals[i], intervals[j])) {
        const a = intervals[i];
        const b = intervals[j];
        return (
          `Horários sobrepostos: ${WEEKDAY_NAMES[a.weekday]} ${a.opens}-${a.closes} e ` +
          `${WEEKDAY_NAMES[b.weekday]} ${b.opens}-${b.closes}.`
        );
      }
    }
  }
  return null;
}

// Stored and returned in week order, without any extra key the client may have sent.
export function normalizeOpeningHours(intervals: OpeningInterval[]): OpeningInterval[] {
  return intervals
    .map(({ weekday, opens, closes }) => ({ weekday, opens, closes }))
    .sort((a, b) => a.weekday - b.weekday || toMinutes(a.opens) - toMinutes(b.opens));
}

// What the database returns is trusted only if it still passes the rule (a row edited by hand
// is treated as "not informed" instead of breaking the public menu).
export function readOpeningHours(value: unknown): OpeningInterval[] | null {
  if (value === null || value === undefined) return null;
  return openingHoursProblem(value) === null
    ? normalizeOpeningHours(value as OpeningInterval[])
    : null;
}

// Weekday and minute of the day on the restaurant's wall clock.
function wallClock(now: Date, timeZone: string): { weekday: number; minutes: number } {
  const zone = isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIME_ZONE;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: zone,
    hourCycle: 'h23',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(value('weekday'));
  return { weekday, minutes: Number(value('hour')) * 60 + Number(value('minute')) };
}

// null when the hours were never informed: the screen says nothing instead of "closed".
export function isOpenAt(
  intervals: OpeningInterval[] | null,
  now: Date,
  timeZone: string,
): boolean | null {
  if (intervals === null) return null;
  const { weekday, minutes } = wallClock(now, timeZone);
  const minuteOfWeek = weekday * MINUTES_PER_DAY + minutes;
  return intervals.some((interval) => covers(interval, minuteOfWeek));
}

// Whether the public checkout may take an order now. The same rule as "Aberto agora" on the
// menu, so the badge and the checkout can never disagree: hours never informed = no restriction
// (the menu shows nothing either), an informed week with no interval covering now = closed.
export function acceptsOrdersAt(intervals: OpeningInterval[] | null, now: Date, timeZone: string): boolean {
  return isOpenAt(intervals, now, timeZone) !== false;
}
