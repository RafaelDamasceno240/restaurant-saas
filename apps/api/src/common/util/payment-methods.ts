import { BadRequestException } from '@nestjs/common';
import { PaymentMethod } from '@prisma/client';

// How a NEW sale can be paid, in every channel (PDV, table checkout, public checkout): money that
// is received now. Selling on account (fiado, PaymentMethod.ON_ACCOUNT) was turned off by the
// owner's decision (remocao-fiado, 2026-11-12). The enum value stays: it describes the sales and
// receivables that already exist, which keep being listed, reported, received and cancelled.
export const SALE_PAYMENT_METHODS: PaymentMethod[] = ['CASH', 'PIX', 'CARD'];

export const ON_ACCOUNT_DISABLED_MESSAGE =
  'Venda fiado não é mais aceita. Use dinheiro, PIX ou cartão.';

export function onAccountDisabled(): BadRequestException {
  return new BadRequestException({
    code: 'ON_ACCOUNT_DISABLED',
    message: ON_ACCOUNT_DISABLED_MESSAGE,
  });
}
