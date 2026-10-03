'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Power } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { formatCents } from '@/lib/cash-api';
import { CustomerDetail, customersApi } from '@/lib/customers-api';
import { CUSTOMER_STATUS_TONE, formatCpf, formatPhone, lastOrderLabel } from '@/lib/customers-logic';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { StatCard } from '@/components/ds/StatCard';
import { useToast } from '@/components/ds/Toast';
import { useErrorMessage } from '@/components/estoque/use-inventory';
import { StatusBadge } from '@/components/pedidos/StatusBadge';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

// Detail = record + metrics (GET /customers/:id) and the paged order history
// (GET /customers/:id/orders). Both come from the API; nothing is computed here.
export function CustomerDetailDialog({
  customerId,
  canUpdate,
  onClose,
  onEdit,
}: {
  customerId: string | null;
  canUpdate: boolean;
  onClose: () => void;
  onEdit: (customer: CustomerDetail) => void;
}) {
  const { accessToken } = useAuth();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const open = customerId !== null;
  const [page, setPage] = useState(1);
  const toggling = useRef(false);

  useEffect(() => setPage(1), [customerId]);

  const detail = useQuery({
    queryKey: ['customers', 'detail', customerId],
    queryFn: () => customersApi.get(accessToken as string, customerId as string),
    enabled: open && !!accessToken,
  });
  const orders = useQuery({
    queryKey: ['customers', 'orders', customerId, page],
    queryFn: () => customersApi.orders(accessToken as string, customerId as string, page),
    enabled: open && !!accessToken,
    placeholderData: (previous) => previous,
  });

  const toggle = useMutation({
    mutationFn: (customer: CustomerDetail) => customersApi.update(accessToken as string, customer.id, { active: !customer.active }),
    onSuccess: async (saved) => {
      toast.success(saved.active ? `${saved.name} reativado.` : `${saved.name} inativado.`);
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
    onError: (err) => toast.error(errorMessage(err, 'Não foi possível alterar o cliente.')),
    onSettled: () => {
      toggling.current = false;
    },
  });

  function onToggle(customer: CustomerDetail) {
    if (toggling.current) return; // synchronous guard against a double click
    toggling.current = true;
    toggle.mutate(customer);
  }

  const customer = detail.data;
  const metrics = customer?.metrics;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={customer?.name ?? 'Cliente'}
      description={customer ? formatPhone(customer.phone) : undefined}
      size="lg"
      footer={
        <>
          {customer && canUpdate && (
            <>
              <Button
                variant="outline"
                size="sm"
                icon={<Pencil className="h-4 w-4" aria-hidden />}
                onClick={() => onEdit(customer)}
                disabled={toggle.isPending}
              >
                Editar
              </Button>
              <Button
                variant={customer.active ? 'danger-ghost' : 'outline'}
                size="sm"
                icon={<Power className="h-4 w-4" aria-hidden />}
                loading={toggle.isPending}
                disabled={toggle.isPending}
                onClick={() => onToggle(customer)}
              >
                {customer.active ? 'Inativar' : 'Reativar'}
              </Button>
            </>
          )}
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </>
      }
    >
      {detail.isPending ? (
        <LoadingState label="Carregando cliente..." />
      ) : detail.isError || !customer || !metrics ? (
        <ErrorState message="Não foi possível carregar o cliente." onRetry={() => void detail.refetch()} />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={CUSTOMER_STATUS_TONE[customer.active ? 'active' : 'inactive']} dot>
              {customer.active ? 'Ativo' : 'Inativo'}
            </Badge>
            {customer.email && <span className="text-sm text-muted-foreground">{customer.email}</span>}
            {customer.cpf && <span className="text-sm tabular-nums text-muted-foreground">CPF {formatCpf(customer.cpf)}</span>}
          </div>
          {customer.notes && <p className="rounded-ctl border border-line bg-surface-hover/40 px-3 py-2 text-sm text-foreground">{customer.notes}</p>}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <StatCard label="Pedidos" value={metrics.ordersCount} hint={metrics.cancelledCount > 0 ? `${metrics.cancelledCount} cancelado(s) não contam` : undefined} />
            <StatCard label="Total gasto" value={formatCents(metrics.totalSpentCents)} featured />
            <StatCard label="Ticket médio" value={formatCents(metrics.averageTicketCents)} />
            <StatCard label="Primeira compra" value={<span className="text-lg">{lastOrderLabel(metrics.firstOrderAt)}</span>} />
            <StatCard label="Última compra" value={<span className="text-lg">{lastOrderLabel(metrics.lastOrderAt)}</span>} />
          </div>

          <section aria-label="Histórico de pedidos" className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Histórico de pedidos</h3>
            {orders.isPending ? (
              <LoadingState label="Carregando pedidos..." />
            ) : orders.isError ? (
              <ErrorState message="Não foi possível carregar os pedidos." onRetry={() => void orders.refetch()} />
            ) : orders.data.data.length === 0 ? (
              <EmptyState title="Nenhum pedido vinculado" description="Pedidos feitos no PDV com este cliente aparecem aqui." />
            ) : (
              <>
                <ul className="divide-y divide-line rounded-ctl border border-line">
                  {orders.data.data.map((order) => (
                    <li key={order.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-foreground">{order.orderNumber}</p>
                        <p className="text-xs text-muted-foreground">
                          {formatDateTime(order.createdAt)} · {order.branch.name} · {order.itemCount} {order.itemCount === 1 ? 'item' : 'itens'}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <StatusBadge status={order.status} />
                        <span className={order.counted ? 'text-sm font-medium tabular-nums text-foreground' : 'text-sm tabular-nums text-muted-foreground line-through'}>
                          {formatCents(order.totalCents)}
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
                {orders.data.meta.totalPages > 1 && (
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>
                      Página {orders.data.meta.page} de {orders.data.meta.totalPages} · {orders.data.meta.total} pedidos
                    </span>
                    <div className="flex gap-2">
                      <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                        Anterior
                      </Button>
                      <Button size="sm" variant="outline" disabled={page >= orders.data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
                        Próxima
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}
