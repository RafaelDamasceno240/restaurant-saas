'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, RefreshCw } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { listOrders, OrderStatus } from '@/lib/orders-api';
import { Button } from '@/components/ds/Button';
import { Card } from '@/components/ds/Card';
import { SearchInput } from '@/components/ds/Input';
import { Page, PageHeader } from '@/components/ds/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Tabs } from '@/components/ds/Tabs';
import { OrderCard } from '@/components/pedidos/OrderCard';
import { OrdersTable } from '@/components/pedidos/OrdersTable';

const TABS: { key: OrderStatus | 'ALL'; label: string }[] = [
  { key: 'ALL', label: 'Todos' },
  { key: 'PENDING', label: 'Novos' },
  { key: 'CONFIRMED', label: 'Confirmados' },
  { key: 'PREPARING', label: 'Preparando' },
  { key: 'READY', label: 'Prontos' },
  { key: 'COMPLETED', label: 'Concluídos' },
];

// Simple refetch strategy per the spec: no WebSocket, just a moderate
// polling interval via TanStack Query's refetchInterval — refreshes
// automatically while the page is open, and immediately again whenever the
// filter changes (queryKey change triggers a new fetch on its own).
const POLL_INTERVAL_MS = 15_000;

export default function OrdersPage() {
  const { accessToken } = useAuth();
  const [tab, setTab] = useState<OrderStatus | 'ALL'>('ALL');
  const [search, setSearch] = useState('');

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['orders', tab],
    queryFn: () => listOrders(accessToken as string, tab === 'ALL' ? {} : { status: tab }),
    enabled: !!accessToken,
    refetchInterval: POLL_INTERVAL_MS,
  });

  // Search only narrows the page the API already returned; it never sends
  // a new query.
  const term = search.trim().toLowerCase();
  const orders = (data?.data ?? []).filter(
    (o) =>
      !term ||
      String(o.orderNumber).toLowerCase().includes(term) ||
      (o.customerName ?? '').toLowerCase().includes(term),
  );

  return (
    <Page wide>
      <PageHeader
        title="Pedidos"
        description="Acompanhe e atualize os pedidos de todos os canais."
        actions={
          <Button
            variant="outline"
            onClick={() => refetch()}
            loading={isFetching}
            icon={isFetching ? undefined : <RefreshCw className="h-4 w-4" />}
          >
            {isFetching ? 'Atualizando' : 'Atualizar'}
          </Button>
        }
      />

      <Tabs items={TABS} value={tab} onChange={setTab} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-full sm:w-72">
          <SearchInput
            placeholder="Buscar por número ou cliente"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Buscar pedidos"
          />
        </div>
        {data && (
          <p className="text-xs text-muted-foreground">
            {data.meta.total} pedido{data.meta.total === 1 ? '' : 's'}
            {term && ` · ${orders.length} na busca`}
          </p>
        )}
      </div>

      {isLoading ? (
        <LoadingState label="Carregando pedidos..." />
      ) : isError ? (
        <ErrorState message="Não foi possível carregar os pedidos agora." onRetry={() => refetch()} />
      ) : orders.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title={term ? 'Nenhum pedido encontrado' : 'Nenhum pedido nesse status'}
          description={term ? 'Tente outro número ou nome de cliente.' : 'Quando chegarem pedidos, eles aparecem aqui.'}
        />
      ) : (
        <>
          <Card className="hidden md:block">
            <OrdersTable orders={orders} />
          </Card>
          <div className="space-y-2 md:hidden">
            {orders.map((order) => (
              <OrderCard key={order.id} order={order} />
            ))}
          </div>
        </>
      )}
    </Page>
  );
}
