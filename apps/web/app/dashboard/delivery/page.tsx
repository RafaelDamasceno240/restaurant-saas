'use client';

import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Bike,
  CheckCircle2,
  History,
  PackageCheck,
  Pencil,
  RotateCcw,
  Search,
  Settings,
  Truck,
  UserMinus,
  UserPlus,
  XCircle,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { formatCents } from '@/lib/cash-api';
import { DeliveryItem, DeliveryStatus, deliveryApi } from '@/lib/delivery-api';
import {
  addressSummary,
  attemptLabel,
  DELIVERY_STATUS_LABEL,
  DELIVERY_STATUS_TONE,
  DELIVERY_TABS,
  defaultCourierFilter,
  localDayRange,
} from '@/lib/delivery-logic';
import { OrderStatus, updateOrderStatus } from '@/lib/orders-api';
import { useActiveBranch } from '@/lib/use-active-branch';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Card } from '@/components/ds/Card';
import { Input, SearchInput, Select } from '@/components/ds/Input';
import { Page, PageHeader } from '@/components/ds/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { Tabs } from '@/components/ds/Tabs';
import { useToast } from '@/components/ds/Toast';
import { ConfirmDeliveryDialog, DeliveryNotesDialog, FailDeliveryDialog } from '@/components/delivery/DeliveryDialogs';
import { AssignCourierDialog, DeliveryHistoryDialog } from '@/components/delivery/DeliveryCourierDialogs';
import { DeliverySettingsDialog } from '@/components/delivery/DeliverySettingsDialog';
import { useErrorMessage } from '@/components/estoque/use-inventory';
import { StatusBadge } from '@/components/pedidos/StatusBadge';

const MANAGEMENT = ['OWNER', 'ADMIN', 'MANAGER'];
const OPERATORS = [...MANAGEMENT, 'DELIVERY'];
const POLL_MS = 15_000;

// Order statuses a delivery order can be in while it is part of this screen.
const ORDER_STATUS_FILTERS: { value: OrderStatus; label: string }[] = [
  { value: 'PENDING', label: 'Novo' },
  { value: 'CONFIRMED', label: 'Confirmado' },
  { value: 'PREPARING', label: 'Preparando' },
  { value: 'READY', label: 'Pronto' },
  { value: 'OUT_FOR_DELIVERY', label: 'Saiu para entrega' },
  { value: 'DELIVERED', label: 'Entregue' },
  { value: 'CANCELLED', label: 'Cancelado' },
];

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const EMPTY_TEXT: Record<DeliveryStatus, string> = {
  PENDING: 'Nenhuma entrega pendente. Pedidos de entrega aparecem aqui assim que são feitos.',
  OUT_FOR_DELIVERY: 'Nenhuma entrega em rota no momento.',
  FAILED: 'Nenhuma entrega com falha. Tudo certo por aqui.',
  DELIVERED: 'Nenhuma entrega concluída ainda.',
  CANCELLED: 'Nenhuma entrega cancelada.',
};

type Modal =
  | { kind: 'fail'; item: DeliveryItem }
  | { kind: 'notes'; item: DeliveryItem }
  | { kind: 'redeliver'; item: DeliveryItem }
  | { kind: 'cancelOrder'; item: DeliveryItem }
  | { kind: 'assign'; item: DeliveryItem }
  | { kind: 'history'; item: DeliveryItem }
  | null;

type Action =
  | { kind: 'dispatch' | 'complete' | 'redeliver' | 'cancelOrder' | 'unassign'; item: DeliveryItem }
  | { kind: 'assign'; item: DeliveryItem; courierUserId: string }
  | { kind: 'fail'; item: DeliveryItem; reason: string }
  | { kind: 'notes'; item: DeliveryItem; notes: string | null };

