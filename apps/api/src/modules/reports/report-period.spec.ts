import { averageCents, averageMinutes, daysOfPeriod, fillDays, fillHours, MAX_PERIOD_DAYS, ReportPeriod, resolvePeriod } from './report-period';

const SP = 'America/Sao_Paulo';
const TODAY = '2026-10-05';
const period = (input: { from?: string; to?: string }, timezone = SP) => resolvePeriod(input, TODAY, timezone);

describe('resolvePeriod', () => {
  it('defaults to the last 30 days ending today', () => {
    expect(period({})).toMatchObject({ from: '2026-09-06', to: '2026-10-05', days: 30, timezone: SP });
  });

  it('derives the missing end of a half-filled period', () => {
    expect(period({ from: '2026-10-01' })).toMatchObject({ from: '2026-10-01', to: '2026-10-05', days: 5 });
    expect(period({ to: '2026-08-31' })).toMatchObject({ from: '2026-08-02', to: '2026-08-31', days: 30 });
    // Only a start, in the future: an empty single day rather than an inverted range.
    expect(period({ from: '2026-12-25' })).toMatchObject({ from: '2026-12-25', to: '2026-12-25', days: 1 });
  });

  it('a single day is a valid period', () => {
    expect(period({ from: TODAY, to: TODAY })).toMatchObject({ days: 1 });
  });

  it('turns local calendar days into the instants that bound them (UTC-3)', () => {
    const resolved = period({ from: '2026-10-01', to: '2026-10-02' }) as ReportPeriod;
    // 00:00 in São Paulo is 03:00 UTC; the end is exclusive: the first instant of the day after.
    expect(resolved.fromInstant.toISOString()).toBe('2026-10-01T03:00:00.000Z');
    expect(resolved.toInstant.toISOString()).toBe('2026-10-03T03:00:00.000Z');
  });

  it('uses the zone it is given', () => {
    const utc = period({ from: '2026-10-01', to: '2026-10-01' }, 'UTC') as ReportPeriod;
    expect(utc.fromInstant.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(utc.toInstant.toISOString()).toBe('2026-10-02T00:00:00.000Z');
    const tokyo = period({ from: '2026-10-01', to: '2026-10-01' }, 'Asia/Tokyo') as ReportPeriod;
    expect(tokyo.fromInstant.toISOString()).toBe('2026-09-30T15:00:00.000Z');
  });

  it('a day with a daylight-saving change still starts at local midnight', () => {
    // New York leaves DST on 2026-11-01: that day is 25 hours long.
    const resolved = period({ from: '2026-11-01', to: '2026-11-01' }, 'America/New_York') as ReportPeriod;
    expect(resolved.fromInstant.toISOString()).toBe('2026-11-01T04:00:00.000Z');
    expect(resolved.toInstant.toISOString()).toBe('2026-11-02T05:00:00.000Z');
  });

  it('refuses dates that are not real calendar days', () => {
    for (const bad of ['2026-02-30', '2026-13-01', '05/10/2026', '2026-10-5', '', 'hoje', '2026-10-05T00:00:00Z']) {
      expect(period({ from: bad })).toBe('DATE_INVALID');
      expect(period({ to: bad })).toBe('DATE_INVALID');
    }
  });

  it('refuses an inverted range and one longer than a year', () => {
    expect(period({ from: '2026-10-05', to: '2026-10-04' })).toBe('RANGE_INVERTED');
    expect(period({ from: '2025-10-05', to: '2026-10-05' })).toMatchObject({ days: MAX_PERIOD_DAYS });
    expect(period({ from: '2025-10-04', to: '2026-10-05' })).toBe('RANGE_TOO_LONG');
    expect(period({ from: '2020-01-01' })).toBe('RANGE_TOO_LONG');
  });
});

describe('filling the gaps', () => {
  it('lists every day of the period, across a month boundary', () => {
    expect(daysOfPeriod({ from: '2026-09-29', days: 4 })).toEqual(['2026-09-29', '2026-09-30', '2026-10-01', '2026-10-02']);
  });

  it('keeps the rows that exist and adds empty ones for the other days', () => {
    const rows = [{ day: '2026-10-02', total: 5 }];
    expect(fillDays({ from: '2026-10-01', days: 3 }, rows, (day) => ({ day, total: 0 }))).toEqual([
      { day: '2026-10-01', total: 0 },
      { day: '2026-10-02', total: 5 },
      { day: '2026-10-03', total: 0 },
    ]);
  });

  it('drops rows outside the period instead of growing it', () => {
    const rows = [{ day: '2026-09-30', total: 9 }];
    expect(fillDays({ from: '2026-10-01', days: 1 }, rows, (day) => ({ day, total: 0 }))).toEqual([{ day: '2026-10-01', total: 0 }]);
  });

  it('always answers 24 hours', () => {
    const filled = fillHours([{ hour: 12, total: 3 }], (hour) => ({ hour, total: 0 }));
    expect(filled).toHaveLength(24);
    expect(filled[12]).toEqual({ hour: 12, total: 3 });
    expect(filled[0]).toEqual({ hour: 0, total: 0 });
    expect(filled[23]).toEqual({ hour: 23, total: 0 });
  });
});

describe('averages', () => {
  it('rounds cents half-up and never divides by zero', () => {
    expect(averageCents(1000, 3)).toBe(333);
    expect(averageCents(1001, 2)).toBe(501);
    expect(averageCents(0, 0)).toBe(0);
    expect(averageCents(500, 0)).toBe(0);
  });

  it('turns seconds into whole minutes, or null when there is nothing to average', () => {
    expect(averageMinutes(3600, 2)).toBe(30);
    expect(averageMinutes(90, 1)).toBe(2);
    expect(averageMinutes(null, 3)).toBeNull();
    expect(averageMinutes(120, 0)).toBeNull();
  });
});
