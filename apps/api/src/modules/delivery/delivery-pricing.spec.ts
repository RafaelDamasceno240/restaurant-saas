import { MAX_AMOUNT_CENTS, priceDelivery } from './delivery-pricing';

const on = { enabled: true, feeCents: 500, minOrderCents: 2000 };
const codeOf = (fn: () => unknown) => {
  try {
    fn();
  } catch (error) {
    return (error as { getResponse: () => { code: string; details?: unknown } }).getResponse();
  }
  return null;
};

describe('priceDelivery', () => {
  it('adds the fee to the subtotal, in integer cents', () => {
    expect(priceDelivery(3000, on)).toEqual({ deliveryFeeCents: 500, totalCents: 3500 });
  });

  it('accepts a subtotal exactly equal to the minimum order', () => {
    expect(priceDelivery(2000, on)).toEqual({ deliveryFeeCents: 500, totalCents: 2500 });
  });

  it('rejects a subtotal one cent below the minimum order, reporting the minimum', () => {
    expect(codeOf(() => priceDelivery(1999, on))).toMatchObject({
      code: 'DELIVERY_MIN_ORDER_NOT_MET',
      details: { minOrderCents: 2000 },
    });
  });

  it('compares the minimum against the items subtotal, not subtotal + fee', () => {
    expect(codeOf(() => priceDelivery(1600, { ...on, feeCents: 500 }))?.code).toBe('DELIVERY_MIN_ORDER_NOT_MET');
  });

  it('rejects when delivery is disabled, before looking at the minimum', () => {
    expect(codeOf(() => priceDelivery(1, { ...on, enabled: false }))?.code).toBe('DELIVERY_UNAVAILABLE');
  });

  it('supports a free delivery (fee 0) without a minimum', () => {
    expect(priceDelivery(1, { enabled: true, feeCents: 0, minOrderCents: 0 })).toEqual({
      deliveryFeeCents: 0,
      totalCents: 1,
    });
  });

  it('accepts a total of exactly 2_147_483_647 and rejects 2_147_483_648', () => {
    const settings = { enabled: true, feeCents: 1, minOrderCents: 0 };
    expect(priceDelivery(MAX_AMOUNT_CENTS - 1, settings).totalCents).toBe(MAX_AMOUNT_CENTS);
    expect(codeOf(() => priceDelivery(MAX_AMOUNT_CENTS, settings))?.code).toBe('ORDER_TOTAL_TOO_LARGE');
  });
});