export default function DeliveryPage() {
  const { user, accessToken } = useAuth();
  const { branchId, isLoading: branchLoading } = useActiveBranch();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const roles = user?.roles ?? [];
  const canOperate = roles.some((role) => OPERATORS.includes(role));
  const canConfigure = roles.some((role) => MANAGEMENT.includes(role));
  // Cancelling an order needs orders.cancel, which management has; the API decides.
  const canCancelOrder = canConfigure;
  // Assigning needs delivery.assign (management); a courier cannot assign anyone, not even themselves.
  const canAssign = canConfigure;
  const isCourier = roles.includes('DELIVERY');

  const [status, setStatus] = useState<DeliveryStatus>('PENDING');
  const [searchText, setSearchText] = useState('');
  const [orderStatus, setOrderStatus] = useState<OrderStatus | ''>('');
  // null = the operator has not chosen yet, so the role's default applies (a courier starts
  // on their own deliveries). Choosing "Todos" is an explicit '' and sticks.
  const [courierChoice, setCourierChoice] = useState<string | null>(null);
  const courierFilter = courierChoice ?? defaultCourierFilter(roles);
  const [day, setDay] = useState('');
  const [page, setPage] = useState(1);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [modal, setModal] = useState<Modal>(null);
  const search = useDeferredValue(searchText.trim());

  // Synchronous guard against double clicks / repeated taps: a state flag alone would not
  // change between clicks of the same tick. The backend is idempotent anyway; this just
  // avoids redundant requests and duplicate toasts.
  const inFlight = useRef(new Set<string>());
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());

  useEffect(() => setPage(1), [status, search, orderStatus, day, branchId, courierFilter]);

  const range = day ? localDayRange(day) : null;
  const filtersActive = search !== '' || orderStatus !== '' || day !== '' || courierFilter !== '';

  const query = useQuery({
    queryKey: ['delivery', 'list', branchId, status, search, orderStatus, day, courierFilter, page],
    queryFn: () =>
      deliveryApi.list(accessToken as string, branchId as string, {
        status,
        page,
        search: search || undefined,
        orderStatus: orderStatus || undefined,
        courier: courierFilter || undefined,
        dateFrom: range?.from,
        dateTo: range?.to,
      }),
    enabled: !!accessToken && !!branchId && canOperate,
    refetchInterval: POLL_MS,
    placeholderData: (previous) => previous,
  });

  // Courier names for the filter; only management can list them (delivery.assign).
  const couriers = useQuery({
    queryKey: ['delivery', 'couriers', branchId],
    queryFn: () => deliveryApi.listCouriers(accessToken as string, branchId as string),
    enabled: !!accessToken && !!branchId && canAssign,
  });

  function clearFilters() {
    setSearchText('');
    setOrderStatus('');
    setDay('');
    setCourierChoice('');
  }

  // Runs one action with the per-delivery guard. Resolves true when it succeeded.
  async function run(action: Action): Promise<boolean> {
    const { item } = action;
    if (inFlight.current.has(item.id)) return false;
    inFlight.current.add(item.id);
    setBusy(new Set(inFlight.current));
    const token = accessToken as string;
    try {
      let message: string;
      let replay = false;
      switch (action.kind) {
        case 'dispatch':
          replay = (await deliveryApi.dispatch(token, item.id)).idempotentReplay;
          message = `Pedido ${item.orderNumber} saiu para entrega.`;
          break;
        case 'complete':
          replay = (await deliveryApi.complete(token, item.id)).idempotentReplay;
          message = `Pedido ${item.orderNumber} entregue.`;
          break;
        case 'fail':
          replay = (await deliveryApi.fail(token, item.id, action.reason)).idempotentReplay;
          message = `Falha registrada no pedido ${item.orderNumber}.`;
          break;
        case 'redeliver':
          replay = (await deliveryApi.redeliver(token, item.id)).idempotentReplay;
          message = `Nova tentativa solicitada para o pedido ${item.orderNumber}.`;
          break;
        case 'assign':
          replay = (await deliveryApi.assignCourier(token, item.id, action.courierUserId)).idempotentReplay;
          message = `Entregador atribuído ao pedido ${item.orderNumber}.`;
          break;
        case 'unassign':
          replay = (await deliveryApi.unassignCourier(token, item.id)).idempotentReplay;
          message = `Entregador removido do pedido ${item.orderNumber}.`;
          break;
        case 'notes':
          replay = (await deliveryApi.updateNotes(token, item.id, action.notes)).idempotentReplay;
          message = `Observação do pedido ${item.orderNumber} salva.`;
          break;
        case 'cancelOrder':
          await updateOrderStatus(token, item.orderId, 'CANCELLED');
          message = `Pedido ${item.orderNumber} cancelado.`;
          break;
      }
      toast.success(replay ? `Pedido ${item.orderNumber}: a ação já tinha sido registrada.` : message);
      await queryClient.invalidateQueries({ queryKey: ['delivery'] });
      return true;
    } catch (error) {
      toast.error(errorMessage(error, 'Não foi possível atualizar a entrega.'));
      await queryClient.invalidateQueries({ queryKey: ['delivery'] });
      return false;
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
  const modalBusy = modal ? busy.has(modal.item.id) : false;

  return (
    <Page wide>
      <PageHeader
        title="Delivery"
        description="Acompanhe, despache e trate as falhas das entregas da unidade."
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
        onChange={setStatus}
        items={DELIVERY_TABS.map((key) => ({ key, label: DELIVERY_STATUS_LABEL[key], count: data?.summary[key] }))}
      />

      <Card className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
        <SearchInput
          placeholder="Buscar nº do pedido ou cliente..."
          aria-label="Buscar entregas"
          maxLength={120}
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
        <Select
          aria-label="Situação do pedido"
          value={orderStatus}
          onChange={(event) => setOrderStatus(event.target.value as OrderStatus | '')}
        >
          <option value="">Todas as situações do pedido</option>
          {ORDER_STATUS_FILTERS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
        <Input type="date" aria-label="Dia do pedido" value={day} onChange={(event) => setDay(event.target.value)} />
        <Select aria-label="Entregador" value={courierFilter} onChange={(event) => setCourierChoice(event.target.value)}>
          <option value="">Todos os entregadores</option>
          {isCourier && <option value="me">Minhas entregas</option>}
          <option value="none">Sem entregador</option>
          {(couriers.data?.data ?? []).map((courier) => (
            <option key={courier.id} value={courier.id}>
              {courier.name}
            </option>
          ))}
        </Select>
        <Button variant="ghost" onClick={clearFilters} disabled={!filtersActive}>
          Limpar filtros
        </Button>
      </Card>

      {branchLoading || !branchId || query.isPending ? (
        <LoadingState label="Carregando entregas..." />
      ) : query.isError ? (
        <ErrorState message="Não foi possível carregar as entregas." onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={filtersActive ? <Search /> : <Truck />}
          title={filtersActive ? 'Nenhuma entrega encontrada' : DELIVERY_STATUS_LABEL[status]}
          description={filtersActive ? 'Ajuste a busca ou os filtros, ou limpe-os para ver tudo.' : EMPTY_TEXT[status]}
          action={
            filtersActive ? (
              <Button variant="outline" onClick={clearFilters}>
                Limpar filtros
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <TableWrap>
            <Table className="min-w-[1200px]">
              <THead>
                <Tr className="hover:bg-transparent">
                  <Th>Pedido</Th>
                  <Th>Cliente</Th>
                  <Th>Endereço e observações</Th>
                  <Th className="text-right">Valor</Th>
                  <Th>Pedido</Th>
                  <Th>Entrega</Th>
                  <Th>Entregador</Th>
                  {/* `relative` keeps the sr-only label inside the scrolling table wrapper. */}
                  <Th className="relative">
                    <span className="sr-only">Ações</span>
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map((item) => {
                  const isBusy = busy.has(item.id);
                  const attempt = attemptLabel(item);
                  return (
                    <Tr key={item.id}>
                      <Td>
                        <div className="font-semibold text-foreground">{item.orderNumber}</div>
                        <div className="text-xs tabular-nums text-muted-foreground">{formatTime(item.orderCreatedAt)}</div>
                      </Td>
                      <Td>
                        <div className="text-foreground">{item.customerName ?? '—'}</div>
                        <div className="text-xs text-muted-foreground">{item.customerPhone ?? ''}</div>
                      </Td>
                      <Td className="max-w-[24rem]">
                        <span className="block truncate" title={addressSummary(item.address)}>
                          {addressSummary(item.address)}
                        </span>
                        {item.deliveryNotes && (
                          <span className="block truncate text-xs text-foreground" title={item.deliveryNotes}>
                            Entrega: {item.deliveryNotes}
                          </span>
                        )}
                        {item.orderNotes && (
                          <span className="block truncate text-xs text-muted-foreground" title={item.orderNotes}>
                            Pedido: {item.orderNotes}
                          </span>
                        )}
                        {item.status === 'FAILED' && item.failureReason && (
                          <span className="block truncate text-xs text-danger" title={item.failureReason}>
                            Falha: {item.failureReason}
                          </span>
                        )}
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
                        {attempt && <div className="mt-1 text-xs text-muted-foreground">{attempt}</div>}
                      </Td>
                      <Td>
                        {item.courier ? (
                          <span className="font-medium text-foreground">{item.courier.name}</span>
                        ) : (
                          <span className="text-muted-foreground">Sem entregador</span>
                        )}
                      </Td>
                      <Td>
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {canAssign && item.canAssign && (
                            <Button
                              size="sm"
                              variant="outline"
                              icon={<UserPlus className="h-4 w-4" aria-hidden />}
                              disabled={isBusy}
                              onClick={() => setModal({ kind: 'assign', item })}
                            >
                              {item.courier ? 'Reatribuir' : 'Atribuir'}
                            </Button>
                          )}
                          {canAssign && item.canAssign && item.courier && (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Remover entregador do pedido ${item.orderNumber}`}
                              title="Remover entregador"
                              disabled={isBusy}
                              icon={<UserMinus className="h-4 w-4" aria-hidden />}
                              onClick={() => void run({ kind: 'unassign', item })}
                            />
                          )}
                          <Button
                            size="icon-sm"
                            variant="ghost"
                            aria-label={`Histórico da entrega ${item.orderNumber}`}
                            title="Histórico"
                            icon={<History className="h-4 w-4" aria-hidden />}
                            onClick={() => setModal({ kind: 'history', item })}
                          />
                          {item.status === 'PENDING' && (
                            <Button
                              size="sm"
                              icon={<PackageCheck className="h-4 w-4" aria-hidden />}
                              loading={isBusy}
                              disabled={!item.canDispatch || isBusy}
                              title={item.canDispatch ? undefined : 'Disponível quando o pedido estiver pronto.'}
                              onClick={() => void run({ kind: 'dispatch', item })}
                            >
                              {item.attemptCount > 0 ? 'Despachar novamente' : 'Despachar'}
                            </Button>
                          )}
                          {item.status === 'OUT_FOR_DELIVERY' && (
                            <>
                              <Button
                                size="sm"
                                icon={<CheckCircle2 className="h-4 w-4" aria-hidden />}
                                loading={isBusy}
                                disabled={isBusy}
                                onClick={() => void run({ kind: 'complete', item })}
                              >
                                Confirmar entrega
                              </Button>
                              <Button
                                size="sm"
                                variant="danger-ghost"
                                icon={<XCircle className="h-4 w-4" aria-hidden />}
                                disabled={isBusy}
                                onClick={() => setModal({ kind: 'fail', item })}
                              >
                                Marcar como falha
                              </Button>
                            </>
                          )}
                          {item.status === 'FAILED' && (
                            <>
                              <Button
                                size="sm"
                                icon={<RotateCcw className="h-4 w-4" aria-hidden />}
                                disabled={!item.canRedeliver || isBusy}
                                onClick={() => setModal({ kind: 'redeliver', item })}
                              >
                                Solicitar reentrega
                              </Button>
                              {canCancelOrder && (
                                <Button
                                  size="sm"
                                  variant="danger-ghost"
                                  disabled={isBusy}
                                  onClick={() => setModal({ kind: 'cancelOrder', item })}
                                >
                                  Cancelar pedido
                                </Button>
                              )}
                            </>
                          )}
                          {item.canEditNotes && (
                            <Button
                              size="icon-sm"
                              variant="ghost"
                              aria-label={`Editar observação da entrega ${item.orderNumber}`}
                              title="Observação da entrega"
                              disabled={isBusy}
                              icon={<Pencil className="h-4 w-4" aria-hidden />}
                              onClick={() => setModal({ kind: 'notes', item })}
                            />
                          )}
                        </div>
                      </Td>
                    </Tr>
                  );
                })}
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

      <FailDeliveryDialog
        open={modal?.kind === 'fail'}
        orderNumber={modal?.item.orderNumber ?? null}
        busy={modalBusy}
        onClose={() => setModal(null)}
        onSubmit={(reason) => (modal?.kind === 'fail' ? run({ kind: 'fail', item: modal.item, reason }) : Promise.resolve(false))}
      />
      <DeliveryNotesDialog
        open={modal?.kind === 'notes'}
        orderNumber={modal?.item.orderNumber ?? null}
        initial={modal?.kind === 'notes' ? modal.item.deliveryNotes : null}
        busy={modalBusy}
        onClose={() => setModal(null)}
        onSubmit={(notes) => (modal?.kind === 'notes' ? run({ kind: 'notes', item: modal.item, notes }) : Promise.resolve(false))}
      />
      <ConfirmDeliveryDialog
        open={modal?.kind === 'redeliver'}
        busy={modalBusy}
        title="Solicitar reentrega"
        description={modal ? `Pedido ${modal.item.orderNumber}` : undefined}
        confirmLabel="Solicitar reentrega"
        onClose={() => setModal(null)}
        onConfirm={() => (modal?.kind === 'redeliver' ? run({ kind: 'redeliver', item: modal.item }) : Promise.resolve(false))}
      >
        <p className="text-sm text-muted-foreground">
          A entrega volta para &ldquo;Pendente&rdquo; e poderá ser despachada de novo. A falha anterior fica registrada no histórico.
        </p>
      </ConfirmDeliveryDialog>
      <ConfirmDeliveryDialog
        open={modal?.kind === 'cancelOrder'}
        busy={modalBusy}
        danger
        title="Cancelar pedido"
        description={modal ? `Pedido ${modal.item.orderNumber}` : undefined}
        confirmLabel="Cancelar pedido"
        onClose={() => setModal(null)}
        onConfirm={() => (modal?.kind === 'cancelOrder' ? run({ kind: 'cancelOrder', item: modal.item }) : Promise.resolve(false))}
      >
        <p className="text-sm text-muted-foreground">
          O pedido será cancelado e o estoque consumido por ele será estornado. Esta ação não pode ser desfeita.
        </p>
      </ConfirmDeliveryDialog>

      <AssignCourierDialog
        item={modal?.kind === 'assign' ? modal.item : null}
        branchId={branchId as string}
        busy={modalBusy}
        onClose={() => setModal(null)}
        onSubmit={(courierUserId) =>
          modal?.kind === 'assign' ? run({ kind: 'assign', item: modal.item, courierUserId }) : Promise.resolve(false)
        }
      />
      <DeliveryHistoryDialog item={modal?.kind === 'history' ? modal.item : null} onClose={() => setModal(null)} />

      {canConfigure && <DeliverySettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} branchId={branchId} />}
    </Page>
  );
}
