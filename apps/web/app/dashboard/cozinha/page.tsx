'use client';

import { useEffect, useRef } from 'react';
import { Bell, BellOff } from 'lucide-react';
import clsx from 'clsx';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { getOrdersBoard, updateOrderStatus, OrderStatus } from '@/lib/orders-api';
import {
  boardColumn,
  columnCountLabel,
  KDS_COLUMN_LABEL,
  KDS_POLL_INTERVAL_MS,
  KDS_STATUSES,
  KdsStatus,
  newPendingOrderArrived,
} from '@/lib/kds-logic';
import { useOrderSound } from '@/lib/use-order-sound';
import { KdsOrderCard } from '@/components/kds/KdsOrderCard';
import { Button } from '@/components/ds/Button';
import { ErrorState, LoadingState } from '@/components/ds/States';

// No WebSocket in this slice — a short, fixed poll interval is the "simple and efficient"
// solution the spec asks for: fast enough for a kitchen to see new orders promptly, without
// hammering the API. The whole board comes in ONE request per poll (GET /orders/board): the
// API limits requests per route and per network address, and every screen of a restaurant
// usually shares one address. One request per column, as this screen did before, left room for
// a single kitchen screen per network.
const COLUMN_TONE: Record<KdsStatus, string> = {
  PENDING: 'bg-accent',
  CONFIRMED: 'bg-info',
  PREPARING: 'bg-primary',
  READY: 'bg-success',
};

export default function KitchenDisplayPage() {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const sound = useOrderSound();
  const knownPendingIds = useRef<Set<string> | null>(null); // null = not yet initialized

  const board = useQuery({
    queryKey: ['kds-board'],
    queryFn: () => getOrdersBoard(accessToken as string),
    enabled: !!accessToken,
    refetchInterval: KDS_POLL_INTERVAL_MS,
  });

  // New-order chime: compares this fetch's PENDING ids against the
  // previous one. The first successful load only primes the "known" set —
  // it never beeps for orders that were already sitting there when the
  // screen was opened, only for ones that arrive afterwards.
  useEffect(() => {
    if (!board.data) return;
    const currentIds = boardColumn(board.data, 'PENDING').orders.map((o) => o.id);
    if (newPendingOrderArrived(knownPendingIds.current, currentIds)) {
      sound.play();
    }
    knownPendingIds.current = new Set(currentIds);
  }, [board.data, sound]);

  const advanceMutation = useMutation({
    mutationFn: (vars: { id: string; nextStatus: OrderStatus }) =>
      updateOrderStatus(accessToken as string, vars.id, vars.nextStatus),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['kds-board'] });
      queryClient.invalidateQueries({ queryKey: ['orders'] }); // fatia 05 admin list, if open elsewhere
    },
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-2.5">
        <div>
          <h1 className="text-base font-semibold text-foreground">Cozinha</h1>
          {board.isError && board.data ? (
            // A failed poll keeps the last board on screen instead of blanking the kitchen, and says so.
            <p role="alert" className="text-xs font-medium text-warning">
              Sem atualização no momento. Mostrando os pedidos da última leitura.
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Atualiza automaticamente a cada 5 segundos</p>
          )}
        </div>
        <Button
          variant={sound.enabled ? 'secondary' : 'primary'}
          onClick={sound.enable}
          icon={sound.enabled ? <Bell className="h-4 w-4 text-success" /> : <BellOff className="h-4 w-4" />}
        >
          {sound.enabled ? 'Som ativado' : 'Ativar som'}
        </Button>
      </div>

      {/* Phone: one column, each status as tall as its orders, the whole board scrolls (rows sized
          to their content). From `sm` up: a fixed board where each column scrolls by itself. */}
      <div className="grid min-h-0 flex-1 auto-rows-max grid-cols-1 gap-3 overflow-y-auto p-3 sm:auto-rows-auto sm:grid-cols-2 sm:overflow-hidden xl:grid-cols-4">
        {KDS_STATUSES.map((status) => {
          const column = boardColumn(board.data, status);
          const orders = column.orders;
          return (
            <section
              key={status}
              aria-label={KDS_COLUMN_LABEL[status]}
              className="flex flex-col overflow-hidden rounded-card border border-line bg-background sm:min-h-0"
            >
              <h2 className="flex items-center justify-between border-b border-line bg-surface px-3 py-2.5 text-sm font-bold uppercase tracking-wide text-foreground">
                <span className="flex items-center gap-2">
                  <span className={clsx('h-2.5 w-2.5 rounded-full', COLUMN_TONE[status])} aria-hidden />
                  {KDS_COLUMN_LABEL[status]}
                </span>
                <span className="rounded-full bg-surface-hover px-2.5 py-0.5 text-xs text-foreground">{columnCountLabel(column)}</span>
              </h2>
              <div className="space-y-3 p-2.5 sm:min-h-0 sm:flex-1 sm:overflow-y-auto">
                {board.isLoading ? (
                  <LoadingState className="py-6" />
                ) : board.isError && !board.data ? (
                  <ErrorState message="Erro ao carregar." onRetry={() => board.refetch()} className="py-5" />
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
