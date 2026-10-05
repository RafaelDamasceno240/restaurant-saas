import { BadRequestException, ConflictException, HttpException, NotFoundException } from '@nestjs/common';
import { TermsProblem } from './receivable-calculations';

// Another tenant's (or another branch's) receivable is "not found": nothing leaks.
export function receivableNotFound() {
  return new NotFoundException({ code: 'RECEIVABLE_NOT_FOUND', message: 'Conta a receber não encontrada.' });
}

export function receivableEntryNotFound() {
  return new NotFoundException({ code: 'RECEIVABLE_ENTRY_NOT_FOUND', message: 'Movimentação não encontrada.' });
}

export function creditCustomerRequired() {
  return new BadRequestException({
    code: 'RECEIVABLE_CUSTOMER_REQUIRED',
    message: 'Venda fiado exige um cliente cadastrado vinculado ao pedido.',
  });
}

export function creditNotAllowed() {
  return new ConflictException({
    code: 'RECEIVABLE_CREDIT_NOT_ALLOWED',
    message: 'Este cliente não tem limite de fiado. Defina um limite no cadastro do cliente.',
  });
}

export function creditLimitExceeded(details: { creditLimitCents: number; balanceCents: number; requestedCents: number }) {
  return new ConflictException({
    code: 'RECEIVABLE_LIMIT_EXCEEDED',
    message: 'Esta venda ultrapassa o limite de fiado do cliente.',
    details: { ...details, availableCents: Math.max(0, details.creditLimitCents - details.balanceCents) },
  });
}

export function customerOverdue(overdueCents: number) {
  return new ConflictException({
    code: 'RECEIVABLE_CUSTOMER_OVERDUE',
    message: 'Este cliente tem fiado vencido. Regularize antes de vender fiado novamente.',
    details: { overdueCents },
  });
}

export function nothingToCharge() {
  return new BadRequestException({
    code: 'RECEIVABLE_NOTHING_TO_CHARGE',
    message: 'Não há valor a receber nesta venda. Escolha outra forma de pagamento.',
  });
}

const TERMS_MESSAGE: Record<TermsProblem, string> = {
  INSTALLMENTS_RANGE: 'O número de parcelas deve ser de 1 a 12.',
  DUE_DATE_INVALID: 'Data de vencimento inválida.',
  DUE_DATE_PAST: 'O primeiro vencimento não pode ser anterior a hoje.',
  DUE_DATE_TOO_FAR: 'O primeiro vencimento deve ser em até um ano.',
  AMOUNT_TOO_SMALL: 'O valor é pequeno demais para esse número de parcelas.',
};

export function invalidTerms(problem: TermsProblem) {
  return new BadRequestException({ code: `RECEIVABLE_${problem}`, message: TERMS_MESSAGE[problem] });
}

export function receivableNotOpen() {
  return new ConflictException({
    code: 'RECEIVABLE_NOT_OPEN',
    message: 'Esta conta já está quitada ou cancelada.',
  });
}

export function overpayment(openCents: number) {
  return new ConflictException({
    code: 'RECEIVABLE_OVERPAYMENT',
    message: 'O valor é maior que o saldo em aberto.',
    details: { openCents },
  });
}

export function installmentNotFound() {
  return new NotFoundException({ code: 'RECEIVABLE_INSTALLMENT_NOT_FOUND', message: 'Parcela não encontrada nesta conta.' });
}

export function receivableHasPayments() {
  return new ConflictException({
    code: 'RECEIVABLE_HAS_PAYMENTS',
    message: 'Esta conta já recebeu pagamentos. Estorne os pagamentos antes de cancelar.',
  });
}

export function entryAlreadyReversed() {
  return new ConflictException({
    code: 'RECEIVABLE_ENTRY_ALREADY_REVERSED',
    message: 'Este pagamento já foi estornado.',
  });
}

export function entryNotReversible() {
  return new ConflictException({
    code: 'RECEIVABLE_ENTRY_NOT_REVERSIBLE',
    message: 'Somente pagamentos podem ser estornados. Para desfazer a dívida, cancele a conta.',
  });
}

export function refundBranchRequired() {
  return new BadRequestException({
    code: 'RECEIVABLE_REFUND_BRANCH_REQUIRED',
    message: 'Informe a unidade cujo caixa devolve o dinheiro deste pagamento.',
  });
}

export function receivableIdempotencyKeyReused() {
  return new ConflictException({
    code: 'IDEMPOTENCY_KEY_REUSED',
    message: 'Esta chave de idempotência já foi usada em outra operação.',
  });
}

// An order sold on account belongs, in the ledger, to the customer who owes it.
export function orderHasReceivable() {
  return new ConflictException({
    code: 'ORDER_HAS_RECEIVABLE',
    message: 'Este pedido foi vendido fiado e não pode trocar de cliente.',
  });
}

// Lets the order flow tell "this duplicate lost the race for the credit limit" from other failures.
export function isReceivableError(error: unknown): error is HttpException {
  if (!(error instanceof HttpException)) return false;
  const body = error.getResponse();
  return typeof body === 'object' && body !== null && String((body as { code?: unknown }).code ?? '').startsWith('RECEIVABLE_');
}
