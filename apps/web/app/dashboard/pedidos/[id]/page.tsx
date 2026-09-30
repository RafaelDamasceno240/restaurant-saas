'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { useToast } from '@/components/ds/Toast';
import { ApiError } from '@/lib/api-client';
import {
  FULFILLMENT_LABEL,
  getOrderDetail,
  ORDER_SOURCE_LABEL,
  OrderStatus,
  updateOrderStatus,
} from '@/lib/orders-api';
import { formatBRL } from '@/lib/format';
import { Alert, ErrorState, LoadingState } from '@/components/ds/States';
import { Button } from '@/components/ds/Button';
import { Card, CardHeader } from '@/components/ds/Card';
import { Page } from '@/components/ds/PageHeader';
import { PAYMENT_LABEL, customerLabel } from '@/components/pedidos/OrderCard';
import { SourceBadge, StatusBadge } from '@/components/pedidos/StatusBadge';

interface PageProps {
  params: { id: string };
}

// Simple linear history, per the spec ("histórico simples de status") — not
// a real audit trail fetched from the backend, just the fixed operational
// sequence with the current step highlighted. CANCELLED breaks out of the
// line entirely (it's not a step on this path).
const FLOW_STEPS: { status: OrderStatus; label: string }[] = [
  { status: 'PENDING', label: 'Recebido' },
  { status: 'CONFIRMED', label: 'Confirmado' },
  { status: 'PREPARING', label: 'Preparando' },
  { status: 'READY', label: 'Pronto' },
  { status: 'COMPLETED', label: 'Concluído' },
];

const ACTIONS: Record<
  string,
  { label: string; nextStatus: OrderStatus; variant: 'primary' | 'danger' }[]
> = {
  PENDING: [
    { label: 'Confirmar', nextStatus: 'CONFIRMED', variant: 'primary' },
    { label: 'Cancelar', nextStatus: 'CANCELLED', variant: 'danger' },
  ],
  CONFIRMED: [
    { label: 'Iniciar preparo', nextStatus: 'PREPARING', variant: 'primary' },
    { label: 'Cancelar', nextStatus: 'CANCELLED', variant: 'danger' },
  ],
  PREPARING: [
    { label: 'Marcar como pronto', nextStatus: 'READY', variant: 'primary' },
    { label: 'Cancelar', nextStatus: 'CANCELLED', variant: 'danger' },
  ],
  READY: [{ label: 'Finalizar', nextStatus: 'COMPLETED', variant: 'primary' }],
  COMPLETED: [],
  CANCELLED: [],
};

