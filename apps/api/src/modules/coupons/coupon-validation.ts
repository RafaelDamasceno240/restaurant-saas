import { CouponDiscountType } from '@prisma/client';
import { CouponRules, MAX_AMOUNT_CENTS } from './coupon-calculations';

// Cross-field rules of a coupon, pure so they are unit-tested alone and used by the admin
// service on the MERGED state (current row + patch). The database repeats them as CHECKs.

export interface CouponShape {
  discountType: CouponDiscountType;
  value: number;
  minOrderCents: number;
  maxDiscountCents: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
}

export interface ShapeIssue {
  field: keyof CouponShape;
  message: string;
}

const isInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n);

export function validateCouponShape(shape: CouponShape): ShapeIssue[] {
  const issues: ShapeIssue[] = [];
  if (!isInt(shape.value)) {
    issues.push({ field: 'value', message: 'O valor do desconto deve ser um número inteiro.' });
  } else if (shape.discountType === 'PERCENTAGE') {
    if (shape.value < 1 || shape.value > 100) {
      issues.push({ field: 'value', message: 'O percentual deve ser um inteiro entre 1 e 100.' });
    }
  } else if (shape.value < 1 || shape.value > MAX_AMOUNT_CENTS) {
    issues.push({ field: 'value', message: 'O desconto fixo deve ser de pelo menos 1 centavo.' });
  }

  if (
    !isInt(shape.minOrderCents) ||
    shape.minOrderCents < 0 ||
    shape.minOrderCents > MAX_AMOUNT_CENTS
  ) {
    issues.push({
      field: 'minOrderCents',
      message: 'O valor mínimo do pedido não pode ser negativo.',
    });
  }

  if (shape.maxDiscountCents !== null) {
    if (shape.discountType !== 'PERCENTAGE') {
      issues.push({
        field: 'maxDiscountCents',
        message: 'O teto de desconto só existe para cupom percentual.',
      });
    } else if (
      !isInt(shape.maxDiscountCents) ||
      shape.maxDiscountCents < 1 ||
      shape.maxDiscountCents > MAX_AMOUNT_CENTS
    ) {
      issues.push({
        field: 'maxDiscountCents',
        message: 'O teto de desconto deve ser de pelo menos 1 centavo.',
      });
    }
  }

  if (shape.startsAt && shape.endsAt && shape.endsAt <= shape.startsAt) {
    issues.push({ field: 'endsAt', message: 'O término deve ser depois do início.' });
  }
  if (
    shape.usageLimit !== null &&
    (!isInt(shape.usageLimit) || shape.usageLimit < 1 || shape.usageLimit > MAX_AMOUNT_CENTS)
  ) {
    issues.push({
      field: 'usageLimit',
      message: 'O limite de utilizações deve ser de pelo menos 1.',
    });
  }
  if (
    shape.perCustomerLimit !== null &&
    (!isInt(shape.perCustomerLimit) ||
      shape.perCustomerLimit < 1 ||
      shape.perCustomerLimit > MAX_AMOUNT_CENTS)
  ) {
    issues.push({
      field: 'perCustomerLimit',
      message: 'O limite por cliente deve ser de pelo menos 1.',
    });
  }
  return issues;
}

// What the admin screen shows as the coupon situation. Derived on the server from the same
// fields the order flow uses, never stored. INACTIVE wins over the time/usage states.
export type CouponAvailability = 'INACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'EXHAUSTED' | 'AVAILABLE';

export function couponAvailability(
  rules: Pick<CouponRules, 'active' | 'startsAt' | 'endsAt' | 'usageLimit' | 'usageCount'>,
  now: Date,
): CouponAvailability {
  if (!rules.active) return 'INACTIVE';
  if (rules.startsAt && now < rules.startsAt) return 'SCHEDULED';
  if (rules.endsAt && now >= rules.endsAt) return 'EXPIRED';
  if (rules.usageLimit !== null && rules.usageCount >= rules.usageLimit) return 'EXHAUSTED';
  return 'AVAILABLE';
}
