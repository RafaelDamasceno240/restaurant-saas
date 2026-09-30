import { DeliveryStatus } from '@prisma/client';

// Operational lifecycle of a delivery:
//
//   PENDING ──dispatch──▶ OUT_FOR_DELIVERY ──complete──▶ DELIVERED
//      ▲                        │
//      │                      fail
//      └──redeliver── FAILED ◀──┘
//
// CANCELLED is reached from PENDING (cancelling the order) or from FAILED (cancelling
// the order after a failed delivery). DELIVERED and CANCELLED are final. A failure never
// cancels anything by itself: the order goes back to READY and waits for a decision.
const DELIVERY_FLOW: Record<DeliveryStatus, DeliveryStatus[]> = {
  PENDING: ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED'],
  FAILED: ['PENDING', 'CANCELLED'],
  DELIVERED: [],
  CANCELLED: [],
};

export function isValidDeliveryTransition(from: DeliveryStatus, to: DeliveryStatus): boolean {
  return DELIVERY_FLOW[from].includes(to);
}

// Observation can be edited while the delivery is still alive.
export function canEditDeliveryNotes(status: DeliveryStatus): boolean {
  return status !== 'DELIVERED' && status !== 'CANCELLED';
}
