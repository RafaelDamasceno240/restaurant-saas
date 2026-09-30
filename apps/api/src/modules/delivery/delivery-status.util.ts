import { DeliveryStatus } from '@prisma/client';

// Operational lifecycle of a delivery: PENDING -> OUT_FOR_DELIVERY -> DELIVERED,
// or CANCELLED while still PENDING (driven by cancelling the order). FAILED and
// re-delivery are intentionally not part of this slice.
const DELIVERY_FLOW: Record<DeliveryStatus, DeliveryStatus[]> = {
  PENDING: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
};

export function isValidDeliveryTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return DELIVERY_FLOW[from].includes(to);
}
