import {
  acceptsOrdersAt,
  isOpenAt,
  normalizeOpeningHours,
  OpeningInterval,
  openingHoursProblem,
  readOpeningHours,
} from './opening-hours';

const SP = 'America/Sao_Paulo';
// São Paulo has no daylight saving time since 2019: local = UTC - 3.
const sp = (iso: string) => new Date(`${iso}-03:00`);

describe('openingHoursProblem', () => {
  it('accepts an empty week (closed every day) and lunch plus dinner on the same day', () => {
    expect(openingHoursProblem([])).toBeNull();
    expect(
      openingHoursProblem([
        { weekday: 1, opens: '11:00', closes: '15:00' },
        { weekday: 1, opens: '18:00', closes: '23:00' },
      ]),
    ).toBeNull();
  });

  it('accepts an interval that ends after midnight when the next day starts later', () => {
    expect(
      openingHoursProblem([
        { weekday: 5, opens: '18:00', closes: '02:00' },
        { weekday: 6, opens: '11:00', closes: '15:00' },
      ]),
    ).toBeNull();
  });

  it('refuses shapes that are not a list of complete intervals', () => {
    expect(openingHoursProblem(null)).not.toBeNull();
    expect(openingHoursProblem({ weekday: 1 })).not.toBeNull();
    expect(openingHoursProblem([{ weekday: 7, opens: '10:00', closes: '12:00' }])).not.toBeNull();
    expect(openingHoursProblem([{ weekday: 1.5, opens: '10:00', closes: '12:00' }])).not.toBeNull();
    expect(openingHoursProblem([{ weekday: '1', opens: '10:00', closes: '12:00' }])).not.toBeNull();
    expect(openingHoursProblem([{ weekday: 1, opens: '24:00', closes: '12:00' }])).not.toBeNull();
    expect(openingHoursProblem([{ weekday: 1, opens: '9:00', closes: '12:00' }])).not.toBeNull();
    expect(openingHoursProblem([{ weekday: 1, opens: '10:00' }])).not.toBeNull();
    expect(
      openingHoursProblem([{ weekday: 1, opens: '10:00', closes: '12:00', extra: true }]),
    ).not.toBeNull();
  });

  it('refuses equal opening and closing times', () => {
    expect(openingHoursProblem([{ weekday: 2, opens: '10:00', closes: '10:00' }])).toContain(
      'iguais',
    );
  });

  it('refuses overlapping intervals, including one that runs past midnight into the next day', () => {
    expect(
      openingHoursProblem([
        { weekday: 1, opens: '11:00', closes: '15:00' },
        { weekday: 1, opens: '14:00', closes: '18:00' },
      ]),
    ).toContain('sobrepostos');
    expect(
      openingHoursProblem([
        { weekday: 5, opens: '18:00', closes: '02:00' },
        { weekday: 6, opens: '01:00', closes: '05:00' },
      ]),
    ).toContain('sobrepostos');
    // Saturday night runs into Sunday morning: the week is a circle.
    expect(
      openingHoursProblem([
        { weekday: 6, opens: '22:00', closes: '03:00' },
        { weekday: 0, opens: '02:00', closes: '04:00' },
      ]),
    ).toContain('sobrepostos');
  });

  it('allows touching intervals (one closes when the next opens)', () => {
    expect(
      openingHoursProblem([
        { weekday: 3, opens: '11:00', closes: '15:00' },
        { weekday: 3, opens: '15:00', closes: '18:00' },
      ]),
    ).toBeNull();
  });

  it('limits the number of intervals per day and in total', () => {
    const four = ['08:00', '10:00', '12:00', '14:00'].map((opens, i) => ({
      weekday: 4,
      opens,
      closes: ['09:00', '11:00', '13:00', '15:00'][i],
    }));
    expect(openingHoursProblem(four)).toContain('quinta');
    expect(
      openingHoursProblem(new Array(22).fill({ weekday: 0, opens: '10:00', closes: '11:00' })),
    ).toContain('21');
  });
});

describe('normalizeOpeningHours / readOpeningHours', () => {
  it('sorts by weekday and opening time', () => {
    const sorted = normalizeOpeningHours([
      { weekday: 2, opens: '18:00', closes: '23:00' },
      { weekday: 0, opens: '11:00', closes: '15:00' },
      { weekday: 2, opens: '11:00', closes: '15:00' },
    ]);
    expect(sorted.map((i) => `${i.weekday} ${i.opens}`)).toEqual(['0 11:00', '2 11:00', '2 18:00']);
  });

  it('reads null as "not informed" and an invalid stored value as "not informed" too', () => {
    expect(readOpeningHours(null)).toBeNull();
    expect(readOpeningHours('segunda a sexta')).toBeNull();
    expect(readOpeningHours([{ weekday: 1, opens: '10:00', closes: '10:00' }])).toBeNull();
    expect(readOpeningHours([])).toEqual([]);
  });
});

