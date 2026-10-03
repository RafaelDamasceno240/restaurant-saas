import {
  BadRequestException,
  ConflictException,
  HttpException,
  NotFoundException,
} from '@nestjs/common';
import { CouponFailureReason } from './coupon-calculations';

// Another tenant's coupon is "not found" too: nothing about other tenants leaks.
export function couponNotFound() {
  return new NotFoundException({ code: 'COUPON_NOT_FOUND', message: 'Cupom não encontrado.' });
}

export function couponCodeTaken(couponId?: string) {
  return new ConflictException({
    code: 'COUPON_CODE_TAKEN',
    message: 'Já existe um cupom ativo com este código.',
    ...(couponId ? { details: { couponId } } : {}),
  });
}

const REJECTIONS: Record<
  CouponFailureReason | 'NOT_FOUND',
  { status: 400 | 409; message: string }
> = {
  NOT_FOUND: { status: 400, message: 'Cupom inválido ou indisponível.' },
  INACTIVE: { status: 400, message: 'Este cupom está inativo.' },
  NOT_STARTED: { status: 400, message: 'Este cupom ainda não está válido.' },
  EXPIRED: { status: 400, message: 'Este cupom expirou.' },
  WRONG_BRANCH: { status: 400, message: 'Este cupom não vale para esta unidade.' },
  MIN_ORDER_NOT_MET: { status: 400, message: 'O valor dos itens é menor que o mínimo do cupom.' },
  CUSTOMER_REQUIRED: {
    status: 400,
    message: 'Este cupom exige um cliente cadastrado vinculado ao pedido.',
  },
  USAGE_LIMIT_REACHED: { status: 409, message: 'Este cupom atingiu o limite de utilizações.' },
  CUSTOMER_LIMIT_REACHED: {
    status: 409,
    message: 'Este cliente já atingiu o limite de utilizações deste cupom.',
  },
  NO_DISCOUNT: { status: 400, message: 'Este cupom não gera desconto neste pedido.' },
};

// Used by the ORDER and PREVIEW flows of the authenticated PDV: the staff of the tenant may
// know exactly why a coupon was refused. The public checkout collapses all of these, below.
export function couponRejected(
  reason: CouponFailureReason | 'NOT_FOUND',
  details?: Record<string, unknown>,
) {
  const entry = REJECTIONS[reason];
  const body = {
    code: `COUPON_${reason}`,
    message: entry.message,
    ...(details ? { details } : {}),
  };
  return entry.status === 409 ? new ConflictException(body) : new BadRequestException(body);
}

// The public checkout is anonymous: telling "no such code" from "expired" from "used up" would
// let anyone enumerate a restaurant's codes. Every coupon refusal looks the same there.
export const PUBLIC_COUPON_INVALID = {
  code: 'COUPON_INVALID',
  message: 'Cupom inválido ou não aplicável a este pedido.',
};

export function isCouponError(error: unknown): error is HttpException {
  if (!(error instanceof HttpException)) return false;
  const body = error.getResponse();
  return (
    typeof body === 'object' &&
    body !== null &&
    String((body as { code?: unknown }).code ?? '').startsWith('COUPON_')
  );
}

export function toPublicCouponError(error: unknown): unknown {
  return isCouponError(error) ? new BadRequestException({ ...PUBLIC_COUPON_INVALID }) : error;
}
