import { OrderStatus } from '@prisma/client';

// The sale is done and can no longer be cancelled: COMPLETED (counter, pickup, table) or
// DELIVERED (delivery). Both are terminal in the order flow (order-status.util.ts and the
// delivery flow), which is why benefits a customer EARNS from a purchase (points, cashback) are
// credited at this moment and never have to be taken back by a later cancellation.
export function isConcludedOrderStatus(status: OrderStatus): boolean {
  return status === 'COMPLETED' || status === 'DELIVERED';
}
