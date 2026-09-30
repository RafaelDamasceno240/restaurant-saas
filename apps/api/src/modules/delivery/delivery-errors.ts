import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DeliveryStatus } from '@prisma/client';
import { CourierIneligibleReason } from './delivery-courier';

export function deliveryNotFound() {
  return new NotFoundException({ code: 'DELIVERY_NOT_FOUND', message: 'Entrega não encontrada.' });
}

export function deliveryUnavailable() {
  return new BadRequestException({
    code: 'DELIVERY_UNAVAILABLE',
    message: 'Este restaurante não está aceitando pedidos para entrega no momento.',
  });
}

export function deliveryMinOrderNotMet(minOrderCents: number) {
  return new BadRequestException({
    code: 'DELIVERY_MIN_ORDER_NOT_MET',
    message: 'O valor dos itens é menor que o pedido mínimo para entrega.',
    details: { minOrderCents },
  });
}

export function orderTotalTooLarge() {
  return new BadRequestException({
    code: 'ORDER_TOTAL_TOO_LARGE',
    message: 'O valor total do pedido excede o limite permitido.',
  });
}

export function invalidDeliveryTransition(from: DeliveryStatus, to: DeliveryStatus) {
  return new ConflictException({
    code: 'INVALID_DELIVERY_TRANSITION',
    message: `Não é possível mudar a entrega de "${from}" para "${to}".`,
  });
}

export function orderNotReadyForDispatch() {
  return new ConflictException({
    code: 'ORDER_NOT_READY_FOR_DISPATCH',
    message: 'O pedido precisa estar pronto para sair para entrega.',
  });
}

export function deliveryStateInconsistent() {
  return new ConflictException({
    code: 'DELIVERY_STATE_INCONSISTENT',
    message: 'O estado do pedido e da entrega não conferem. Atualize a tela e tente novamente.',
  });
}

// An order of fulfillmentType DELIVERY is finished by the delivery flow only.
export function deliveryFlowRequired() {
  return new ConflictException({
    code: 'DELIVERY_FLOW_REQUIRED',
    message: 'Pedidos de entrega são concluídos pela tela de Delivery (despachar e confirmar a entrega).',
  });
}

// The observation of a finished (delivered or cancelled) delivery is history: read-only.
export function deliveryNotesLocked() {
  return new ConflictException({
    code: 'DELIVERY_NOTES_LOCKED',
    message: 'A observação de uma entrega concluída ou cancelada não pode mais ser alterada.',
  });
}

// A user that does not exist in the caller's tenant is "not found" (nothing about other
// tenants leaks), as opposed to a user of the tenant that cannot work this delivery.
export function courierNotFound() {
  return new NotFoundException({ code: 'COURIER_NOT_FOUND', message: 'Entregador não encontrado.' });
}

const COURIER_REASON_MESSAGE: Record<CourierIneligibleReason, string> = {
  INACTIVE: 'Este usuário está inativo e não pode receber entregas.',
  NOT_COURIER: 'Este usuário não tem o papel de entregador.',
  NO_BRANCH_ACCESS: 'Este entregador não tem acesso à unidade desta entrega.',
};

export function courierNotEligible(reason: CourierIneligibleReason) {
  return new ConflictException({
    code: 'COURIER_NOT_ELIGIBLE',
    message: COURIER_REASON_MESSAGE[reason],
    details: { reason },
  });
}

// Once a delivery is delivered or cancelled, who was responsible is history.
export function deliveryAssignmentLocked() {
  return new ConflictException({
    code: 'DELIVERY_ASSIGNMENT_LOCKED',
    message: 'O entregador de uma entrega concluída ou cancelada não pode mais ser alterado.',
  });
}
