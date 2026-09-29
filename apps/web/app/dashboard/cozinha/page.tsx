'use client';

import { useEffect, useRef } from 'react';
import { Bell, BellOff } from 'lucide-react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { listOrders, updateOrderStatus, AdminOrderListItem, OrderStatus } from '@/lib/orders-api';
import { useOrderSound } from '@/lib/use-order-sound';
import { KdsOrderCard } from '@/components/kds/KdsOrderCard';
import { Button } from '@/components/ds/Button';
import { ErrorState, LoadingState } from '@/components/ds/States';

// No WebSocket in this slice — a short, fixed poll interval per column is
// the "simple and efficient" solution the spec asks for: fast enough for a
// kitchen to see new orders promptly, without hammering the API.
const POLL_INTERVAL_MS = 5_000;
const PAGE_SIZE = 50; // generous cap for "all currently active orders in this bucket"

// The 4 statuses this screen operates on. Kept as a plain literal list
// (not a lookup keyed by the full OrderStatus type) so there's no need to
// fill in dummy entries for OUT_FOR_DELIVERY/DELIVERED/COMPLETED/CANCELLED,
// which this screen never shows.
const COLUMN_STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'] as const;
const COLUMN_TONE: Record<(typeof COLUMN_STATUSES)[number], string> = {
  PENDING: 'bg-accent',
  CONFIRMED: 'bg-info',
  PREPARING: 'bg-primary',
  READY: 'bg-success',
};
const COLUMN_LABELS: Record<(typeof COLUMN_STATUSES)[number], string> = {
  PENDING: 'Novos',
  CONFIRMED: 'Confirmados',
  PREPARING: 'Preparando',
  READY: 'Prontos',
};

function useOrdersColumn(accessToken: string | null, status: OrderStatus) {
  return useQuery({
    queryKey: ['kds-orders', status],
    queryFn: () => listOrders(accessToken as string, { status, pageSize: PAGE_SIZE }),
    enabled: !!accessToken,
    refetchInterval: POLL_INTERVAL_MS,
  });
}

export default function KitchenDisplayPage() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const sound = useOrderSound();
  const knownPendingIds = useRef<Set<string> | null>(null); // null = not yet initialized

  const pending = useOrdersColumn(accessToken, 'PENDING');
  const confirmed = useOrdersColumn(accessToken, 'CONFIRMED');
  const preparing = useOrdersColumn(accessToken, 'PREPARING');
  const ready = useOrdersColumn(accessToken, 'READY');

  // New-order chime: compares this fetch's PENDING ids against the
  // previous one. The first successful load only primes the "known" set —
  // it never beeps for orders that were already sitting there when the
  // screen was opened, only for ones that arrive afterwards.
  useEffect(() => {
    if (!pending.data) return;
    const currentIds = new Set(pending.data.data.map((o) => o.id));
    if (knownPendingIds.current === null) {
      knownPendingIds.current = currentIds;
      return;
    }
    const hasNewOrder = [...currentIds].some((id) => !knownPendingIds.current!.has(id));
    if (hasNewOrder) {
      sound.play();
    }
    knownPendingIds.current = currentIds;
  }, [pending.data, sound]);

  const advanceMutation = useMutation({
    mutationFn: (vars: { id: string; nextStatus: OrderStatus }) =>
      updateOrderStatus(accessToken as string, vars.id, vars.nextStatus),
    onSuccess: () => {
      COLUMN_STATUSES.forEach((s) => queryClient.invalidateQueries({ queryKey: ['kds-orders', s] }));
      queryClient.invalidateQueries({ queryKey: ['orders'] }); // fatia 05 admin list, if open elsewhere
    },
  });

  const columnData: Record<(typeof COLUMN_STATUSES)[number], ReturnType<typeof useOrdersColumn>> = {
    PENDING: pending,
    CONFIRMED: confirmed,
    PREPARING: preparing,
    READY: ready,
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div>
          <h1 className="text-base font-semibold text-foreground">Cozinha</h1>
          <p className="text-xs text-muted-foreground">Atualiza automaticamente a cada 5 segundos</p>
        </div>
        <Button
          variant={sound.enabled ? 'secondary' : 'primary'}
          onClick={sound.enable}
          icon={sound.enabled ? <Bell className="h-4 w-4 text-success" /> : <BellOff className="h-4 w-4" />}
        >
          {sound.enabled ? 'Som ativado' : 'Ativar som'}
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 sm:grid-cols-2 sm:overflow-hidden xl:grid-cols-4">
        {COLUMN_STATUSES.map((status) => {
          const query = columnData[status];
          const orders: AdminOrderListItem[] = query.data?.data ?? [];
          return (
            <section
              key={status}
              aria-label={COLUMN_LABELS[status]}
              className="flex min-h-[16rem] flex-col overflow-hidden rounded-card border border-line bg-background sm:min-h-0"
            >
              <h2 className="flex items-center justify-between border-b border-line bg-surface px-3 py-2.5 text-sm font-bold uppercase tracking-wide text-foreground">
                <span className="flex items-center gap-2">
                  <span className={clsx('h-2.5 w-2.5 rounded-full', COLUMN_TONE[status])} aria-hidden />
                  {COLUMN_LABELS[status]}
                </span>
                <span className="rounded-full bg-surface-hover px-2.5 py-0.5 text-xs text-foreground">{orders.length}</span>
              </h2>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2.5">
                {query.isLoading ? (
                  <LoadingState className="py-6" />
                ) : query.isError ? (
                  <ErrorState message="Erro ao carregar." onRetry={() => query.refetch()} className="py-5" />
                ) : orders.length === 0 ? (
                  <p className="px-2 py-6 text-center text-sm text-subtle">Nenhum pedido.</p>
                ) : (
                  orders.map((order) => (
                    <KdsOrderCard
                      key={order.id}
                      order={order}
                      isAdvancing={
                        advanceMutation.isPending && advanceMutation.variables?.id === order.id
                      }
                      onAdvance={(nextStatus) => advanceMutation.mutate({ id: order.id, nextStatus })}
                    />
                  ))
                )}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
