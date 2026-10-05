'use client';

import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link2, Unlink } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { customersApi } from '@/lib/customers-api';
import { customerErrorMessage, formatPhone } from '@/lib/customers-logic';
import { AdminOrderDetail, getOrderCustomerSuggestions, setOrderCustomer } from '@/lib/orders-api';
import { Button } from '@/components/ds/Button';
import { Card } from '@/components/ds/Card';
import { Alert } from '@/components/ds/States';
import { useToast } from '@/components/ds/Toast';
import { CustomerPicker, PickedCustomer } from './CustomerPicker';

// The API decides (orders.update + customers.read); these only hide what would be refused.
const CAN_SEE = ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'];
const CAN_LINK = ['OWNER', 'ADMIN', 'MANAGER'];

// Who, in the customer registry, this order belongs to. An online or delivery order is born
// without a customer (anyone can type any phone on the public checkout): here a staff member
// confirms it. The order's own name/phone, typed at order time, never change.
export function OrderCustomerCard({ order }: { order: AdminOrderDetail }) {
  const { accessToken, user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const roles = user?.roles ?? [];
  const canSee = roles.some((role) => CAN_SEE.includes(role));
  const canLink = roles.some((role) => CAN_LINK.includes(role));
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);

  const linked = useQuery({
    queryKey: ['customers', 'detail', order.customerId],
    queryFn: () => customersApi.get(accessToken as string, order.customerId as string),
    enabled: !!accessToken && canSee && order.customerId !== null,
  });
  const suggestions = useQuery({
    queryKey: ['order', order.id, 'customer-suggestions'],
    queryFn: () => getOrderCustomerSuggestions(accessToken as string, order.id),
    enabled: !!accessToken && canLink && order.customerId === null && !!order.customerPhone,
  });

  const change = useMutation({
    mutationFn: (customerId: string | null) => setOrderCustomer(accessToken as string, order.id, customerId),
    onSuccess: async (updated) => {
      setError(null);
      toast.success(updated.customerId ? 'Pedido vinculado ao cliente.' : 'Vínculo com o cliente removido.');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['order', order.id] }),
        queryClient.invalidateQueries({ queryKey: ['orders'] }),
        queryClient.invalidateQueries({ queryKey: ['customers'] }),
      ]);
    },
    onError: (err) => {
      const code = err instanceof ApiError ? err.code : undefined;
      setError(
        code === 'CUSTOMER_INACTIVE'
          ? 'Este cliente está inativo e não pode receber novos vínculos.'
          : customerErrorMessage(code, err instanceof Error ? err.message : 'Não foi possível alterar o vínculo.'),
      );
    },
    onSettled: () => {
      busy.current = false;
    },
  });

  function apply(customer: PickedCustomer | null) {
    if (busy.current) return; // synchronous guard against a double click
    busy.current = true;
    setError(null);
    change.mutate(customer?.id ?? null);
  }

  if (!canSee) return null;

  return (
    <Card className="space-y-3 p-4" aria-label="Cliente cadastrado">
      <p className="text-xs font-medium text-muted-foreground">Cliente cadastrado</p>

      {order.customerId ? (
        <div className="space-y-2">
          {linked.isPending ? (
            <p className="text-sm text-muted-foreground">Carregando cliente...</p>
          ) : linked.isError || !linked.data ? (
            <p className="text-sm text-muted-foreground">Vinculado a um cliente do cadastro.</p>
          ) : (
            <div>
              <p className="text-sm font-medium text-foreground">{linked.data.name}</p>
              <p className="text-xs tabular-nums text-muted-foreground">
                {formatPhone(linked.data.phone)} · {linked.data.metrics.ordersCount}{' '}
                {linked.data.metrics.ordersCount === 1 ? 'pedido' : 'pedidos'}
              </p>
            </div>
          )}
          {canLink && (
            <Button
              variant="ghost"
              size="sm"
              icon={<Unlink className="h-4 w-4" aria-hidden />}
              loading={change.isPending}
              disabled={change.isPending}
              onClick={() => apply(null)}
            >
              Desvincular
            </Button>
          )}
        </div>
      ) : canLink ? (
        <div className="space-y-2">
          <p className="text-sm text-muted-foreground">Este pedido ainda não está no histórico de nenhum cliente.</p>
          {(suggestions.data?.data ?? []).map((customer) => (
            <Button
              key={customer.id}
              variant="outline"
              size="sm"
              fullWidth
              icon={<Link2 className="h-4 w-4" aria-hidden />}
              disabled={change.isPending}
              onClick={() => apply(customer)}
            >
              Vincular a {customer.name} (mesmo telefone)
            </Button>
          ))}
          <CustomerPicker value={null} onChange={apply} disabled={change.isPending} />
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">Sem cliente vinculado.</p>
      )}

      {error && <Alert tone="danger">{error}</Alert>}
    </Card>
  );
}
