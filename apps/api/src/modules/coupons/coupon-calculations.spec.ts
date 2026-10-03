import {
  calculateDiscountCents,
  computeOrderTotalCents,
  CouponContext,
  CouponRules,
  evaluateCoupon,
  MAX_AMOUNT_CENTS,
} from './coupon-calculations';
import { isValidCouponCode, normalizeCouponCode } from './coupon-input';

const NOW = new Date('2026-10-02T12:00:00.000Z');
const BRANCH = 'branch-1';

const rules = (over: Partial<CouponRules> = {}): CouponRules => ({
  discountType: 'PERCENTAGE',
  value: 10,
  minOrderCents: 0,
  maxDiscountCents: null,
  startsAt: null,
  endsAt: null,
  active: true,
  usageLimit: null,
  usageCount: 0,
  perCustomerLimit: null,
  branchId: null,
  ...over,
});
const ctx = (over: Partial<CouponContext> = {}): CouponContext => ({
  now: NOW,
  branchId: BRANCH,
  subtotalCents: 10_000,
  customerId: null,
  customerRedemptions: 0,
  ...over,
});

describe('normalizeCouponCode / isValidCouponCode', () => {
  it.each(['promo10', 'PROMO10', ' PROMO10 ', '\tpromo10\n', 'Promo10'])(
    '%j normalizes to PROMO10',
    (raw) => {
      expect(normalizeCouponCode(raw)).toBe('PROMO10');
      expect(isValidCouponCode(normalizeCouponCode(raw))).toBe(true);
    },
  );

  it('refuses shapes the database CHECK would refuse', () => {
    for (const bad of [
      '',
      'AB',
      'A'.repeat(33),
      'PRO MO',
      'PROMO%',
      'PROMÇ10',
      'PROMO.10',
      '10%OFF',
    ]) {
      expect(isValidCouponCode(normalizeCouponCode(bad))).toBe(false);
    }
    for (const good of ['ABC', 'A'.repeat(32), 'NATAL-2026', 'VOLTA_10', '2026']) {
      expect(isValidCouponCode(normalizeCouponCode(good))).toBe(true);
    }
  });
});

describe('calculateDiscountCents', () => {
  it('PERCENTAGE: whole percent over the subtotal, rounded down', () => {
    expect(calculateDiscountCents(rules(), 10_000)).toBe(1_000);
    expect(calculateDiscountCents(rules({ value: 15 }), 3_333)).toBe(499); // 499.95 -> 499
    expect(calculateDiscountCents(rules({ value: 100 }), 2_500)).toBe(2_500);
    expect(calculateDiscountCents(rules({ value: 1 }), 99)).toBe(0);
  });

  it('PERCENTAGE: maxDiscountCents caps the discount', () => {
    const r = rules({ value: 50, maxDiscountCents: 1_500 });
    expect(calculateDiscountCents(r, 10_000)).toBe(1_500);
    expect(calculateDiscountCents(r, 2_000)).toBe(1_000); // below the cap: untouched
  });

  it('FIXED: the value, never above the subtotal', () => {
    expect(calculateDiscountCents(rules({ discountType: 'FIXED', value: 500 }), 10_000)).toBe(500);
    expect(calculateDiscountCents(rules({ discountType: 'FIXED', value: 5_000 }), 1_200)).toBe(
      1_200,
    );
  });

  it('never exceeds the subtotal and never goes negative, whatever the input', () => {
    for (const subtotal of [0, 1, 99, 100, 12_345, MAX_AMOUNT_CENTS]) {
      for (const r of [
        rules({ value: 100 }),
        rules({ value: 100, maxDiscountCents: 5 }),
        rules({ discountType: 'FIXED', value: MAX_AMOUNT_CENTS }),
      ]) {
        const d = calculateDiscountCents(r, subtotal);
        expect(Number.isInteger(d)).toBe(true);
        expect(d).toBeGreaterThanOrEqual(0);
        expect(d).toBeLessThanOrEqual(subtotal);
      }
    }
    expect(calculateDiscountCents(rules(), -5)).toBe(0);
    expect(calculateDiscountCents(rules(), 10.5)).toBe(0);
  });

  it('does not lose precision near the 32-bit money ceiling', () => {
    expect(calculateDiscountCents(rules({ value: 100 }), MAX_AMOUNT_CENTS)).toBe(MAX_AMOUNT_CENTS);
    expect(calculateDiscountCents(rules({ value: 50 }), MAX_AMOUNT_CENTS)).toBe(
      Math.floor(MAX_AMOUNT_CENTS / 2),
    );
  });
});

