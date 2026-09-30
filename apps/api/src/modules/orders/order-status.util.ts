import { OrderStatus } from '@prisma/client';

// Covers the statuses the generic status endpoint may move an order through.
// OUT_FOR_DELIVERY/DELIVERED are deliberately absent: since Fase 10 they are
// set ONLY by DeliveryService (READY -> OUT_FOR_DELIVERY -> DELIVERED, in the
// same transaction as the delivery row). Any generic transition into or out of
// them falls through to the `?? []` below and is rejected.
const ORDER_STATUS_FLOW: Partial<Record<OrderStatus, OrderStatus[]>> = {
  PENDING: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PREPARING', 'CANCELLED'],
  PREPARING: ['READY', 'CANCELLED'],
  READY: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
};

export function isValidOrderStatusTransition(from: OrderStatus, to: OrderStatus): boolean {
  return (ORDER_STATUS_FLOW[from] ?? []).includes(to);
}
