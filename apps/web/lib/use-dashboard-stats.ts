'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from './auth-context';
import { isSameLocalDay } from './format';
import { AdminOrderListItem, listOrders, OrderStatus } from './orders-api';

const WINDOW_SIZE = 100; // API cap per page

export interface DashboardStats {
  salesToday: number;
  ordersToday: number;
  avgTicket: number;
  inPreparation: number;
  byStatus: Partial<Record<OrderStatus, number>>;
  recent: AdminOrderListItem[];
  /** True when the 100-order window doesn't reach back past today's start. */
  partial: boolean;
}

// Derived purely from the existing GET /orders list (newest first, 100 max):
// no new endpoint, no backend change. Cancelled orders are excluded from
// sales; if today has more than 100 orders the figures are flagged partial
// instead of pretending to be exact.
export function useDashboardStats() {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: ['dashboard-orders'],
    queryFn: () => listOrders(accessToken as string, { pageSize: WINDOW_SIZE }),
    enabled: !!accessToken,
    refetchInterval: 30_000,
  });

  const stats = useMemo<DashboardStats | null>(() => {
    if (!query.data) return null;
    const orders = query.data.data;
    const today = orders.filter((o) => isSameLocalDay(o.createdAt));
    const billable = today.filter((o) => o.status !== 'CANCELLED');
    const salesToday = billable.reduce((sum, o) => sum + o.total, 0);
    const byStatus: DashboardStats['byStatus'] = {};
    for (const o of today) byStatus[o.status] = (byStatus[o.status] ?? 0) + 1;
    const oldest = orders[orders.length - 1];
    return {
      salesToday,
      ordersToday: billable.length,
      avgTicket: billable.length ? salesToday / billable.length : 0,
      inPreparation: orders.filter((o) => o.status === 'PREPARING').length,
      byStatus,
      recent: orders.slice(0, 7),
      partial: query.data.meta.total > orders.length && !!oldest && isSameLocalDay(oldest.createdAt),
    };
  }, [query.data]);

  return { stats, isLoading: query.isLoading, isError: query.isError, refetch: query.refetch };
}
