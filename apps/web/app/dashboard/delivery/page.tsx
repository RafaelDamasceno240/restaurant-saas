'use client';

import { useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bike, CheckCircle2, PackageCheck, Settings, Truck } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { formatCents } from '@/lib/cash-api';
import { DeliveryItem, DeliveryStatus, deliveryApi } from '@/lib/delivery-api';
import { addressSummary, DELIVERY_STATUS_LABEL, DELIVERY_STATUS_TONE } from '@/lib/delivery-logic';
import { useActiveBranch } from '@/lib/use-active-branch';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Card } from '@/components/ds/Card';
import { Page, PageHeader } from '@/components/ds/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { Tabs } from '@/components/ds/Tabs';
import { useToast } from '@/components/ds/Toast';
import { DeliverySettingsDialog } from '@/components/delivery/DeliverySettingsDialog';
import { useErrorMessage } from '@/components/estoque/use-inventory';
import { StatusBadge } from '@/components/pedidos/StatusBadge';

const TAB_ORDER: DeliveryStatus[] = ['PENDING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];
const MANAGEMENT = ['OWNER', 'ADMIN', 'MANAGER'];
const OPERATORS = [...MANAGEMENT, 'DELIVERY'];
const POLL_MS = 15_000;

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const EMPTY_TEXT: Record<DeliveryStatus, string> = {
  PENDING: 'Nenhuma entrega pendente. Pedidos de entrega aparecem aqui assim que são feitos.',
  OUT_FOR_DELIVERY: 'Nenhuma entrega em rota no momento.',
  DELIVERED: 'Nenhuma entrega concluída ainda.',
  CANCELLED: 'Nenhuma entrega cancelada.',
};

export default function DeliveryPage() {
  const { user, accessToken } = useAuth();
  const { branchId, isLoading: branchLoading } = useActiveBranch();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const roles = user?.roles ?? [];
  const canOperate = roles.some((role) => OPERATORS.includes(role));
  const canConfigure = roles.some((role) => MANAGEMENT.includes(role));

  const [status, setStatus] = useState<DeliveryStatus>('PENDING');
  const [page, setPage] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Synchronous guard against double clicks / repeated taps: a state flag alone
  // would not change between clicks of the same tick. The backend is idempotent
  // anyway; this just avoids redundant requests and duplicate toasts.
  const inFlight = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  const query = useQuery({
    queryKey: ['delivery', 'list', branchId, status, page],
    queryFn: () => deliveryApi.list(accessToken as string, branchId as string, { status, page }),
    enabled: !!accessToken && !!branchId && canOperate,
    refetchInterval: POLL_MS,
    placeholderData: (previous) => previous,
  });

  function changeStatus(next: DeliveryStatus) {
    setStatus(next);
    setPage(1);
  }

  async function act(kind: 'dispatch' | 'complete', item: DeliveryItem) {
    if (inFlight.current.has(item.id)) return;
    inFlight.current.add(item.id);
    setBusy(new Set(inFlight.current));
    try {
      const result =
        kind === 'dispatch'
          ? await deliveryApi.dispatch(accessToken as string, item.id)
          : await deliveryApi.complete(accessToken as string, item.id);
      if (result.idempotentReplay) {
        toast.success(`Pedido ${item.orderNumber}: a ação já tinha sido registrada.`);
      } else {
        toast.success(
          kind === 'dispatch'
            ? `Pedido ${item.orderNumber} saiu para entrega.`
            : `Pedido ${item.orderNumber} entregue.`,
        );
      }
      await queryClient.invalidateQueries({ queryKey: ['delivery'] });
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível atualizar a entrega.'));
      await queryClient.invalidateQueries({ queryKey: ['delivery'] });
    } finally {
      inFlight.current.delete(item.id);
      setBusy(new Set(inFlight.current));
    }
  }

  if (!canOperate) {
    return (
      <Page>
        <EmptyState
          icon={<Bike />}
          title="Sem acesso ao Delivery"
          description="Somente proprietários, administradores, gerentes e entregadores acompanham as entregas."
        />
      </Page>
    );
  }

  const data = query.data;
  const rows = data?.data ?? [];

  return (
    <Page wide>
      <PageHeader
        title="Delivery"
        description="Acompanhe e despache as entregas da unidade."
        actions={
          canConfigure ? (
            <Button variant="outline" icon={<Settings className="h-4 w-4" aria-hidden />} onClick={() => setSettingsOpen(true)}>
              Configurações de entrega
            </Button>
          ) : undefined
        }
      />

      <Tabs
        variant="pill"
        value={status}
        onChange={changeStatus}
        items={TAB_ORDER.map((key) => ({
          key,
          label: DELIVERY_STATUS_LABEL[key],
          count: data?.summary[key],
        }))}
      />

      {branchLoading || !branchId || query.isPending ? (
        <LoadingState label="Carregando entregas..." />
      ) : query.isError ? (
        <ErrorState message="Não foi possível carregar as entregas." onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState icon={<Truck />} title={DELIVERY_STATUS_LABEL[status]} description={EMPTY_TEXT[status]} />
      ) : (
        <Card className="overflow-hidden">
          <TableWrap>
            <Table className="min-w-[980px]">
              <THead>
                <Tr className="hover:bg-transparent">
                  <Th>Pedido</Th>
                  <Th>Cliente</Th>
                  <Th>Endereço</Th>
                  <Th className="text-right">Valor</Th>
                  <Th>Pedido</Th>
                  <Th>Entrega</Th>
                  {/* `relative` keeps the sr-only label inside the scrolling table wrapper. */}
                  <Th className="relative">
                    <span className="sr-only">Ações</span>
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map((item) => (
                  <Tr key={item.id}>
                    <Td>
                      <div className="font-semibold text-foreground">{item.orderNumber}</div>
                      <div className="text-xs text-muted-foreground tabular-nums">{formatTime(item.orderCreatedAt)}</div>
                    </Td>
                    <Td>
                      <div className="text-foreground">{item.customerName ?? '—'}</div>
                      <div className="text-xs text-muted-foreground">{item.customerPhone ?? ''}</div>
                    </Td>
                    <Td className="max-w-[22rem]">
                      <span className="block truncate" title={addressSummary(item.address)}>
                        {addressSummary(item.address)}
                      </span>
                      {item.notes && <span className="block truncate text-xs text-muted-foreground">Obs.: {item.notes}</span>}
                    </Td>
                    <Td className="text-right tabular-nums">
                      <div className="font-medium text-foreground">{formatCents(item.totalCents)}</div>
                      <div className="text-xs text-muted-foreground">
                        {item.deliveryFeeCents > 0 ? `Taxa ${formatCents(item.deliveryFeeCents)}` : 'Sem taxa'}
                      </div>
                    </Td>
                    <Td>
                      <StatusBadge status={item.orderStatus} />
                    </Td>
                    <Td>
                      <Badge tone={DELIVERY_STATUS_TONE[item.status]} dot>
                        {DELIVERY_STATUS_LABEL[item.status]}
                      </Badge>
                    </Td>
                    <Td>
                      <div className="flex justify-end">
                        {item.status === 'PENDING' && (
                          <Button
                            size="sm"
                            icon={<PackageCheck className="h-4 w-4" aria-hidden />}
                            loading={busy.has(item.id)}
                            disabled={!item.canDispatch || busy.has(item.id)}
                            title={item.canDispatch ? undefined : 'Disponível quando o pedido estiver pronto.'}
                            onClick={() => void act('dispatch', item)}
                          >
                            Despachar
                          </Button>
                        )}
                        {item.status === 'OUT_FOR_DELIVERY' && (
                          <Button
                            size="sm"
                            icon={<CheckCircle2 className="h-4 w-4" aria-hidden />}
                            loading={busy.has(item.id)}
                            disabled={busy.has(item.id)}
                            onClick={() => void act('complete', item)}
                          >
                            Confirmar entrega
                          </Button>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          {data && data.meta.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-muted-foreground">
              <span>
                Página {data.meta.page} de {data.meta.totalPages} · {data.meta.total} entregas
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
                  Anterior
                </Button>
                <Button size="sm" variant="outline" disabled={page >= data.meta.totalPages} onClick={() => setPage((current) => current + 1)}>
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {canConfigure && <DeliverySettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} branchId={branchId} />}
    </Page>
  );
}
