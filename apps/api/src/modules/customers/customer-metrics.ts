import { OrderStatus } from '@prisma/client';

// Which orders count as a customer's purchases. The system has exactly one existing rule
// for "sale" on the order level: the dashboard (`use-dashboard-stats.ts`) counts every order
// that is NOT cancelled. The CRM follows it, so the figure a manager sees for a customer
// never contradicts the dashboard. A not-yet-delivered order therefore counts from the
// moment it exists; a cancelled one never does (it is shown separately as `cancelledCount`).
// A FAILED delivery keeps its order READY (Fase 10), so it still counts until cancelled.
export function isBillableOrderStatus(status: OrderStatus): boolean {
  return status !== 'CANCELLED';
}

export interface StatusGroup {
  status: OrderStatus;
  count: number;
  totalCents: number;
  lastOrderAt: Date | null;
}

export interface CustomerMetrics {
  ordersCount: number;
  cancelledCount: number;
  totalSpentCents: number;
  // Integer cents, rounded half up (money is never fractional).
  averageTicketCents: number;
  lastOrderAt: Date | null;
}

export const EMPTY_METRICS: CustomerMetrics = {
  ordersCount: 0,
  cancelledCount: 0,
  totalSpentCents: 0,
  averageTicketCents: 0,
  lastOrderAt: null,
};

// Derived from a `groupBy status` over the customer's orders; nothing is stored.
export function buildMetrics(groups: readonly StatusGroup[]): CustomerMetrics {
  let ordersCount = 0;
  let cancelledCount = 0;
  let totalSpentCents = 0;
  let lastOrderAt: Date | null = null;
  for (const group of groups) {
    if (!isBillableOrderStatus(group.status)) {
      cancelledCount += group.count;
      continue;
    }
    ordersCount += group.count;
    totalSpentCents += group.totalCents;
    if (group.lastOrderAt && (!lastOrderAt || group.lastOrderAt > lastOrderAt)) lastOrderAt = group.lastOrderAt;
  }
  return {
    ordersCount,
    cancelledCount,
    totalSpentCents,
    averageTicketCents: ordersCount ? Math.round(totalSpentCents / ordersCount) : 0,
    lastOrderAt,
  };
}
