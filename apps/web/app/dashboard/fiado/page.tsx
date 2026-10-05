'use client';

import { useDeferredValue, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { NotebookPen, Plus, Search, X } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { formatPhone } from '@/lib/customers-logic';
import { ReceivableStatusFilter, receivablesApi } from '@/lib/receivables-api';
import { formatDateOnly, formatMoney, RECEIVABLE_TAB_LABEL, RECEIVABLE_TABS, receivableBadge } from '@/lib/receivables-logic';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Card } from '@/components/ds/Card';
import { SearchInput } from '@/components/ds/Input';
import { Page, PageHeader } from '@/components/ds/PageHeader';
import { StatCard } from '@/components/ds/StatCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { Tabs } from '@/components/ds/Tabs';
import { useToast } from '@/components/ds/Toast';
import { NewChargeDialog } from '@/components/receivables/NewChargeDialog';
import { ReceivableDetailDialog } from '@/components/receivables/ReceivableDetailDialog';

// The API decides who may do what (receivables.read/receive/manage); these only hide controls
// the caller would be refused anyway. CASHIER reads and receives; the rest is management.
const MANAGEMENT = ['OWNER', 'ADMIN', 'MANAGER'];
const CAN_READ = [...MANAGEMENT, 'CASHIER'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export default function ReceivablesPage() {
  const { user, accessToken } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const roles = user?.roles ?? [];
  const canRead = roles.some((role) => CAN_READ.includes(role));
  const canManage = roles.some((role) => MANAGEMENT.includes(role));

  const [status, setStatus] = useState<ReceivableStatusFilter>('open');
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const search = useDeferredValue(searchText.trim());

  // Deep links from the customer's dialog: ?conta=<id> opens one account, ?cliente=<id> lists
  // one customer's accounts. Anything that is not an id is ignored (the API validates it too).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const account = params.get('conta');
    const customer = params.get('cliente');
    if (account && UUID.test(account)) setDetailId(account);
    if (customer && UUID.test(customer)) {
      setCustomerId(customer);
      setStatus('all');
    }
  }, []);

  useEffect(() => setPage(1), [status, search, customerId]);

  const query = useQuery({
    queryKey: ['receivables', 'list', status, search, customerId, page],
    queryFn: () =>
      receivablesApi.list(accessToken as string, {
        status,
        search: search || undefined,
        customerId: customerId ?? undefined,
        page,
      }),
    enabled: !!accessToken && canRead,
    placeholderData: (previous) => previous,
  });

  function clearCustomer() {
    setCustomerId(null);
    window.history.replaceState(null, '', window.location.pathname);
  }

  if (!canRead) {
    return (
      <Page>
        <EmptyState
          icon={<NotebookPen />}
          title="Sem acesso a Contas a receber"
          description="Somente proprietários, administradores, gerentes e caixas acessam o fiado."
        />
      </Page>
    );
  }

  const data = query.data;
  const rows = data?.data ?? [];
  const summary = data?.summary;
  const filtering = search !== '' || customerId !== null;
  const filteredCustomerName = customerId && rows.length > 0 ? rows[0].customer.name : null;

  return (
    <Page wide>
      <PageHeader
        title="Contas a receber"
        description="Fiado: o que os clientes devem, parcelas, vencimentos e recebimentos."
        actions={
          canManage ? (
            <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setCreating(true)}>
              Lançar dívida
            </Button>
          ) : undefined
        }
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard
          label="Em aberto"
          value={summary ? formatMoney(summary.openCents) : '—'}
          hint={summary ? `${summary.openCount} ${summary.openCount === 1 ? 'conta' : 'contas'}` : undefined}
          loading={query.isPending}
          featured
        />
        <StatCard
          label="Vencido"
          value={summary ? formatMoney(summary.overdueCents) : '—'}
          hint={summary ? `${summary.overdueCount} ${summary.overdueCount === 1 ? 'conta com atraso' : 'contas com atraso'}` : undefined}
          tone={summary && summary.overdueCents > 0 ? 'danger' : 'neutral'}
          loading={query.isPending}
        />
        <StatCard
          label="Clientes devendo"
          value={summary ? summary.customersInDebt : '—'}
          hint="Nas unidades que você acessa"
          loading={query.isPending}
        />
      </div>

      <Tabs
        variant="pill"
        value={status}
        onChange={setStatus}
        items={RECEIVABLE_TABS.map((key) => ({
          key,
          label: RECEIVABLE_TAB_LABEL[key],
          count: summary ? (key === 'open' ? summary.openCount : key === 'overdue' ? summary.overdueCount : undefined) : undefined,
        }))}
      />

      <Card className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <SearchInput
          placeholder="Buscar por cliente, telefone, descrição ou número do pedido..."
          aria-label="Buscar contas a receber"
          maxLength={120}
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
        {customerId && (
          <Button variant="outline" icon={<X className="h-4 w-4" aria-hidden />} onClick={clearCustomer}>
            {filteredCustomerName ? `Só ${filteredCustomerName}` : 'Só um cliente'} — ver todos
          </Button>
        )}
      </Card>

      {query.isPending ? (
        <LoadingState label="Carregando contas..." />
      ) : query.isError ? (
        <ErrorState message="Não foi possível carregar as contas a receber." onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={filtering ? <Search /> : <NotebookPen />}
          title={filtering ? 'Nenhuma conta encontrada' : status === 'open' ? 'Nenhuma conta em aberto' : 'Nenhuma conta aqui'}
          description={
            filtering
              ? 'Ajuste a busca ou troque a aba.'
              : 'Vendas fiado feitas no PDV ou na mesa e dívidas lançadas aparecem aqui. Para vender fiado, defina o limite do cliente em Clientes.'
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <TableWrap>
            <Table className="min-w-[860px]">
              <THead>
                <Tr className="hover:bg-transparent">
                  <Th>Cliente</Th>
                  <Th>Conta</Th>
                  <Th>Próximo vencimento</Th>
                  <Th className="text-right">Total</Th>
                  <Th className="text-right">Em aberto</Th>
                  <Th>Situação</Th>
                  <Th className="relative">
                    <span className="sr-only">Ações</span>
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map((receivable) => {
                  const badge = receivableBadge(receivable);
                  return (
                    <Tr key={receivable.id}>
                      <Td>
                        <div className="font-semibold text-foreground">{receivable.customer.name}</div>
                        <div className="text-xs tabular-nums text-muted-foreground">{formatPhone(receivable.customer.phone)}</div>
                      </Td>
                      <Td>
                        <div className="max-w-[18rem] truncate text-foreground" title={receivable.description}>
                          {receivable.description}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {receivable.installments.length}x · {receivable.branch.name}
                        </div>
                      </Td>
                      <Td className="tabular-nums text-muted-foreground">{formatDateOnly(receivable.nextDueDate)}</Td>
                      <Td className="text-right tabular-nums">{formatMoney(receivable.totalCents)}</Td>
                      <Td className="text-right font-semibold tabular-nums text-foreground">{formatMoney(receivable.openCents)}</Td>
                      <Td>
                        <Badge tone={badge.tone} dot>
                          {badge.label}
                        </Badge>
                      </Td>
                      <Td className="text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          aria-label={`Abrir conta de ${receivable.customer.name}: ${receivable.description}`}
                          onClick={() => setDetailId(receivable.id)}
                        >
                          {receivable.status === 'OPEN' ? 'Receber' : 'Ver'}
                        </Button>
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
                Página {data.meta.page} de {data.meta.totalPages} · {data.meta.total} contas
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

      <ReceivableDetailDialog receivableId={detailId} canReceive={canRead} canManage={canManage} onClose={() => setDetailId(null)} />
      <NewChargeDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(created) => {
          setCreating(false);
          toast.success(`Dívida de ${formatMoney(created.totalCents)} lançada para ${created.customer.name}.`);
          void queryClient.invalidateQueries({ queryKey: ['receivables'] });
          setDetailId(created.id);
        }}
      />
    </Page>
  );
}
