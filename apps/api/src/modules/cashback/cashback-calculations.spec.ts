import {
  cashbackCreditWithinLimit,
  cashbackEarnBaseCents,
  cashbackExpiresAt,
  earnedCashbackCents,
  isCashbackExpired,
  MAX_CASHBACK_BALANCE_CENTS,
  maxUsableCashbackCents,
} from './cashback-calculations';

const base = (subtotalCents: number, discountCents = 0, cashbackUsedCents = 0) => ({ subtotalCents, discountCents, cashbackUsedCents });

describe('cashbackEarnBaseCents', () => {
  it('is what was paid for the items with real money', () => {
    expect(cashbackEarnBaseCents(base(10_000))).toBe(10_000);
    expect(cashbackEarnBaseCents(base(10_000, 1_500))).toBe(8_500);
    expect(cashbackEarnBaseCents(base(10_000, 1_500, 2_000))).toBe(6_500);
  });

  it('is zero when everything was covered by discount and cashback, and never negative', () => {
    expect(cashbackEarnBaseCents(base(10_000, 4_000, 6_000))).toBe(0);
    expect(cashbackEarnBaseCents(base(10_000, 9_000, 6_000))).toBe(0);
  });

  it('is zero for broken input', () => {
    expect(cashbackEarnBaseCents(base(0))).toBe(0);
    expect(cashbackEarnBaseCents(base(-100))).toBe(0);
    expect(cashbackEarnBaseCents(base(100, -1))).toBe(0);
    expect(cashbackEarnBaseCents(base(100, 0, -1))).toBe(0);
    expect(cashbackEarnBaseCents(base(100.5))).toBe(0);
  });
});

describe('earnedCashbackCents', () => {
  it('applies the rate in basis points', () => {
    expect(earnedCashbackCents(base(10_000), 500)).toBe(500); // 5%
    expect(earnedCashbackCents(base(10_000), 1)).toBe(1); // 0,01%
    expect(earnedCashbackCents(base(10_000), 5000)).toBe(5_000); // 50%
  });

  it('rounds down to the cent: never more than the stated percentage', () => {
    expect(earnedCashbackCents(base(2_599), 500)).toBe(129); // 129,95
    expect(earnedCashbackCents(base(199), 500)).toBe(9); // 9,95
    expect(earnedCashbackCents(base(19), 500)).toBe(0); // 0,95
  });

  it('does not give cashback on the part paid with cashback or discounted', () => {
    expect(earnedCashbackCents(base(10_000, 2_000, 3_000), 1000)).toBe(500);
    expect(earnedCashbackCents(base(10_000, 0, 10_000), 1000)).toBe(0);
  });

  it('is zero for an invalid rate and always a whole number inside the range', () => {
    expect(earnedCashbackCents(base(10_000), 0)).toBe(0);
    expect(earnedCashbackCents(base(10_000), 2.5)).toBe(0);
    const huge = earnedCashbackCents(base(2_147_483_647), 5000);
    expect(Number.isInteger(huge)).toBe(true);
    expect(huge).toBeLessThanOrEqual(MAX_CASHBACK_BALANCE_CENTS);
  });
});

describe('maxUsableCashbackCents', () => {
  it('is limited by the balance and by the items after the coupon', () => {
    expect(maxUsableCashbackCents({ subtotalCents: 5_000, discountCents: 0 }, 1_200)).toBe(1_200);
    expect(maxUsableCashbackCents({ subtotalCents: 5_000, discountCents: 0 }, 9_000)).toBe(5_000);
    expect(maxUsableCashbackCents({ subtotalCents: 5_000, discountCents: 4_000 }, 9_000)).toBe(1_000);
  });

  it('is zero without balance or when the coupon already covered everything', () => {
    expect(maxUsableCashbackCents({ subtotalCents: 5_000, discountCents: 0 }, 0)).toBe(0);
    expect(maxUsableCashbackCents({ subtotalCents: 5_000, discountCents: 5_000 }, 9_000)).toBe(0);
  });
});

describe('cashbackCreditWithinLimit', () => {
  it('trims a credit that would leave the range', () => {
    expect(cashbackCreditWithinLimit(100, 50)).toBe(50);
    expect(cashbackCreditWithinLimit(MAX_CASHBACK_BALANCE_CENTS - 10, 50)).toBe(10);
    expect(cashbackCreditWithinLimit(MAX_CASHBACK_BALANCE_CENTS, 50)).toBe(0);
  });
});

describe('expiration', () => {
  const last = new Date('2026-07-01T12:00:00.000Z');
  const state = { balanceCents: 1_000, lastActivityAt: last };

  it('never expires without a rule, without balance or without any activity', () => {
    expect(cashbackExpiresAt(state, null)).toBeNull();
    expect(cashbackExpiresAt({ balanceCents: 0, lastActivityAt: last }, 30)).toBeNull();
    expect(cashbackExpiresAt({ balanceCents: 1_000, lastActivityAt: null }, 30)).toBeNull();
    expect(isCashbackExpired(state, null, new Date('2030-01-01T00:00:00.000Z'))).toBe(false);
  });

  it('expires the given number of days after the last activity', () => {
    expect(cashbackExpiresAt(state, 30)).toEqual(new Date('2026-07-31T12:00:00.000Z'));
  });

  it('is valid strictly before the instant and expired at it', () => {
    expect(isCashbackExpired(state, 30, new Date('2026-07-31T11:59:59.999Z'))).toBe(false);
    expect(isCashbackExpired(state, 30, new Date('2026-07-31T12:00:00.000Z'))).toBe(true);
    expect(isCashbackExpired(state, 30, new Date('2026-12-01T00:00:00.000Z'))).toBe(true);
  });
});
