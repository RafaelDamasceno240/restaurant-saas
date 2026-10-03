import { CouponShape, couponAvailability, validateCouponShape } from './coupon-validation';

const shape = (over: Partial<CouponShape> = {}): CouponShape => ({
  discountType: 'PERCENTAGE',
  value: 10,
  minOrderCents: 0,
  maxDiscountCents: null,
  startsAt: null,
  endsAt: null,
  usageLimit: null,
  perCustomerLimit: null,
  ...over,
});
const fields = (s: CouponShape) => validateCouponShape(s).map((i) => i.field);

describe('validateCouponShape', () => {
  it('accepts a plain percentage and a plain fixed coupon', () => {
    expect(validateCouponShape(shape())).toEqual([]);
    expect(validateCouponShape(shape({ discountType: 'FIXED', value: 500 }))).toEqual([]);
  });

  it('percentage must be a whole number from 1 to 100', () => {
    for (const value of [0, -1, 101, 10.5, Number.NaN]) {
      expect(fields(shape({ value }))).toEqual(['value']);
    }
    for (const value of [1, 50, 100]) expect(fields(shape({ value }))).toEqual([]);
  });

  it('fixed must be whole cents, at least 1 and within the 32-bit money column', () => {
    for (const value of [0, -100, 99.5, 2_147_483_648]) {
      expect(fields(shape({ discountType: 'FIXED', value }))).toEqual(['value']);
    }
    expect(fields(shape({ discountType: 'FIXED', value: 2_147_483_647 }))).toEqual([]);
  });

  it('the discount cap only exists for percentage coupons and must be positive', () => {
    expect(fields(shape({ maxDiscountCents: 1000 }))).toEqual([]);
    expect(fields(shape({ maxDiscountCents: 0 }))).toEqual(['maxDiscountCents']);
    expect(fields(shape({ discountType: 'FIXED', value: 500, maxDiscountCents: 1000 }))).toEqual([
      'maxDiscountCents',
    ]);
  });

  it('the minimum order cannot be negative or fractional', () => {
    expect(fields(shape({ minOrderCents: -1 }))).toEqual(['minOrderCents']);
    expect(fields(shape({ minOrderCents: 10.5 }))).toEqual(['minOrderCents']);
    expect(fields(shape({ minOrderCents: 5000 }))).toEqual([]);
  });

  it('the validity window must end after it starts', () => {
    const a = new Date('2026-10-01T00:00:00Z');
    const b = new Date('2026-10-02T00:00:00Z');
    expect(fields(shape({ startsAt: a, endsAt: b }))).toEqual([]);
    expect(fields(shape({ startsAt: b, endsAt: a }))).toEqual(['endsAt']);
    expect(fields(shape({ startsAt: a, endsAt: a }))).toEqual(['endsAt']);
    expect(fields(shape({ startsAt: a }))).toEqual([]);
    expect(fields(shape({ endsAt: a }))).toEqual([]);
  });

  it('the usage limits are at least 1 when present', () => {
    expect(fields(shape({ usageLimit: 0 }))).toEqual(['usageLimit']);
    expect(fields(shape({ perCustomerLimit: 0 }))).toEqual(['perCustomerLimit']);
    expect(fields(shape({ usageLimit: 1, perCustomerLimit: 1 }))).toEqual([]);
  });

  it('reports every problem, not only the first', () => {
    expect(fields(shape({ value: 0, minOrderCents: -1, usageLimit: 0 })).sort()).toEqual([
      'minOrderCents',
      'usageLimit',
      'value',
    ]);
  });
});

describe('couponAvailability', () => {
  const now = new Date('2026-10-02T12:00:00Z');
  const r = (over: object = {}) => ({
    active: true,
    startsAt: null,
    endsAt: null,
    usageLimit: null,
    usageCount: 0,
    ...over,
  });

  it('derives the situation from the same fields the order flow uses', () => {
    expect(couponAvailability(r(), now)).toBe('AVAILABLE');
    expect(couponAvailability(r({ active: false }), now)).toBe('INACTIVE');
    expect(couponAvailability(r({ startsAt: new Date('2026-10-03T00:00:00Z') }), now)).toBe(
      'SCHEDULED',
    );
    expect(couponAvailability(r({ endsAt: new Date('2026-10-01T00:00:00Z') }), now)).toBe(
      'EXPIRED',
    );
    expect(couponAvailability(r({ endsAt: now }), now)).toBe('EXPIRED'); // the window is [start, end)
    expect(couponAvailability(r({ usageLimit: 2, usageCount: 2 }), now)).toBe('EXHAUSTED');
    expect(couponAvailability(r({ usageLimit: 2, usageCount: 1 }), now)).toBe('AVAILABLE');
  });

  it('inactive wins over every other state', () => {
    expect(
      couponAvailability(
        r({
          active: false,
          endsAt: new Date('2020-01-01T00:00:00Z'),
          usageLimit: 1,
          usageCount: 1,
        }),
        now,
      ),
    ).toBe('INACTIVE');
  });
});
