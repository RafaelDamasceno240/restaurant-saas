import { costToCents, lineTotalCents, monthRange, previewTotals, quantityToMilli } from './purchases-logic';

describe('quantityToMilli', () => {
  it('parses integers and up to three decimals', () => {
    expect(quantityToMilli('12')).toBe(12000);
    expect(quantityToMilli('12,5')).toBe(12500);
    expect(quantityToMilli('0.333')).toBe(333);
    expect(quantityToMilli(' 1,050 ')).toBe(1050);
  });

  it('rejects invalid input', () => {
    for (const value of ['', 'abc', '-1', '1,2345', '1.2.3', '1e3']) {
      expect(quantityToMilli(value)).toBeNull();
    }
  });
});

describe('costToCents', () => {
  it('parses reais into cents', () => {
    expect(costToCents('32')).toBe(3200);
    expect(costToCents('32,5')).toBe(3250);
    expect(costToCents('R$ 8,99')).toBe(899);
    expect(costToCents('0')).toBe(0);
  });

  it('rejects invalid input', () => {
    for (const value of ['', '-1', '1,234', 'abc']) {
      expect(costToCents(value)).toBeNull();
    }
  });
});

describe('lineTotalCents', () => {
  it('multiplies with half-up rounding like the backend', () => {
    expect(lineTotalCents(12500, 3200)).toBe(40000);
    expect(lineTotalCents(333, 100)).toBe(33);
    expect(lineTotalCents(5, 100)).toBe(1);
    expect(lineTotalCents(1500, 333)).toBe(500);
    expect(lineTotalCents(1000, 0)).toBe(0);
  });

  it('does not lose precision on large values', () => {
    expect(lineTotalCents(1_000_000_000, 100_000_000)).toBe(100_000_000_000_000);
  });
});

describe('previewTotals', () => {
  it('sums valid lines and applies adjustments', () => {
    const totals = previewTotals(
      [
        { quantity: '12,5', unitCost: '32' },
        { quantity: '2', unitCost: '8,99' },
      ],
      { discountCents: 500, freightCents: 1500, otherCostsCents: 250 },
    );
    expect(totals.lineTotals).toEqual([40000, 1798]);
    expect(totals.subtotalCents).toBe(41798);
    expect(totals.totalCents).toBe(43048);
  });

  it('ignores incomplete lines', () => {
    const totals = previewTotals(
      [
        { quantity: '', unitCost: '10' },
        { quantity: '3', unitCost: '5' },
      ],
      { discountCents: 0, freightCents: 0, otherCostsCents: 0 },
    );
    expect(totals.lineTotals).toEqual([null, 1500]);
    expect(totals.totalCents).toBe(1500);
  });
});

describe('monthRange', () => {
  it('returns the first and last day of the month', () => {
    expect(monthRange(new Date(2026, 1, 10))).toEqual({ from: '2026-02-01', to: '2026-02-28' });
    expect(monthRange(new Date(2028, 1, 10))).toEqual({ from: '2028-02-01', to: '2028-02-29' });
    expect(monthRange(new Date(2026, 9, 1))).toEqual({ from: '2026-10-01', to: '2026-10-31' });
  });
});
