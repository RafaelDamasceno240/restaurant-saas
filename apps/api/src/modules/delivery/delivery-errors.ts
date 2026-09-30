import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { DeliveryStatus } from '@prisma/client';

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
