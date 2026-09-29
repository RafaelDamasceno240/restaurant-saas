import { OrderStatus } from '@prisma/client';

// Deliberately covers only the 6 statuses this slice operationally uses.
// OUT_FOR_DELIVERY/DELIVERED exist on the enum (added in fatia 04, reserved
// for the future Delivery slice) but have no entry here — any transition
// into or out of them falls through to the `?? []` below and is rejected,
// which is exactly "not implemented yet" without needing a second,
// narrower enum just for this check.
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
