import {
  addDays,
  addMonthsClamped,
  dateOnlyToDate,
  dateToDateOnly,
  dayInTimeZone,
  daysBetween,
  isValidDateOnly,
  isValidTimeZone,
  startOfDayInTimeZone,
  todayInTimeZone,
} from './timezone.util';

describe('calendar days in a time zone', () => {
  it('late evening in São Paulo is still the same local day although UTC is already tomorrow', () => {
    const instant = new Date('2026-10-05T01:30:00.000Z'); // 22:30 of the 4th in São Paulo (UTC-3)
    expect(dayInTimeZone(instant, 'America/Sao_Paulo')).toBe('2026-10-04');
    expect(dayInTimeZone(instant, 'UTC')).toBe('2026-10-05');
    expect(todayInTimeZone('Asia/Tokyo', instant)).toBe('2026-10-05');
  });

  it('falls back to the default zone for a zone that does not exist', () => {
    expect(isValidTimeZone('America/Sao_Paulo')).toBe(true);
    expect(isValidTimeZone('Mars/Olympus')).toBe(false);
    expect(dayInTimeZone(new Date('2026-10-05T01:30:00.000Z'), 'Mars/Olympus')).toBe('2026-10-04');
  });

  it('finds the instant a local day starts, also on a daylight-saving change', () => {
    expect(startOfDayInTimeZone('2026-10-04', 'America/Sao_Paulo').toISOString()).toBe('2026-10-04T03:00:00.000Z');
    expect(startOfDayInTimeZone('2026-10-04', 'UTC').toISOString()).toBe('2026-10-04T00:00:00.000Z');
    // New York: DST ends on 2026-11-01 (UTC-4 before, UTC-5 after).
    expect(startOfDayInTimeZone('2026-11-01', 'America/New_York').toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(startOfDayInTimeZone('2026-11-02', 'America/New_York').toISOString()).toBe('2026-11-02T05:00:00.000Z');
    // Every instant of the day maps back to that day.
    const start = startOfDayInTimeZone('2026-11-01', 'America/New_York');
    expect(dayInTimeZone(start, 'America/New_York')).toBe('2026-11-01');
    expect(dayInTimeZone(new Date(start.getTime() - 1), 'America/New_York')).toBe('2026-10-31');
  });
});

describe('calendar day arithmetic', () => {
  it('accepts only real days', () => {
    expect(isValidDateOnly('2026-02-28')).toBe(true);
    expect(isValidDateOnly('2028-02-29')).toBe(true);
    for (const bad of ['2026-02-30', '2026-13-01', '2026-00-10', '26-01-01', '2026-1-1', '2026-01-01T00:00:00Z', '', null, 20260101]) {
      expect(isValidDateOnly(bad)).toBe(false);
    }
  });

  it('round-trips with what a DATE column stores', () => {
    expect(dateOnlyToDate('2026-10-04').toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(dateToDateOnly(new Date('2026-10-04T00:00:00.000Z'))).toBe('2026-10-04');
    expect(() => dateOnlyToDate('2026-02-30')).toThrow(RangeError);
  });

  it('adds days across months and years', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(daysBetween('2026-10-01', '2026-10-31')).toBe(30);
    expect(daysBetween('2026-10-31', '2026-10-01')).toBe(-30);
  });

  it('adds months keeping the day, clamped to the end of shorter months', () => {
    expect(addMonthsClamped('2026-01-15', 1)).toBe('2026-02-15');
    expect(addMonthsClamped('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsClamped('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonthsClamped('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonthsClamped('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonthsClamped('2026-10-04', 0)).toBe('2026-10-04');
  });
});
