import { activeUnits, computeTabTotals, productOverTabUnitLimit, roundSignature } from './tab-calculations';

describe('computeTabTotals', () => {
  it('returns zeroes for an empty tab', () => {
    expect(computeTabTotals([])).toEqual({ subtotalCents: 0, totalCents: 0, itemCount: 0 });
  });

  it('sums unitPriceCentsSnapshot * quantity across items', () => {
    const totals = computeTabTotals([
      { unitPriceCentsSnapshot: 2990, quantity: 2, cancelledQuantity: 0 }, // 5980
      { unitPriceCentsSnapshot: 500, quantity: 3, cancelledQuantity: 0 }, // 1500
    ]);
    expect(totals.subtotalCents).toBe(7480);
    expect(totals.totalCents).toBe(7480);
    expect(totals.itemCount).toBe(5);
  });

  it('mirrors subtotal into total (no fee/discount yet)', () => {
    const totals = computeTabTotals([{ unitPriceCentsSnapshot: 1000, quantity: 1, cancelledQuantity: 0 }]);
    expect(totals.totalCents).toBe(totals.subtotalCents);
  });

  it('B9: charges and counts only the units that were not cancelled', () => {
    const totals = computeTabTotals([
      { unitPriceCentsSnapshot: 2500, quantity: 3, cancelledQuantity: 1 }, // 2 x 2500
      { unitPriceCentsSnapshot: 900, quantity: 2, cancelledQuantity: 2 }, // all cancelled
    ]);
    expect(totals).toEqual({ subtotalCents: 5000, totalCents: 5000, itemCount: 2 });
  });
});

describe('activeUnits', () => {
  it('is the quantity minus the cancelled units', () => {
    expect(activeUnits({ quantity: 3, cancelledQuantity: 0 })).toBe(3);
    expect(activeUnits({ quantity: 3, cancelledQuantity: 2 })).toBe(1);
    expect(activeUnits({ quantity: 3, cancelledQuantity: 3 })).toBe(0);
  });
});

describe('roundSignature', () => {
  it('ignores the order of the lines', () => {
    const a = { productId: 'p1', quantity: 2, notes: 'sem cebola' };
    const b = { productId: 'p2', quantity: 1, notes: null };
    expect(roundSignature([a, b])).toBe(roundSignature([b, a]));
  });

  it('tells apart a different quantity, product or note', () => {
    const base = roundSignature([{ productId: 'p1', quantity: 2, notes: null }]);
    expect(roundSignature([{ productId: 'p1', quantity: 3, notes: null }])).not.toBe(base);
    expect(roundSignature([{ productId: 'p2', quantity: 2, notes: null }])).not.toBe(base);
    expect(roundSignature([{ productId: 'p1', quantity: 2, notes: 'bem passado' }])).not.toBe(base);
  });
});

describe('productOverTabUnitLimit', () => {
  it('counts the active units already on the tab plus the round', () => {
    const existing = [{ productId: 'p1', quantity: 30, cancelledQuantity: 0 }];
    expect(productOverTabUnitLimit(existing, [{ productId: 'p1', quantity: 20 }], 50)).toBeNull();
    expect(productOverTabUnitLimit(existing, [{ productId: 'p1', quantity: 21 }], 50)).toBe('p1');
  });

  it('does not count cancelled units', () => {
    const existing = [{ productId: 'p1', quantity: 50, cancelledQuantity: 10 }];
    expect(productOverTabUnitLimit(existing, [{ productId: 'p1', quantity: 10 }], 50)).toBeNull();
    expect(productOverTabUnitLimit(existing, [{ productId: 'p1', quantity: 11 }], 50)).toBe('p1');
  });

  it('adds up the same product over several lines of the round', () => {
    const round = [
      { productId: 'p1', quantity: 30 },
      { productId: 'p2', quantity: 50 },
      { productId: 'p1', quantity: 21 },
    ];
    expect(productOverTabUnitLimit([], round, 50)).toBe('p1');
  });
});