export default function OrderDetailPage({ params }: PageProps) {
  const { accessToken } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [actionError, setActionError] = useState<string | null>(null);

  const { data: order, isLoading, isError } = useQuery({
    queryKey: ['order', params.id],
    queryFn: () => getOrderDetail(accessToken as string, params.id),
    enabled: !!accessToken,
  });

  const mutation = useMutation({
    mutationFn: (nextStatus: OrderStatus) =>
      updateOrderStatus(accessToken as string, params.id, nextStatus),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: ['order', params.id] });
      queryClient.invalidateQueries({ queryKey: ['orders'] });
      toast.success('Status do pedido atualizado.');
    },
    onError: (err) => {
      setActionError(
        err instanceof ApiError ? err.message : 'Não foi possível atualizar o status.',
      );
    },
  });


  return (
    <Page>
      <Link
        href="/dashboard/pedidos"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" aria-hidden />
        Pedidos
      </Link>

      {isLoading ? (
        <LoadingState label="Carregando pedido..." />
      ) : isError || !order ? (
        <ErrorState message="Não foi possível carregar este pedido." />
      ) : (
        <>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="flex flex-wrap items-center gap-2.5 text-xl font-semibold tracking-tight text-foreground">
                Pedido #{order.orderNumber}
                <SourceBadge source={order.source} label={ORDER_SOURCE_LABEL[order.source] ?? order.source} />
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {customerLabel(order)}
                {order.customerPhone ? ` · ${order.customerPhone}` : ''}
              </p>
            </div>
            <StatusBadge status={order.status} />
          </div>

          {order.status === 'CANCELLED' ? (
            <Alert tone="danger">Este pedido foi cancelado.</Alert>
          ) : (
            <Card className="p-4">
              <ol className="flex items-center overflow-x-auto" aria-label="Andamento do pedido">
                {FLOW_STEPS.map((step, index) => {
                  const currentIndex = FLOW_STEPS.findIndex((s) => s.status === order.status);
                  const reached = index <= currentIndex;
                  const isCurrent = index === currentIndex;
                  return (
                    <li key={step.status} className="flex flex-1 items-center last:flex-none">
                      <span className="flex items-center gap-2 whitespace-nowrap">
                        <span
                          className={`flex h-6 w-6 items-center justify-center rounded-full text-2xs font-bold transition-colors ${
                            reached ? 'bg-primary text-primary-foreground' : 'bg-surface-hover text-subtle'
                          } ${isCurrent ? 'ring-4 ring-accent/20' : ''}`}
                        >
                          {reached ? <Check className="h-3.5 w-3.5" aria-hidden /> : index + 1}
                        </span>
                        <span className={`text-xs font-medium ${reached ? 'text-foreground' : 'text-subtle'}`}>
                          {step.label}
                        </span>
                      </span>
                      {index < FLOW_STEPS.length - 1 && (
                        <span
                          className={`mx-3 h-px min-w-[1.5rem] flex-1 ${
                            index < currentIndex ? 'bg-primary' : 'bg-line-strong'
                          }`}
                          aria-hidden
                        />
                      )}
                    </li>
                  );
                })}
              </ol>
            </Card>
          )}

          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <div className="space-y-4">
              <Card>
                <CardHeader title="Itens" />
                <ul className="divide-y divide-line">
                  {order.items.map((item) => (
                    <li key={item.productId} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                      <span className="min-w-0 text-foreground">
                        <span className="font-semibold">{item.quantity}×</span> {item.name}
                        <span className="ml-1.5 text-xs text-subtle">({formatBRL(item.unitPrice)} un.)</span>
                      </span>
                      <span className="shrink-0 font-medium text-foreground">{formatBRL(item.subtotal)}</span>
                    </li>
                  ))}
                </ul>
                {order.fulfillmentType === 'DELIVERY' && (
                  <div className="space-y-1 border-t border-line px-4 py-3 text-sm text-muted-foreground">
                    <div className="flex items-center justify-between">
                      <span>Subtotal</span>
                      <span>{formatBRL(order.subtotal)}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span>Taxa de entrega</span>
                      <span>{formatBRL(order.deliveryFee)}</span>
                    </div>
                  </div>
                )}
                <div className="flex items-center justify-between border-t border-line px-4 py-3 text-base font-semibold text-foreground">
                  <span>Total</span>
                  <span>{formatBRL(order.total)}</span>
                </div>
              </Card>

              {order.notes && (
                <Card className="p-4">
                  <p className="text-xs font-medium text-muted-foreground">Observações</p>
                  <p className="mt-1 text-sm text-foreground">{order.notes}</p>
                </Card>
              )}

              {order.delivery?.notes && (
                <Card className="p-4">
                  <p className="text-xs font-medium text-muted-foreground">Instruções de entrega</p>
                  <p className="mt-1 text-sm text-foreground">{order.delivery.notes}</p>
                </Card>
              )}
            </div>

            <div className="space-y-4">
              <Card className="space-y-4 p-4">
                <div>
                  <p className="text-xs font-medium text-muted-foreground">Atendimento</p>
                  <p className="mt-0.5 text-sm font-medium text-foreground">
                    {FULFILLMENT_LABEL[order.fulfillmentType] ?? order.fulfillmentType}
                  </p>
                  {order.address && (
                    <p className="mt-1 text-sm text-muted-foreground">
                      {order.address.street}, {order.address.number}
                      {order.address.complement ? ` - ${order.address.complement}` : ''}
                      <br />
                      {order.address.neighborhood} — {order.address.city}/{order.address.state}
                      <br />
                      CEP {order.address.zipCode}
                    </p>
                  )}
                </div>
                <div className="border-t border-line pt-4">
                  <p className="text-xs font-medium text-muted-foreground">Pagamento</p>
                  <p className="mt-0.5 text-sm font-medium text-foreground">
                    {PAYMENT_LABEL[order.paymentMethod] ?? order.paymentMethod}
                  </p>
                </div>
              </Card>

              {actionError && <Alert tone="danger">{actionError}</Alert>}

              {/* A delivery order is finished by the Delivery flow (dispatch, then
                  confirm), never by "Finalizar": the API refuses COMPLETED for it. */}
              {order.fulfillmentType === 'DELIVERY' && ['READY', 'OUT_FOR_DELIVERY'].includes(order.status) && (
                <Alert tone="info">
                  Este pedido segue pelo fluxo de entrega.{' '}
                  <Link href="/dashboard/delivery" className="font-medium underline">
                    Abrir Delivery
                  </Link>
                </Alert>
              )}

              {ACTIONS[order.status]?.length > 0 && !(order.fulfillmentType === 'DELIVERY' && order.status === 'READY') && (
                <div className="flex flex-col gap-2">
                  {ACTIONS[order.status].map((action) => (
                    <Button
                      key={action.nextStatus}
                      size="lg"
                      variant={action.variant === 'danger' ? 'danger-ghost' : 'primary'}
                      fullWidth
                      loading={mutation.isPending && mutation.variables === action.nextStatus}
                      disabled={mutation.isPending}
                      onClick={() => mutation.mutate(action.nextStatus)}
                    >
                      {action.label}
                    </Button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </Page>
  );
}
