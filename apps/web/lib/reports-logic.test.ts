import { reportQuery } from './reports-api';
import {
  activeHours,
  barPercent,
  daysInRange,
  describePeriod,
  formatBps,
  formatDayShort,
  formatHour,
  formatMinutes,
  formatQuantity,
  labelOf,
  maxOf,
  PAYMENT_METHOD_LABEL,
  peakHour,
  presetOf,
  presetRange,
  validateRange,
} from './reports-logic';

const TODAY = '2026-10-05';

describe('period presets', () => {
  it('turns each preset into calendar days', () => {
    expect(presetRange('today', TODAY)).toEqual({ from: '2026-10-05', to: '2026-10-05' });
    expect(presetRange('yesterday', TODAY)).toEqual({ from: '2026-10-04', to: '2026-10-04' });
    expect(presetRange('7d', TODAY)).toEqual({ from: '2026-09-29', to: '2026-10-05' });
    expect(presetRange('30d', TODAY)).toEqual({ from: '2026-09-06', to: '2026-10-05' });
    expect(presetRange('month', TODAY)).toEqual({ from: '2026-10-01', to: '2026-10-05' });
    expect(presetRange('lastMonth', TODAY)).toEqual({ from: '2026-09-01', to: '2026-09-30' });
  });

  it('handles the turn of the year and months of different lengths', () => {
    expect(presetRange('lastMonth', '2026-01-15')).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(presetRange('lastMonth', '2026-03-31')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(presetRange('lastMonth', '2028-03-01')).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(presetRange('yesterday', '2026-01-01')).toEqual({ from: '2025-12-31', to: '2025-12-31' });
    expect(presetRange('month', '2026-10-01')).toEqual({ from: '2026-10-01', to: '2026-10-01' });
  });

  it('recognises which preset two dates are, or that they are custom', () => {
    expect(presetOf({ from: '2026-09-29', to: '2026-10-05' }, TODAY)).toBe('7d');
    expect(presetOf({ from: '2026-09-01', to: '2026-09-30' }, TODAY)).toBe('lastMonth');
    expect(presetOf({ from: '2026-09-02', to: '2026-09-30' }, TODAY)).toBe('custom');
    // On the 1st, "today" and "this month" are the same days: the first match wins.
    expect(presetOf({ from: '2026-10-01', to: '2026-10-01' }, '2026-10-01')).toBe('today');
  });

  it('counts the days of a range, both ends included', () => {
    expect(daysInRange({ from: TODAY, to: TODAY })).toBe(1);
    expect(daysInRange({ from: '2026-09-06', to: '2026-10-05' })).toBe(30);
    expect(daysInRange({ from: '2025-10-05', to: '2026-10-05' })).toBe(366);
  });

  it('validates a range the way the API does', () => {
    expect(validateRange({ from: '2026-10-01', to: '2026-10-05' })).toBeNull();
    expect(validateRange({ from: '2025-10-05', to: '2026-10-05' })).toBeNull();
    expect(validateRange({ from: '', to: '2026-10-05' })).toMatch(/duas datas/);
    expect(validateRange({ from: '2026-02-30', to: '2026-10-05' })).toMatch(/duas datas/);
    expect(validateRange({ from: '2026-10-06', to: '2026-10-05' })).toMatch(/inicial/);
    expect(validateRange({ from: '2025-10-04', to: '2026-10-05' })).toMatch(/366 dias/);
  });
});

describe('formatting', () => {
  it('basis points as a percentage', () => {
    expect(formatBps(7742)).toBe('77,4%');
    expect(formatBps(10_000)).toBe('100,0%');
    expect(formatBps(0)).toBe('0,0%');
    expect(formatBps(null)).toBe('—');
  });

  it('minutes as a duration', () => {
    expect(formatMinutes(45)).toBe('45 min');
    expect(formatMinutes(60)).toBe('1 h 00 min');
    expect(formatMinutes(65)).toBe('1 h 05 min');
    expect(formatMinutes(0)).toBe('0 min');
    expect(formatMinutes(null)).toBe('—');
  });

  it('days, hours and quantities', () => {
    expect(formatDayShort('2026-10-05')).toBe('05/10');
    expect(formatDayShort('x')).toBe('x');
    expect(formatHour(7)).toBe('07h');
    expect(formatHour(23)).toBe('23h');
    expect(formatQuantity(0.45, 'KG')).toBe('0,45 kg');
    expect(formatQuantity(43, 'UNIT')).toBe('43 un');
    expect(formatQuantity(1.5, 'BOX')).toBe('1,5 BOX');
  });

  it('labels fall back to the raw key', () => {
    expect(labelOf(PAYMENT_METHOD_LABEL, 'ON_ACCOUNT')).toBe('Fiado');
    expect(labelOf(PAYMENT_METHOD_LABEL, 'VOUCHER')).toBe('VOUCHER');
  });

  it('describes the period', () => {
    expect(describePeriod({ from: '2026-10-01', to: '2026-10-05', days: 5 })).toBe('01/10/2026 a 05/10/2026 · 5 dias');
    expect(describePeriod({ from: '2026-10-05', to: '2026-10-05', days: 1 })).toBe('05/10/2026');
  });
});

describe('charts', () => {
  it('sizes a bar against the largest value, visible when above zero', () => {
    expect(barPercent(50, 100)).toBe(50);
    expect(barPercent(100, 100)).toBe(100);
    expect(barPercent(1, 1000)).toBe(2);
    expect(barPercent(0, 100)).toBe(0);
    expect(barPercent(10, 0)).toBe(0);
    expect(barPercent(-5, 100)).toBe(0);
    expect(barPercent(200, 100)).toBe(100);
  });

  it('finds the largest value', () => {
    expect(maxOf([{ v: 3 }, { v: 9 }, { v: 1 }], (row) => row.v)).toBe(9);
    expect(maxOf([] as { v: number }[], (row) => row.v)).toBe(0);
  });

  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, ordersCount: 0, totalCents: 0 }));
  const withSales = hours.map((row) => (row.hour === 12 ? { ...row, ordersCount: 4, totalCents: 9000 } : row.hour === 20 ? { ...row, ordersCount: 6, totalCents: 20000 } : row));

  it('the busiest hour is the one that sold the most', () => {
    expect(peakHour(withSales)).toEqual({ hour: 20, ordersCount: 6, totalCents: 20000 });
    expect(peakHour(hours)).toBeNull();
  });

  it('shows only the stretch of the day that had sales', () => {
    expect(activeHours(withSales).map((row) => row.hour)).toEqual([12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(activeHours(hours)).toEqual([]);
    const single = hours.map((row) => (row.hour === 23 ? { ...row, ordersCount: 1 } : row));
    expect(activeHours(single).map((row) => row.hour)).toEqual([23]);
  });
});

describe('reportQuery', () => {
  it('sends only what was filled in, encoded', () => {
    expect(reportQuery({ from: '2026-10-01', to: '2026-10-05', branchId: undefined, search: '', page: 2 })).toBe('?from=2026-10-01&to=2026-10-05&page=2');
    expect(reportQuery({ search: 'x&y=1 %' })).toBe('?search=x%26y%3D1+%25');
    expect(reportQuery({})).toBe('');
    expect(reportQuery({ branchId: null })).toBe('');
  });
});
