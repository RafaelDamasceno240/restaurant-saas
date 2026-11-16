'use client';

import { useDeferredValue, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { formatPhone } from '@/lib/customers-logic';
import { ReportFilters, reportsApi } from '@/lib/reports-api';
import {
  activeHours,
  describePeriod,
  formatBps,
  formatDayShort,
  formatHour,
  formatMoney,
  FULFILLMENT_LABEL,
  labelOf,
  PAYMENT_METHOD_LABEL,
  peakHour,
  SOURCE_LABEL,
} from '@/lib/reports-logic';
import { Badge } from '@/components/ds/Badge';
import { Card } from '@/components/ds/Card';
import { SearchInput, Select } from '@/components/ds/Input';
import { StatCard } from '@/components/ds/StatCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { BarList, ColumnChart, ReportCard, ReportPager } from './charts';

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

// ---- sales ----------------------------------------------------------------------------------

export function SalesPanel({ filters }: { filters: ReportFilters }) {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: ['reports', 'sales', filters],
    queryFn: () => reportsApi.sales(accessToken as string, filters),
    enabled: !!accessToken,
    placeholderData: (previous) => previous,
  });

  if (query.isPending) return <LoadingState label="Calculando vendas..." />;
  if (query.isError || !query.data) return <ErrorState message="Não foi possível carregar o relatório de vendas." onRetry={() => void query.refetch()} />;

  const { totals, byDay, byHour, byPaymentMethod, bySource, byFulfillment, period } = query.data;
  const peak = peakHour(byHour);
  const breakdown = (rows: typeof byPaymentMethod, labels: Record<string, string>) =>
    rows.map((row) => ({
      key: row.key,
      label: labelOf(labels, row.key),
      value: row.totalCents,
      display: formatMoney(row.totalCents),
      hint: plural(row.ordersCount, 'pedido', 'pedidos'),
    }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Vendas" value={formatMoney(totals.totalCents)} hint={describePeriod(period)} featured />
        <StatCard label="Pedidos" value={totals.ordersCount} hint={`${totals.concludedCount} já concluídos`} />
        <StatCard label="Ticket médio" value={formatMoney(totals.averageTicketCents)} />
        <StatCard
          label="Cancelados"
          value={totals.cancelledCount}
          hint={totals.cancelledCount > 0 ? `${formatMoney(totals.cancelledCents)} fora das vendas` : 'Não entram nas vendas'}
          tone={totals.cancelledCount > 0 ? 'danger' : 'neutral'}
        />
      </div>

      <ReportCard title="Vendas por dia" hint="Pedidos não cancelados, no dia em que foram feitos (horário do restaurante).">
        <ColumnChart
          label={`Vendas por dia: ${formatMoney(totals.totalCents)} em ${plural(totals.ordersCount, 'pedido', 'pedidos')}, ${describePeriod(period)}`}
          emptyText="Nenhuma venda no período."
          data={byDay.map((row) => ({
            key: row.day,
            label: formatDayShort(row.day),
            value: row.totalCents,
            title: `${formatDayShort(row.day)}: ${formatMoney(row.totalCents)} em ${plural(row.ordersCount, 'pedido', 'pedidos')}`,
          }))}
        />
      </ReportCard>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReportCard
          title="Horários"
          hint={peak ? `Pico às ${formatHour(peak.hour)}: ${formatMoney(peak.totalCents)} em ${plural(peak.ordersCount, 'pedido', 'pedidos')}.` : undefined}
        >
          <ColumnChart
            label="Vendas por hora do dia"
            emptyText="Nenhuma venda no período."
            data={activeHours(byHour).map((row) => ({
              key: String(row.hour),
              label: formatHour(row.hour),
              value: row.totalCents,
              title: `${formatHour(row.hour)}: ${formatMoney(row.totalCents)} em ${plural(row.ordersCount, 'pedido', 'pedidos')}`,
            }))}
          />
        </ReportCard>

        <ReportCard title="Composição" hint="Do valor dos itens ao total vendido.">
          <dl className="space-y-1.5 text-sm">
            {[
              ['Itens', formatMoney(totals.itemsCents)],
              ['Descontos de cupom', `− ${formatMoney(totals.discountCents)}`],
              ['Cashback usado', `− ${formatMoney(totals.cashbackUsedCents)}`],
              ['Taxas de entrega', `+ ${formatMoney(totals.deliveryFeeCents)}`],
            ].map(([label, value]) => (
              <div key={label} className="flex justify-between gap-3">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="tabular-nums text-foreground">{value}</dd>
              </div>
            ))}
            <div className="flex justify-between gap-3 border-t border-line pt-1.5 font-semibold">
              <dt className="text-foreground">Total vendido</dt>
              <dd className="tabular-nums text-accent">{formatMoney(totals.totalCents)}</dd>
            </div>
            <div className="flex justify-between gap-3 pt-1 text-xs">
              <dt className="text-muted-foreground">Vendido fiado (a receber)</dt>
              <dd className="tabular-nums text-muted-foreground">{formatMoney(totals.onAccountCents)}</dd>
            </div>
            <div className="flex justify-between gap-3 text-xs">
              <dt className="text-muted-foreground">De pedidos já concluídos</dt>
              <dd className="tabular-nums text-muted-foreground">{formatMoney(totals.concludedCents)}</dd>
            </div>
          </dl>
        </ReportCard>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <ReportCard title="Forma de pagamento">
          <BarList emptyText="Sem vendas." data={breakdown(byPaymentMethod, PAYMENT_METHOD_LABEL)} />
        </ReportCard>
        <ReportCard title="Origem">
          <BarList emptyText="Sem vendas." data={breakdown(bySource, SOURCE_LABEL)} />
        </ReportCard>
        <ReportCard title="Tipo de atendimento">
          <BarList emptyText="Sem vendas." data={breakdown(byFulfillment, FULFILLMENT_LABEL)} />
        </ReportCard>
      </div>
    </div>
  );
}

