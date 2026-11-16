// Pure cashback arithmetic: integer cents, no float ever. The ONE definition of "how much does
// this purchase give back", "how much of the balance may pay for this order" and "has this
// balance expired", used by the order flow and unit-tested alone.

// Money columns are 32-bit INTEGER cents; the balance is kept well inside that range.
export const MAX_CASHBACK_BALANCE_CENTS = 2_000_000_000;
// 5000 basis points = 50%: nobody gives back more than half of a sale by accident.
export const MAX_EARN_RATE_BPS = 5000;
export const MAX_EXPIRE_AFTER_DAYS = 3650;
// R$ 100.000,00 per manual adjustment.
export const MAX_ADJUSTMENT_CENTS = 10_000_000;

const DAY_MS = 86_400_000;

export interface CashbackEarnBase {
  // Items subtotal, in cents, before any discount.
  subtotalCents: number;
  // Coupon discount over the items.
  discountCents: number;
  // Cashback balance spent on this same order.
  cashbackUsedCents: number;
}

// What the customer actually paid for the ITEMS with real money: the delivery fee gives nothing
// back, and neither does the part of the order that was itself paid with cashback (otherwise a
// balance would breed more balance).
export function cashbackEarnBaseCents(base: CashbackEarnBase): number {
  const { subtotalCents, discountCents, cashbackUsedCents } = base;
  if (![subtotalCents, discountCents, cashbackUsedCents].every(Number.isInteger)) return 0;
  if (subtotalCents <= 0 || discountCents < 0 || cashbackUsedCents < 0) return 0;
  return Math.max(0, subtotalCents - discountCents - cashbackUsedCents);
}

// floor(base * rate / 10000): rounded DOWN to the cent, so the program never gives back more
// than the stated percentage. Largest product is ~2.1e9 * 5000, far below 2^53.
export function earnedCashbackCents(base: CashbackEarnBase, earnRateBps: number): number {
  if (!Number.isInteger(earnRateBps) || earnRateBps < 1) return 0;
  const cents = Math.floor((cashbackEarnBaseCents(base) * earnRateBps) / 10_000);
  return Math.min(cents, MAX_CASHBACK_BALANCE_CENTS);
}

// How much of a balance may pay for an order: never more than the balance, never more than the
// items after the coupon (cashback does not pay the delivery fee, and a total is never negative).
export function maxUsableCashbackCents(
  order: { subtotalCents: number; discountCents: number },
  balanceCents: number,
): number {
  const itemsCents = order.subtotalCents - order.discountCents;
  if (![itemsCents, balanceCents].every(Number.isInteger)) return 0;
  return Math.max(0, Math.min(balanceCents, itemsCents));
}

// What can still be credited without the balance leaving its range.
export function cashbackCreditWithinLimit(balanceCents: number, amountCents: number): number {
  return Math.max(0, Math.min(amountCents, MAX_CASHBACK_BALANCE_CENTS - balanceCents));
}

export interface ExpirationState {
  balanceCents: number;
  // Last credit or use; null when the account never had one.
  lastActivityAt: Date | null;
}

// The instant the whole balance expires, or null when it does not (no rule, no balance, or an
// account that never had activity).
export function cashbackExpiresAt(state: ExpirationState, expireAfterDays: number | null): Date | null {
  if (expireAfterDays === null || state.balanceCents <= 0 || !state.lastActivityAt) return null;
  return new Date(state.lastActivityAt.getTime() + expireAfterDays * DAY_MS);
}

// Expired AT the instant, like the coupon window: the balance is valid strictly before it.
export function isCashbackExpired(state: ExpirationState, expireAfterDays: number | null, now: Date): boolean {
  const expiresAt = cashbackExpiresAt(state, expireAfterDays);
  return expiresAt !== null && now >= expiresAt;
}
