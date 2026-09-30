import { Decimal, toQuantity } from '../inventory/inventory-calculations';
import { assertTotalsWithinLimit, computePurchaseTotals, MAX_AMOUNT_CENTS } from './purchase-calculations';

const none = { discountCents: 0, freightCents: 0, otherCostsCents: 0 };
const line = (quantity: number | string, unitCostCents: number) => ({ quantity: toQuantity(quantity), unitCostCents });

describe('computePurchaseTotals', () => {
  it('multiplies fractional quantity by unit cost', () => {
    const totals = computePurchaseTotals([line(12.5, 3200)], none);
    expect(totals.lineTotals).toEqual([40000]);
    expect(totals.subtotalCents).toBe(40000);
    expect(totals.totalCents).toBe(40000);
  });

  it('rounds each line half up to whole cents', () => {
    expect(computePurchaseTotals([line('0.333', 100)], none).lineTotals).toEqual([33]);
    expect(computePurchaseTotals([line('0.005', 100)], none).lineTotals).toEqual([1]);
    expect(computePurchaseTotals([line('1.5', 333)], none).lineTotals).toEqual([500]);
  });

  it('sums lines into the subtotal', () => {
    const totals = computePurchaseTotals([line(2, 1500), line('0.75', 4000), line(1, 0)], none);
    expect(totals.lineTotals).toEqual([3000, 3000, 0]);
    expect(totals.subtotalCents).toBe(6000);
  });

  it('applies discount, freight and other costs to the total only', () => {
    const totals = computePurchaseTotals([line(10, 1000)], { discountCents: 500, freightCents: 1200, otherCostsCents: 300 });
    expect(totals.subtotalCents).toBe(10000);
    expect(totals.totalCents).toBe(11000);
  });

  it('accepts a zero-cost line', () => {
    const totals = computePurchaseTotals([line(3, 0)], none);
    expect(totals.totalCents).toBe(0);
  });

  it('reports a negative total when the discount exceeds everything else', () => {
    const totals = computePurchaseTotals([line(1, 1000)], { discountCents: 1500, freightCents: 100, otherCostsCents: 0 });
    expect(totals.totalCents).toBe(-400);
  });

  it('returns whole integer cents even for awkward decimals', () => {
    const totals = computePurchaseTotals([line('0.001', 999), line('7.777', 1234)], none);
    for (const value of [...totals.lineTotals, totals.subtotalCents, totals.totalCents]) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });

  it('uses Decimal precision, not floating point', () => {
    const totals = computePurchaseTotals([line('0.1', 300), line('0.2', 300)], none);
    expect(totals.subtotalCents).toBe(90);
    expect(new Decimal('0.1').add('0.2').toString()).toBe('0.3');
  });

  it('handles an empty list', () => {
    expect(computePurchaseTotals([], { discountCents: 0, freightCents: 250, otherCostsCents: 0 })).toEqual({
      lineTotals: [],
      subtotalCents: 0,
      totalCents: 250,
    });
  });
});

describe('assertTotalsWithinLimit', () => {
  const check = (lines: ReturnType<typeof line>[], adjustments = none) =>
    assertTotalsWithinLimit(computePurchaseTotals(lines, adjustments));
  const codeOf = (fn: () => void) => {
    try {
      fn();
    } catch (error) {
      return (error as { getResponse: () => { code: string; details: { field: string } } }).getResponse();
    }
    return null;
  };

  it('uses the 32-bit signed INTEGER ceiling', () => {
    expect(MAX_AMOUNT_CENTS).toBe(2_147_483_647);
  });

  it('accepts a line of exactly 2_147_483_647 cents', () => {
    expect(() => check([line(1, 2_147_483_647)])).not.toThrow();
  });

  it('rejects a line of 2_147_483_648 cents', () => {
    expect(codeOf(() => check([line(1, 2_147_483_648)]))).toMatchObject({
      code: 'PURCHASE_AMOUNT_TOO_LARGE',
      details: { field: 'line' },
    });
  });

  it('rejects the DTO maximum (quantity 1_000_000 x cost 100_000_000) instead of reaching the database', () => {
    expect(codeOf(() => check([line(1_000_000, 100_000_000)]))?.code).toBe('PURCHASE_AMOUNT_TOO_LARGE');
  });

  it('accepts a subtotal of exactly 2_147_483_647 spread over several lines', () => {
    expect(() => check([line(1, 2_000_000_000), line(1, 147_483_647)])).not.toThrow();
  });

  it('rejects a subtotal above the limit even when every line fits', () => {
    expect(codeOf(() => check([line(1, 2_000_000_000), line(1, 147_483_648)]))).toMatchObject({
      code: 'PURCHASE_AMOUNT_TOO_LARGE',
      details: { field: 'subtotal' },
    });
  });

  it('accepts a total of exactly 2_147_483_647 reached through freight', () => {
    expect(() => check([line(1, 2_000_000_000)], { ...none, freightCents: 147_483_647 })).not.toThrow();
  });

  it('rejects a total above the limit when subtotal and lines fit', () => {
    expect(codeOf(() => check([line(1, 2_000_000_000)], { ...none, freightCents: 147_483_648 }))).toMatchObject({
      code: 'PURCHASE_AMOUNT_TOO_LARGE',
      details: { field: 'total' },
    });
  });

  it('accepts a total within the limit when a discount brings it back under', () => {
    expect(() =>
      check([line(1, 2_147_483_647)], { discountCents: 100, freightCents: 50, otherCostsCents: 0 }),
    ).not.toThrow();
  });

  it('rejects when other costs alone push the total over the limit', () => {
    expect(codeOf(() => check([line(1, 2_147_483_647)], { ...none, otherCostsCents: 1 }))).toMatchObject({
      details: { field: 'total' },
    });
  });
});
