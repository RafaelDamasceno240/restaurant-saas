import {
  computeAverageCostCents,
  computeConsumption,
  computeMargin,
  convertQuantity,
  daysUntil,
  Decimal,
  displayQuantityIn,
  estimateEntriesOnHand,
  expiryStatus,
  lineCostCents,
  producibleUnits,
  statusConsumesStock,
  stockStatus,
  stockValueCents,
  toDisplay,
  toQuantity,
  UnitConversionError,
  wouldGoNegative,
} from './inventory-calculations';

const d = (v: string | number) => toQuantity(v);

describe('inventory-calculations', () => {
  describe('toQuantity', () => {
    it('keeps decimals exact', () => {
      expect(d(0.1).add(d(0.2)).equals(d('0.3'))).toBe(true);
      expect(d(0.03).mul(3).toFixed(3)).toBe('0.090');
      expect(toDisplay(d('0.150').mul(2))).toBe(0.3);
    });
  });

  describe('convertQuantity', () => {
    it('converts within the same family', () => {
      expect(convertQuantity(d(30), 'G', 'KG').toFixed(3)).toBe('0.030');
      expect(convertQuantity(d('0.150'), 'KG', 'G').toFixed(3)).toBe('150.000');
      expect(convertQuantity(d(250), 'ML', 'L').toFixed(3)).toBe('0.250');
      expect(convertQuantity(d(2), 'UNIT', 'UNIT').toFixed(3)).toBe('2.000');
    });

    it('rejects incompatible units', () => {
      expect(() => convertQuantity(d(1), 'UNIT', 'KG')).toThrow(UnitConversionError);
      expect(() => convertQuantity(d(1), 'L', 'G')).toThrow('INCOMPATIBLE_UNIT');
    });

    it('rejects results that need more than 3 decimals', () => {
      expect(() => convertQuantity(d('0.5'), 'G', 'KG')).toThrow('INVALID_PRECISION');
    });

    it('converts back for display', () => {
      expect(displayQuantityIn(d('0.150'), 'KG', 'G').toNumber()).toBe(150);
    });
  });

  describe('costs', () => {
    it('weights the average cost by quantity', () => {
      expect(computeAverageCostCents(d(10), 2000, d(10), 3000)).toBe(2500);
      expect(computeAverageCostCents(d(1), 1000, d(2), 1001)).toBe(1001);
    });

    it('ignores a zero or negative balance when averaging', () => {
      expect(computeAverageCostCents(d(0), 9999, d(5), 1200)).toBe(1200);
      expect(computeAverageCostCents(d(-3), 9999, d(5), 1200)).toBe(1200);
    });

    it('values stock and recipe lines in integer cents', () => {
      expect(stockValueCents(d('2.5'), 4290)).toBe(10725);
      expect(stockValueCents(d(-1), 4290)).toBe(0);
      expect(lineCostCents(d('0.150'), 4290)).toBe(644);
      expect(lineCostCents(d('0.030'), 5890)).toBe(177);
    });

    it('computes margin in cents and percent', () => {
      expect(computeMargin(2990, 966)).toEqual({ marginCents: 2024, marginPercent: 67.7 });
      expect(computeMargin(1000, 1200)).toEqual({ marginCents: -200, marginPercent: -20 });
      expect(computeMargin(0, 100)).toEqual({ marginCents: -100, marginPercent: null });
    });
  });

  describe('stockStatus', () => {
    it('derives OK, LOW_STOCK and OUT_OF_STOCK', () => {
      expect(stockStatus(d(10), d(2))).toBe('OK');
      expect(stockStatus(d(2), d(2))).toBe('LOW_STOCK');
      expect(stockStatus(d('1.5'), d(2))).toBe('LOW_STOCK');
      expect(stockStatus(d(0), d(2))).toBe('OUT_OF_STOCK');
      expect(stockStatus(d(-1), d(0))).toBe('OUT_OF_STOCK');
    });
  });

  describe('wouldGoNegative', () => {
    it('blocks only when negative stock is disabled', () => {
      expect(wouldGoNegative(d(5), d(-4), false)).toBe(false);
      expect(wouldGoNegative(d(5), d(-5), false)).toBe(false);
      expect(wouldGoNegative(d(5), d(-6), false)).toBe(true);
      expect(wouldGoNegative(d(5), d(-6), true)).toBe(false);
      expect(wouldGoNegative(d(-2), d(3), false)).toBe(false);
    });
  });

  describe('computeConsumption', () => {
    const recipes = new Map([
      [
        'burger',
        [
          { inventoryItemId: 'bread', quantity: d(1) },
          { inventoryItemId: 'meat', quantity: d('0.150') },
          { inventoryItemId: 'cheese', quantity: d('0.030') },
        ],
      ],
      [
        'toast',
        [
          { inventoryItemId: 'bread', quantity: d(2) },
          { inventoryItemId: 'cheese', quantity: d('0.050') },
        ],
      ],
    ]);

    it('multiplies the recipe by the quantity sold', () => {
      const meat = computeConsumption([{ productId: 'burger', quantity: 2 }], recipes).find(
        (r) => r.inventoryItemId === 'meat',
      );
      expect(meat?.quantity.toFixed(3)).toBe('0.300');
    });

    it('aggregates the same item across products, sorted by id', () => {
      const result = computeConsumption(
        [
          { productId: 'burger', quantity: 2 },
          { productId: 'toast', quantity: 1 },
          { productId: 'burger', quantity: 1 },
          { productId: 'no-recipe', quantity: 5 },
        ],
        recipes,
      );
      expect(result.map((r) => [r.inventoryItemId, r.quantity.toFixed(3)])).toEqual([
        ['bread', '5.000'],
        ['cheese', '0.140'],
        ['meat', '0.450'],
      ]);
    });

    it('returns nothing for products without a recipe', () => {
      expect(computeConsumption([{ productId: 'soda', quantity: 3 }], recipes)).toEqual([]);
    });
  });

  describe('producibleUnits', () => {
    it('is limited by the scarcest ingredient', () => {
      const recipe = [
        { inventoryItemId: 'bread', quantity: d(1) },
        { inventoryItemId: 'meat', quantity: d('0.150') },
      ];
      const balances = new Map<string, Decimal>([
        ['bread', d(40)],
        ['meat', d('1.000')],
      ]);
      expect(producibleUnits(recipe, balances)).toBe(6);
      expect(producibleUnits(recipe, new Map([['bread', d(40)]]))).toBe(0);
      expect(producibleUnits([], balances)).toBeNull();
    });
  });

  describe('statusConsumesStock', () => {
    it('consumes from CONFIRMED on, never while PENDING or CANCELLED', () => {
      expect(statusConsumesStock('PENDING')).toBe(false);
      expect(statusConsumesStock('CANCELLED')).toBe(false);
      for (const s of ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED']) {
        expect(statusConsumesStock(s)).toBe(true);
      }
    });
  });

  describe('expiry', () => {
    const now = new Date('2026-09-28T15:00:00Z');

    it('counts whole days', () => {
      expect(daysUntil(new Date('2026-09-28'), now)).toBe(0);
      expect(daysUntil(new Date('2026-10-05'), now)).toBe(7);
      expect(daysUntil(new Date('2026-09-27'), now)).toBe(-1);
    });

    it('classifies expired, expiring soon and ok', () => {
      expect(expiryStatus(new Date('2026-09-27'), now)).toBe('EXPIRED');
      expect(expiryStatus(new Date('2026-09-28'), now)).toBe('EXPIRING_SOON');
      expect(expiryStatus(new Date('2026-10-05'), now)).toBe('EXPIRING_SOON');
      expect(expiryStatus(new Date('2026-10-06'), now)).toBe('OK');
    });
  });

  describe('estimateEntriesOnHand', () => {
    const entry = (id: string, quantity: number, expiresAt: string | null) => ({
      id,
      quantity: d(quantity),
      expiresAt: expiresAt ? new Date(expiresAt) : null,
      lotCode: null,
    });

    it('attributes the current balance to the newest entries first', () => {
      const result = estimateEntriesOnHand(d(7), [entry('new', 5, '2026-10-20'), entry('old', 10, '2026-09-30')]);
      expect(result.map((r) => [r.id, r.onHand.toNumber()])).toEqual([
        ['new', 5],
        ['old', 2],
      ]);
    });

    it('drops entries already consumed', () => {
      const result = estimateEntriesOnHand(d(3), [entry('new', 5, null), entry('old', 10, '2026-09-30')]);
      expect(result.map((r) => r.id)).toEqual(['new']);
      expect(estimateEntriesOnHand(d(0), [entry('a', 1, null)])).toEqual([]);
    });
  });
});
