import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';

// Another tenant's reward/entry is "not found" too: nothing about other tenants leaks.
export function rewardNotFound() {
  return new NotFoundException({ code: 'LOYALTY_REWARD_NOT_FOUND', message: 'Recompensa não encontrada.' });
}

export function entryNotFound() {
  return new NotFoundException({ code: 'LOYALTY_ENTRY_NOT_FOUND', message: 'Movimentação não encontrada.' });
}

export function rewardInactive() {
  return new ConflictException({ code: 'LOYALTY_REWARD_INACTIVE', message: 'Esta recompensa está inativa.' });
}

export function programDisabled() {
  return new ConflictException({
    code: 'LOYALTY_DISABLED',
    message: 'O programa de fidelidade está desativado neste restaurante.',
  });
}

export function insufficientPoints(balancePoints: number, neededPoints: number) {
  return new ConflictException({
    code: 'LOYALTY_INSUFFICIENT_POINTS',
    message: `Saldo insuficiente: ${balancePoints} ponto(s) disponível(is), ${neededPoints} necessário(s).`,
    details: { balancePoints, neededPoints },
  });
}

export function balanceLimitReached() {
  return new ConflictException({
    code: 'LOYALTY_BALANCE_LIMIT',
    message: 'O saldo de pontos ultrapassaria o limite permitido.',
  });
}

export function entryAlreadyReversed() {
  return new ConflictException({
    code: 'LOYALTY_ENTRY_ALREADY_REVERSED',
    message: 'Esta movimentação já foi estornada.',
  });
}

export function entryNotReversible() {
  return new ConflictException({
    code: 'LOYALTY_ENTRY_NOT_REVERSIBLE',
    message: 'Um estorno não pode ser estornado. Registre um ajuste.',
  });
}

export function idempotencyKeyReused() {
  return new ConflictException({
    code: 'IDEMPOTENCY_KEY_REUSED',
    message: 'Esta chave de idempotência já foi usada em outra operação.',
  });
}

export function invalidAdjustment() {
  return new BadRequestException({
    code: 'LOYALTY_INVALID_ADJUSTMENT',
    message: 'O ajuste deve ser um número inteiro de pontos, diferente de zero.',
  });
}

// An order whose points were credited belongs, for the ledger, to that customer. Changing the
// customer afterwards would leave points with someone the order no longer names.
export function orderHasLoyaltyPoints() {
  return new ConflictException({
    code: 'ORDER_HAS_LOYALTY_POINTS',
    message: 'Este pedido já gerou pontos de fidelidade. Estorne os pontos antes de trocar o cliente.',
  });
}
