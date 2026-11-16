// Pure loyalty arithmetic (integers only). The ONE definition of "how many points does this
// purchase earn", used by the order flow and unit-tested alone.

// Points columns are 32-bit integers; the balance is kept well inside that range.
export const MAX_POINTS_BALANCE = 2_000_000_000;
export const MAX_POINTS_PER_REAL = 1000;
export const MAX_ADJUSTMENT_POINTS = 1_000_000;

export interface EarnBase {
  // Items subtotal of the order, in cents, before any discount.
  subtotalCents: number;
  // Coupon discount over the items, in cents.
  discountCents: number;
}

// Rule (docs/LOYALTY.md): points are earned on what the customer actually paid for the ITEMS -
// subtotal minus discount; the delivery fee earns nothing - at `pointsPerReal` points for each
// WHOLE real. Cents below one real earn nothing (rounded down: the program never gives more
// than the stated rate).
export function earnedPoints(base: EarnBase, pointsPerReal: number): number {
  const { subtotalCents, discountCents } = base;
  if (![subtotalCents, discountCents, pointsPerReal].every(Number.isInteger)) return 0;
  if (pointsPerReal < 1 || subtotalCents <= 0 || discountCents < 0) return 0;
  const paidCents = subtotalCents - discountCents;
  if (paidCents < 100) return 0;
  const points = Math.floor(paidCents / 100) * pointsPerReal;
  return Math.min(points, MAX_POINTS_BALANCE);
}

// What can still be credited without the balance leaving its range (an absurdly large credit
// is trimmed instead of failing the sale that produced it).
export function creditWithinLimit(balance: number, points: number): number {
  return Math.max(0, Math.min(points, MAX_POINTS_BALANCE - balance));
}
