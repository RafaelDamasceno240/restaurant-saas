import { computeTabTotals } from './tab-calculations';

describe('computeTabTotals', () => {
  it('returns zeroes for an empty tab', () => {
    expect(computeTabTotals([])).toEqual({ subtotalCents: 0, totalCents: 0, itemCount: 0 });
  });

  it('sums unitPriceCentsSnapshot * quantity across items', () => {
    const totals = computeTabTotals([
      { unitPriceCentsSnapshot: 2990, quantity: 2 }, // 5980
      { unitPriceCentsSnapshot: 500, quantity: 3 }, // 1500
    ]);
    expect(totals.subtotalCents).toBe(7480);
    expect(totals.totalCents).toBe(7480);
    expect(totals.itemCount).toBe(5);
  });

  it('mirrors subtotal into total (no fee/discount yet)', () => {
    const totals = computeTabTotals([{ unitPriceCentsSnapshot: 1000, quantity: 1 }]);
    expect(totals.totalCents).toBe(totals.subtotalCents);
  });
});