// ---- products -------------------------------------------------------------------------------

export function ProductsPanel({ filters }: { filters: ReportFilters }) {
  const { accessToken } = useAuth();
  const [sort, setSort] = useState<'revenue' | 'quantity'>('revenue');
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const search = useDeferredValue(searchText.trim());
  useEffect(() => setPage(1), [filters, sort, search]);

  const query = useQuery({
    queryKey: ['reports', 'products', filters, sort, search, page],
    queryFn: () => reportsApi.products(accessToken as string, { ...filters, sort, search: search || undefined, page }),
    enabled: !!accessToken,
    placeholderData: (previous) => previous,
  });

  const data = query.data;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard label="Faturamento dos itens" value={data ? formatMoney(data.totals.revenueCents) : '—'} hint="Antes de cupons e cashback" loading={query.isPending} featured />
        <StatCard label="Unidades vendidas" value={data ? data.totals.quantity.toLocaleString('pt-BR') : '—'} loading={query.isPending} />
        <StatCard label="Produtos com venda" value={data ? data.totals.productsCount : '—'} loading={query.isPending} />
      </div>

      <Card className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <SearchInput placeholder="Buscar produto..." aria-label="Buscar produto" maxLength={120} value={searchText} onChange={(event) => setSearchText(event.target.value)} />
        <Select aria-label="Ordenar produtos" value={sort} onChange={(event) => setSort(event.target.value as 'revenue' | 'quantity')}>
          <option value="revenue">Maior faturamento</option>
          <option value="quantity">Maior quantidade</option>
        </Select>
      </Card>

      {query.isPending ? (
        <LoadingState label="Calculando produtos..." />
      ) : query.isError || !data ? (
        <ErrorState message="Não foi possível carregar o relatório de produtos." onRetry={() => void query.refetch()} />
      ) : data.data.length === 0 ? (
        <EmptyState title="Nenhum produto vendido" description={search ? 'Nenhum produto com esse nome teve venda no período.' : 'Não houve vendas no período.'} />
      ) : (
        <Card className="overflow-hidden">
          <TableWrap>
            <Table className="min-w-[720px]">
              <THead>
                <Tr className="hover:bg-transparent">
                  <Th className="w-10">#</Th>
                  <Th>Produto</Th>
                  <Th className="text-right">Quantidade</Th>
                  <Th className="text-right">Pedidos</Th>
                  <Th className="text-right">Faturamento</Th>
                  <Th className="text-right">Participação</Th>
                </Tr>
              </THead>
              <TBody>
                {data.data.map((row, index) => (
                  <Tr key={row.productId}>
                    <Td className="tabular-nums text-subtle">{(data.meta.page - 1) * data.meta.pageSize + index + 1}</Td>
                    <Td>
                      <div className="flex items-center gap-2 font-medium text-foreground">
                        {row.name}
                        {!row.active && <Badge tone="neutral">Inativo</Badge>}
                      </div>
                      <div className="text-xs text-muted-foreground">{row.categoryName}</div>
                    </Td>
                    <Td className="text-right tabular-nums">{row.quantity.toLocaleString('pt-BR')}</Td>
                    <Td className="text-right tabular-nums">{row.ordersCount}</Td>
                    <Td className="text-right font-semibold tabular-nums text-foreground">{formatMoney(row.revenueCents)}</Td>
                    <Td className="text-right tabular-nums text-muted-foreground">{formatBps(row.shareBps)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <ReportPager meta={data.meta} noun="produtos" onPage={setPage} />
        </Card>
      )}
    </div>
  );
}

// ---- customers ------------------------------------------------------------------------------

export function CustomersPanel({ filters }: { filters: ReportFilters }) {
  const { accessToken } = useAuth();
  const [sort, setSort] = useState<'total' | 'orders'>('total');
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [filters, sort]);

  const query = useQuery({
    queryKey: ['reports', 'customers', filters, sort, page],
    queryFn: () => reportsApi.customers(accessToken as string, { ...filters, sort, page }),
    enabled: !!accessToken,
    placeholderData: (previous) => previous,
  });

  const data = query.data;
  const totals = data?.totals;
  const allOrders = totals ? totals.identifiedOrders + totals.anonymousOrders : 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Clientes que compraram" value={totals ? totals.customersCount : '—'} loading={query.isPending} featured />
        <StatCard
          label="Vendas identificadas"
          value={totals ? formatMoney(totals.identifiedCents) : '—'}
          hint={totals ? `${plural(totals.identifiedOrders, 'pedido', 'pedidos')} com cliente cadastrado` : undefined}
          loading={query.isPending}
        />
        <StatCard
          label="Vendas sem cadastro"
          value={totals ? formatMoney(totals.anonymousCents) : '—'}
          hint={totals && allOrders > 0 ? `${plural(totals.anonymousOrders, 'pedido', 'pedidos')} (${formatBps(Math.round((totals.anonymousOrders * 10_000) / allOrders))})` : undefined}
          loading={query.isPending}
        />
        <StatCard label="Novos cadastros" value={totals ? totals.newCustomers : '—'} hint="Clientes cadastrados no período" loading={query.isPending} />
      </div>

      <Card className="flex flex-wrap items-center justify-between gap-3 p-3">
        <p className="text-sm text-muted-foreground">Clientes cadastrados com pedido no período (pedidos cancelados não contam).</p>
        <div className="w-full sm:w-56">
          <Select aria-label="Ordenar clientes" value={sort} onChange={(event) => setSort(event.target.value as 'total' | 'orders')}>
            <option value="total">Maior gasto</option>
            <option value="orders">Mais pedidos</option>
          </Select>
        </div>
      </Card>

      {query.isPending ? (
        <LoadingState label="Calculando clientes..." />
      ) : query.isError || !data ? (
        <ErrorState message="Não foi possível carregar o relatório de clientes." onRetry={() => void query.refetch()} />
      ) : data.data.length === 0 ? (
        <EmptyState title="Nenhum cliente com pedido" description="Vendas com cliente selecionado no PDV, na mesa ou vinculado ao pedido aparecem aqui." />
      ) : (
        <Card className="overflow-hidden">
          <TableWrap>
            <Table className="min-w-[720px]">
              <THead>
                <Tr className="hover:bg-transparent">
                  <Th className="w-10">#</Th>
                  <Th>Cliente</Th>
                  <Th className="text-right">Pedidos</Th>
                  <Th className="text-right">Total gasto</Th>
                  <Th className="text-right">Ticket médio</Th>
                  <Th>Último pedido</Th>
                </Tr>
              </THead>
              <TBody>
                {data.data.map((row, index) => (
                  <Tr key={row.customerId}>
                    <Td className="tabular-nums text-subtle">{(data.meta.page - 1) * data.meta.pageSize + index + 1}</Td>
                    <Td>
                      <div className="flex items-center gap-2 font-medium text-foreground">
                        {row.name}
                        {!row.active && <Badge tone="neutral">Inativo</Badge>}
                      </div>
                      <div className="text-xs tabular-nums text-muted-foreground">{formatPhone(row.phone)}</div>
                    </Td>
                    <Td className="text-right tabular-nums">{row.ordersCount}</Td>
                    <Td className="text-right font-semibold tabular-nums text-foreground">{formatMoney(row.totalCents)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(row.averageTicketCents)}</Td>
                    <Td className="tabular-nums text-muted-foreground">{formatDate(row.lastOrderAt)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <ReportPager meta={data.meta} noun="clientes" onPage={setPage} />
        </Card>
      )}
    </div>
  );
}
