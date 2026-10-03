import { CouponDiscountType } from '@prisma/client';

// Pure coupon rules and money arithmetic (integer cents, no float ever). This is the ONE
// definition of "does this coupon apply and for how much", used by the order creation
// (inside the transaction, on the locked row) and by the read-only preview.

// Money columns are 32-bit INTEGER cents.
export const MAX_AMOUNT_CENTS = 2_147_483_647;

export interface CouponRules {
  discountType: CouponDiscountType;
  value: number;
  minOrderCents: number;
  maxDiscountCents: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  active: boolean;
  usageLimit: number | null;
  usageCount: number;
  perCustomerLimit: number | null;
  branchId: string | null;
}

export interface CouponContext {
  now: Date;
  branchId: string;
  // Items subtotal BEFORE any discount. The delivery fee never takes part.
  subtotalCents: number;
  // Only a validated, same-tenant, active customer id - or null (guest checkout).
  customerId: string | null;
  // How many orders this customer already redeemed this coupon in (0 without customerId).
  customerRedemptions: number;
}

export type CouponFailureReason =
  | 'INACTIVE'
  | 'NOT_STARTED'
  | 'EXPIRED'
  | 'WRONG_BRANCH'
  | 'MIN_ORDER_NOT_MET'
  | 'CUSTOMER_REQUIRED'
  | 'USAGE_LIMIT_REACHED'
  | 'CUSTOMER_LIMIT_REACHED'
  | 'NO_DISCOUNT';

export type CouponEvaluation =
  { ok: true; discountCents: number } | { ok: false; reason: CouponFailureReason };

// Discount over the ITEMS subtotal, always whole cents, never above the subtotal.
//   PERCENTAGE: floor(subtotal * value / 100), then capped by maxDiscountCents.
//               Rounded DOWN, so the customer never gets more than the exact percentage.
//   FIXED:      value, capped by the subtotal.
export function calculateDiscountCents(
  rules: Pick<CouponRules, 'discountType' | 'value' | 'maxDiscountCents'>,
  subtotalCents: number,
): number {
  if (!Number.isInteger(subtotalCents) || subtotalCents < 0) return 0;
  let discount =
    rules.discountType === 'PERCENTAGE'
      ? Math.floor((subtotalCents * rules.value) / 100)
      : rules.value;
  if (rules.discountType === 'PERCENTAGE' && rules.maxDiscountCents !== null) {
    discount = Math.min(discount, rules.maxDiscountCents);
  }
  return Math.max(0, Math.min(discount, subtotalCents));
}

// Order of the checks is part of the contract (the first failure wins). The validity window
// is [startsAt, endsAt): it starts AT startsAt and is over AT endsAt.
export function evaluateCoupon(rules: CouponRules, ctx: CouponContext): CouponEvaluation {
  if (!rules.active) return { ok: false, reason: 'INACTIVE' };
  if (rules.startsAt && ctx.now < rules.startsAt) return { ok: false, reason: 'NOT_STARTED' };
  if (rules.endsAt && ctx.now >= rules.endsAt) return { ok: false, reason: 'EXPIRED' };
  if (rules.branchId !== null && rules.branchId !== ctx.branchId)
    return { ok: false, reason: 'WRONG_BRANCH' };
  if (ctx.subtotalCents < rules.minOrderCents) return { ok: false, reason: 'MIN_ORDER_NOT_MET' };
  if (rules.perCustomerLimit !== null && ctx.customerId === null)
    return { ok: false, reason: 'CUSTOMER_REQUIRED' };
  if (rules.usageLimit !== null && rules.usageCount >= rules.usageLimit) {
    return { ok: false, reason: 'USAGE_LIMIT_REACHED' };
  }
  if (rules.perCustomerLimit !== null && ctx.customerRedemptions >= rules.perCustomerLimit) {
    return { ok: false, reason: 'CUSTOMER_LIMIT_REACHED' };
  }
  const discountCents = calculateDiscountCents(rules, ctx.subtotalCents);
  // A coupon that would discount nothing is refused instead of silently burning a usage.
  if (discountCents < 1) return { ok: false, reason: 'NO_DISCOUNT' };
  return { ok: true, discountCents };
}

// The single formula for an order total. Throws on anything that would break the invariant,
// so a bug can never reach the database as a negative or inconsistent total.
export function computeOrderTotalCents(
  subtotalCents: number,
  discountCents: number,
  deliveryFeeCents: number,
): number {
  if (![subtotalCents, discountCents, deliveryFeeCents].every(Number.isInteger)) {
    throw new RangeError('order amounts must be integer cents');
  }
  if (
    subtotalCents < 0 ||
    deliveryFeeCents < 0 ||
    discountCents < 0 ||
    discountCents > subtotalCents
  ) {
    throw new RangeError('invalid order amounts');
  }
  const total = subtotalCents - discountCents + deliveryFeeCents;
  if (total < 0 || total > MAX_AMOUNT_CENTS) throw new RangeError('order total out of range');
  return total;
}
