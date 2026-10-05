import { BadRequestException, ConflictException, HttpException, NotFoundException } from '@nestjs/common';

// Another tenant's entry is "not found" too: nothing about other tenants leaks.
export function cashbackEntryNotFound() {
  return new NotFoundException({ code: 'CASHBACK_ENTRY_NOT_FOUND', message: 'Movimentação não encontrada.' });
}

export function cashbackDisabled() {
  return new ConflictException({
    code: 'CASHBACK_DISABLED',
    message: 'O cashback está desativado neste restaurante.',
  });
}

export function insufficientCashback(balanceCents: number, neededCents: number) {
  return new ConflictException({
    code: 'CASHBACK_INSUFFICIENT_BALANCE',
    message: 'Saldo de cashback insuficiente.',
    details: { balanceCents, neededCents },
  });
}

// Cashback pays for items only: asking for more than the items cost (after the coupon) is a
// request the order cannot honour, whatever the balance.
export function cashbackExceedsOrder(maxCents: number) {
  return new BadRequestException({
    code: 'CASHBACK_EXCEEDS_ORDER',
    message: 'O cashback usado não pode ser maior que o valor dos itens do pedido.',
    details: { maxCents },
  });
}

export function cashbackCustomerRequired() {
  return new BadRequestException({
    code: 'CASHBACK_CUSTOMER_REQUIRED',
    message: 'Para usar cashback é preciso vincular um cliente cadastrado ao pedido.',
  });
}

export function cashbackBalanceLimit() {
  return new ConflictException({
    code: 'CASHBACK_BALANCE_LIMIT',
    message: 'O saldo de cashback ultrapassaria o limite permitido.',
  });
}

export function cashbackEntryAlreadyReversed() {
  return new ConflictException({
    code: 'CASHBACK_ENTRY_ALREADY_REVERSED',
    message: 'Esta movimentação já foi estornada.',
  });
}

export function cashbackEntryNotReversible(message: string) {
  return new ConflictException({ code: 'CASHBACK_ENTRY_NOT_REVERSIBLE', message });
}

export function cashbackIdempotencyKeyReused() {
  return new ConflictException({
    code: 'IDEMPOTENCY_KEY_REUSED',
    message: 'Esta chave de idempotência já foi usada em outra operação.',
  });
}

// An order that spent or earned cashback is tied, in the ledger, to the customer whose account
// moved. Changing the customer afterwards would leave money on the wrong account.
export function orderHasCashback() {
  return new ConflictException({
    code: 'ORDER_HAS_CASHBACK',
    message: 'Este pedido já movimentou cashback do cliente. Estorne ou cancele antes de trocar o cliente.',
  });
}

// Lets the order flow tell "this duplicate lost the race for the balance" from other failures.
export function isCashbackError(error: unknown): error is HttpException {
  if (!(error instanceof HttpException)) return false;
  const body = error.getResponse();
  return typeof body === 'object' && body !== null && String((body as { code?: unknown }).code ?? '').startsWith('CASHBACK_');
}