describe('isOpenAt', () => {
  const week: OpeningInterval[] = [
    { weekday: 1, opens: '11:00', closes: '15:00' },
    { weekday: 1, opens: '18:00', closes: '23:00' },
    { weekday: 5, opens: '18:00', closes: '02:00' },
    { weekday: 6, opens: '22:00', closes: '03:00' },
  ];

  it('is null when the hours were never informed, and false for a week with no interval', () => {
    expect(isOpenAt(null, new Date(), SP)).toBeNull();
    expect(isOpenAt([], new Date(), SP)).toBe(false);
  });

  it('follows the wall clock of the restaurant, opening inclusive and closing exclusive', () => {
    // 2026-10-19 is a Monday.
    expect(isOpenAt(week, sp('2026-10-19T10:59:00'), SP)).toBe(false);
    expect(isOpenAt(week, sp('2026-10-19T11:00:00'), SP)).toBe(true);
    expect(isOpenAt(week, sp('2026-10-19T14:59:00'), SP)).toBe(true);
    expect(isOpenAt(week, sp('2026-10-19T15:00:00'), SP)).toBe(false);
    expect(isOpenAt(week, sp('2026-10-19T16:30:00'), SP)).toBe(false);
    expect(isOpenAt(week, sp('2026-10-19T22:00:00'), SP)).toBe(true);
  });

  it('keeps Friday night open after midnight, on Saturday', () => {
    // 2026-10-24 is a Saturday.
    expect(isOpenAt(week, sp('2026-10-24T01:30:00'), SP)).toBe(true);
    expect(isOpenAt(week, sp('2026-10-24T02:00:00'), SP)).toBe(false);
  });

  it('wraps Saturday night into Sunday', () => {
    // 2026-10-25 is a Sunday.
    expect(isOpenAt(week, sp('2026-10-25T02:30:00'), SP)).toBe(true);
    expect(isOpenAt(week, sp('2026-10-25T03:00:00'), SP)).toBe(false);
  });

  it('uses the time zone of the restaurant, not the server', () => {
    // Monday 22:30 in São Paulo is Tuesday 01:30 in UTC (Tuesday has no interval) and Monday
    // 21:30 in Manaus (UTC-4, still inside 18:00-23:00).
    const instant = sp('2026-10-19T22:30:00');
    expect(isOpenAt(week, instant, SP)).toBe(true);
    expect(isOpenAt(week, instant, 'UTC')).toBe(false);
    expect(isOpenAt(week, instant, 'America/Manaus')).toBe(true);
  });

  it('falls back to São Paulo for an unknown zone', () => {
    expect(isOpenAt(week, sp('2026-10-19T12:00:00'), 'Not/AZone')).toBe(true);
  });
});

describe('acceptsOrdersAt (B1: the public checkout follows the same hours as the badge)', () => {
  const week: OpeningInterval[] = [
    { weekday: 1, opens: '11:00', closes: '15:00' },
    { weekday: 5, opens: '18:00', closes: '02:00' },
    { weekday: 6, opens: '22:00', closes: '03:00' },
  ];

  it('accepts while open and refuses while closed', () => {
    expect(acceptsOrdersAt(week, sp('2026-10-19T12:00:00'), SP)).toBe(true);
    expect(acceptsOrdersAt(week, sp('2026-10-19T16:00:00'), SP)).toBe(false);
    // Tuesday has no interval at all.
    expect(acceptsOrdersAt(week, sp('2026-10-20T12:00:00'), SP)).toBe(false);
  });

  it('accepts after midnight inside an interval that started the day before', () => {
    // Friday 18:00 to 02:00: Saturday 01:59 is still Friday night.
    expect(acceptsOrdersAt(week, sp('2026-10-23T23:59:00'), SP)).toBe(true);
    expect(acceptsOrdersAt(week, sp('2026-10-24T00:00:00'), SP)).toBe(true);
    expect(acceptsOrdersAt(week, sp('2026-10-24T01:59:00'), SP)).toBe(true);
    expect(acceptsOrdersAt(week, sp('2026-10-24T02:00:00'), SP)).toBe(false);
    // Saturday 22:00 to 03:00 runs into Sunday, the first day of the week.
    expect(acceptsOrdersAt(week, sp('2026-10-25T02:59:00'), SP)).toBe(true);
    expect(acceptsOrdersAt(week, sp('2026-10-25T03:00:00'), SP)).toBe(false);
  });

  it('places no restriction when the hours were never informed, and refuses an empty week', () => {
    expect(acceptsOrdersAt(null, sp('2026-10-20T04:00:00'), SP)).toBe(true);
    expect(acceptsOrdersAt([], sp('2026-10-19T12:00:00'), SP)).toBe(false);
  });
});