describe('evaluateCoupon', () => {
  it('accepts a coupon that satisfies every rule', () => {
    expect(evaluateCoupon(rules(), ctx())).toEqual({ ok: true, discountCents: 1_000 });
  });

  it('refuses an inactive coupon', () => {
    expect(evaluateCoupon(rules({ active: false }), ctx())).toEqual({
      ok: false,
      reason: 'INACTIVE',
    });
  });

  it('refuses a coupon that has not started, and one that is over; the window is [start, end)', () => {
    const start = new Date('2026-10-03T00:00:00.000Z');
    const end = new Date('2026-10-01T00:00:00.000Z');
    expect(evaluateCoupon(rules({ startsAt: start }), ctx())).toEqual({
      ok: false,
      reason: 'NOT_STARTED',
    });
    expect(evaluateCoupon(rules({ endsAt: end }), ctx())).toEqual({ ok: false, reason: 'EXPIRED' });
    // exactly at startsAt: valid; exactly at endsAt: already over
    expect(evaluateCoupon(rules({ startsAt: NOW }), ctx()).ok).toBe(true);
    expect(evaluateCoupon(rules({ endsAt: NOW }), ctx())).toEqual({ ok: false, reason: 'EXPIRED' });
    expect(evaluateCoupon(rules({ endsAt: new Date(NOW.getTime() + 1) }), ctx()).ok).toBe(true);
  });

  it('enforces the minimum order on the subtotal BEFORE the discount', () => {
    expect(
      evaluateCoupon(rules({ minOrderCents: 10_000 }), ctx({ subtotalCents: 10_000 })).ok,
    ).toBe(true);
    expect(
      evaluateCoupon(rules({ minOrderCents: 10_001 }), ctx({ subtotalCents: 10_000 })),
    ).toEqual({
      ok: false,
      reason: 'MIN_ORDER_NOT_MET',
    });
  });

  it('branch-scoped coupons only apply at their branch; tenant-wide ones everywhere', () => {
    expect(evaluateCoupon(rules({ branchId: 'branch-2' }), ctx())).toEqual({
      ok: false,
      reason: 'WRONG_BRANCH',
    });
    expect(evaluateCoupon(rules({ branchId: BRANCH }), ctx()).ok).toBe(true);
    expect(evaluateCoupon(rules({ branchId: null }), ctx({ branchId: 'any' })).ok).toBe(true);
  });

  it('global limit: usageCount at the limit refuses, below it accepts', () => {
    expect(evaluateCoupon(rules({ usageLimit: 1, usageCount: 1 }), ctx())).toEqual({
      ok: false,
      reason: 'USAGE_LIMIT_REACHED',
    });
    expect(evaluateCoupon(rules({ usageLimit: 2, usageCount: 1 }), ctx()).ok).toBe(true);
    expect(evaluateCoupon(rules({ usageLimit: null, usageCount: 9_999 }), ctx()).ok).toBe(true);
  });

  it('per-customer limit needs a linked customer and counts that customer redemptions', () => {
    const r = rules({ perCustomerLimit: 2 });
    expect(evaluateCoupon(r, ctx({ customerId: null }))).toEqual({
      ok: false,
      reason: 'CUSTOMER_REQUIRED',
    });
    expect(evaluateCoupon(r, ctx({ customerId: 'c1', customerRedemptions: 1 })).ok).toBe(true);
    expect(evaluateCoupon(r, ctx({ customerId: 'c1', customerRedemptions: 2 }))).toEqual({
      ok: false,
      reason: 'CUSTOMER_LIMIT_REACHED',
    });
  });

  it('a coupon without per-customer limit works for guests too', () => {
    expect(evaluateCoupon(rules(), ctx({ customerId: null })).ok).toBe(true);
  });

  it('refuses a coupon that would discount nothing instead of burning a usage', () => {
    expect(evaluateCoupon(rules({ value: 1 }), ctx({ subtotalCents: 99 }))).toEqual({
      ok: false,
      reason: 'NO_DISCOUNT',
    });
    expect(evaluateCoupon(rules(), ctx({ subtotalCents: 0 }))).toEqual({
      ok: false,
      reason: 'NO_DISCOUNT',
    });
  });

  it('first failing rule wins, in the documented order', () => {
    const r = rules({
      active: false,
      endsAt: new Date('2020-01-01'),
      minOrderCents: 99_999,
      usageLimit: 1,
      usageCount: 1,
    });
    expect(evaluateCoupon(r, ctx())).toEqual({ ok: false, reason: 'INACTIVE' });
    expect(evaluateCoupon({ ...r, active: true }, ctx())).toEqual({ ok: false, reason: 'EXPIRED' });
    expect(evaluateCoupon({ ...r, active: true, endsAt: null }, ctx())).toEqual({
      ok: false,
      reason: 'MIN_ORDER_NOT_MET',
    });
  });
});

describe('computeOrderTotalCents', () => {
  it('total = subtotal - discount + delivery fee (the fee is never discounted)', () => {
    expect(computeOrderTotalCents(10_000, 1_000, 500)).toBe(9_500);
    expect(computeOrderTotalCents(10_000, 0, 0)).toBe(10_000);
    expect(computeOrderTotalCents(2_500, 2_500, 700)).toBe(700); // fully discounted items, fee stays
  });

  it('can never be negative: a discount above the subtotal is refused', () => {
    expect(() => computeOrderTotalCents(1_000, 1_001, 0)).toThrow(RangeError);
    expect(() => computeOrderTotalCents(1_000, -1, 0)).toThrow(RangeError);
    expect(() => computeOrderTotalCents(-1, 0, 0)).toThrow(RangeError);
    expect(() => computeOrderTotalCents(1_000, 0, -1)).toThrow(RangeError);
  });

  it('refuses fractions and totals beyond the 32-bit money column', () => {
    expect(() => computeOrderTotalCents(10.5, 0, 0)).toThrow(RangeError);
    expect(() => computeOrderTotalCents(MAX_AMOUNT_CENTS, 0, 1)).toThrow(RangeError);
    expect(computeOrderTotalCents(MAX_AMOUNT_CENTS, 1, 1)).toBe(MAX_AMOUNT_CENTS);
  });
});
