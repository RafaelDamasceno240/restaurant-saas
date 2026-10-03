import { Injectable } from '@nestjs/common';
import { CouponDiscountType, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { CouponRules, evaluateCoupon } from './coupon-calculations';
import { couponRejected } from './coupon-errors';

type Db = Prisma.TransactionClient | PrismaService;

export interface CouponApplicationInput {
  tenantId: string;
  branchId: string;
  // Canonical code (trim + upper case). The callers normalize; this service never guesses.
  code: string;
  // Items subtotal computed by the SERVER, before any discount.
  subtotalCents: number;
  // Already validated by the caller (same tenant, active) - or null for a guest.
  customerId: string | null;
}

export interface AppliedCoupon {
  couponId: string;
  code: string;
  discountType: CouponDiscountType;
  discountCents: number;
}

interface CouponRow extends CouponRules {
  id: string;
  code: string;
}

// The one place that turns "a code typed by someone" into "a discount", for BOTH flows:
//   - preview(): read-only, no lock, no write. May be stale a moment later - that is normal.
//   - applyInTx(): inside the order transaction. Locks the coupon row FOR UPDATE, re-reads
//     and re-evaluates every rule on the LOCKED row, and only then consumes a usage.
// Both run the same pure evaluateCoupon(), so the rules cannot diverge.
//
// Concurrency strategy (decision): pessimistic row lock. SELECT ... FOR UPDATE on the active
// coupon serializes every order that uses the same coupon; the count of usages, the global
// limit and the per-customer limit are then checked and changed by exactly one transaction at
// a time. A plain "read usageCount, then increment" would let two orders both pass the check.
// The CHECK coupons_usage_within_limit is only the last barrier, never the rule. Orders that
// use different coupons (or none) never wait for each other. Lock order inside an order
// transaction is always: cash session (if any) -> coupon, so there is no deadlock cycle.
@Injectable()
export class CouponRedemptionService {
  constructor(private readonly prisma: PrismaService) {}

  // ---- read-only preview ------------------------------------------------------------------

  async preview(input: CouponApplicationInput, now: Date = new Date()): Promise<AppliedCoupon> {
    // Only the ACTIVE coupon with this code takes part: an inactive homonym is invisible here.
    const coupon = await this.prisma.coupon.findFirst({
      where: { tenantId: input.tenantId, code: input.code, active: true },
    });
    if (!coupon) throw couponRejected('NOT_FOUND');
    return this.evaluate(this.prisma, coupon, input, now);
  }

  // ---- applied inside the order transaction ----------------------------------------------

  // Locks, validates and returns the discount. Does NOT consume the usage yet: the order does
  // not exist, so call consumeInTx() right after creating it, in the SAME transaction.
  async applyInTx(
    tx: Prisma.TransactionClient,
    input: CouponApplicationInput,
    now: Date = new Date(),
  ): Promise<AppliedCoupon> {
    const rows = await tx.$queryRaw<CouponRow[]>`
      SELECT "id", "code", "discountType", "value", "minOrderCents", "maxDiscountCents",
             "startsAt", "endsAt", "active", "usageLimit", "usageCount", "perCustomerLimit", "branchId"
        FROM "coupons"
       WHERE "tenantId" = ${input.tenantId} AND "code" = ${input.code} AND "active" = true
         FOR UPDATE`;
    const coupon = rows[0];
    if (!coupon) throw couponRejected('NOT_FOUND');
    return this.evaluate(tx, coupon, input, now);
  }

  // Consumes one usage and writes the trail. Must run after applyInTx() in the same
  // transaction, so the row is still locked: the increment cannot race.
  async consumeInTx(
    tx: Prisma.TransactionClient,
    applied: AppliedCoupon,
    ctx: { tenantId: string; orderId: string; customerId: string | null },
  ): Promise<void> {
    await tx.coupon.update({
      where: { id: applied.couponId },
      data: { usageCount: { increment: 1 } },
    });
    await tx.couponRedemption.create({
      data: {
        tenantId: ctx.tenantId,
        couponId: applied.couponId,
        orderId: ctx.orderId,
        customerId: ctx.customerId,
        discountCents: applied.discountCents,
      },
    });
  }

  private async evaluate(
    db: Db,
    coupon: CouponRow,
    input: CouponApplicationInput,
    now: Date,
  ): Promise<AppliedCoupon> {
    const customerRedemptions =
      coupon.perCustomerLimit !== null && input.customerId
        ? await db.couponRedemption.count({
            where: { couponId: coupon.id, customerId: input.customerId },
          })
        : 0;
    const result = evaluateCoupon(coupon, {
      now,
      branchId: input.branchId,
      subtotalCents: input.subtotalCents,
      customerId: input.customerId,
      customerRedemptions,
    });
    if (!result.ok) throw couponRejected(result.reason);
    return {
      couponId: coupon.id,
      code: coupon.code,
      discountType: coupon.discountType,
      discountCents: result.discountCents,
    };
  }
}
