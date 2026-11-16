'use client';

import { useDeferredValue, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { ReportFilters, reportsApi } from '@/lib/reports-api';
import { describePeriod, formatBps, formatDayShort, formatMinutes, formatMoney, formatQuantity } from '@/lib/reports-logic';
import { Badge } from '@/components/ds/Badge';
import { Card } from '@/components/ds/Card';
import { SearchInput, Select } from '@/components/ds/Input';
import { StatCard } from '@/components/ds/StatCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { BarList, ColumnChart, ReportCard, ReportPager } from './charts';

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;
const formatDateTime = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });

// ---- inventory ------------------------------------------------------------------------------

type InventorySort = 'consumption' | 'loss' | 'name';

export function InventoryPanel({ filters }: { filters: ReportFilters }) {
  const { accessToken } = useAuth();
  const [sort, setSort] = useState<InventorySort>('consumption');
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const search = useDeferredValue(searchText.trim());
  useEffect(() => setPage(1), [filters, sort, search]);

  const query = useQuery({
    queryKey: ['reports', 'inventory', filters, sort, search, page],
    queryFn: () => reportsApi.inventory(accessToken as string, { ...filters, sort, search: search || undefined, page }),
    enabled: !!accessToken,
    placeholderData: (previous) => previous,
  });

  const data = query.data;
  const totals = data?.totals;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Consumo por vendas" value={totals ? formatMoney(totals.soldCostCents) : '—'} hint="Custo dos insumos das fichas técnicas" loading={query.isPending} featured />
        <StatCard label="Compras e entradas" value={totals ? formatMoney(totals.purchasedCostCents) : '—'} loading={query.isPending} />
        <StatCard label="Saídas manuais" value={totals ? formatMoney(totals.otherExitCostCents) : '—'} hint="Consumo e outros motivos" loading={query.isPending} />
        <StatCard
          label="Perdas e avarias"
          value={totals ? formatMoney(totals.lossCostCents) : '—'}
          tone={totals && totals.lossCostCents > 0 ? 'danger' : 'neutral'}
          loading={query.isPending}
        />
      </div>

      <Card className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_14rem]">
        <SearchInput placeholder="Buscar insumo..." aria-label="Buscar insumo" maxLength={120} value={searchText} onChange={(event) => setSearchText(event.target.value)} />
        <Select aria-label="Ordenar insumos" value={sort} onChange={(event) => setSort(event.target.value as InventorySort)}>
          <option value="consumption">Maior consumo</option>
          <option value="loss">Maior perda</option>
          <option value="name">Nome</option>
        </Select>
      </Card>

      {query.isPending ? (
        <LoadingState label="Calculando estoque..." />
      ) : query.isError || !data ? (
        <ErrorState message="Não foi possível carregar o relatório de estoque." onRetry={() => void query.refetch()} />
      ) : data.data.length === 0 ? (
        <EmptyState
          title="Nenhuma movimentação de estoque"
          description={search ? 'Nenhum insumo com esse nome movimentou no período.' : 'Entradas, vendas com ficha técnica, saídas e perdas do período aparecem aqui.'}
        />
      ) : (
        <Card className="overflow-hidden">
          <TableWrap>
            <Table className="min-w-[880px]">
              <THead>
                <Tr className="hover:bg-transparent">
                  <Th>Insumo</Th>
                  <Th className="text-right">Entradas</Th>
                  <Th className="text-right">Consumo (vendas)</Th>
                  <Th className="text-right">Saídas manuais</Th>
                  <Th className="text-right">Perdas</Th>
                  <Th className="text-right">Em estoque agora</Th>
                </Tr>
              </THead>
              <TBody>
                {data.data.map((row) => (
                  <Tr key={row.inventoryItemId}>
                    <Td>
                      <div className="flex items-center gap-2 font-medium text-foreground">
                        {row.name}
                        {!row.active && <Badge tone="neutral">Inativo</Badge>}
                      </div>
                    </Td>
                    <Td className="text-right tabular-nums">
                      <div>{formatQuantity(row.purchasedQuantity, row.unit)}</div>
                      <div className="text-xs text-muted-foreground">{formatMoney(row.purchasedCostCents)}</div>
                    </Td>
                    <Td className="text-right tabular-nums">
                      <div>{formatQuantity(row.soldQuantity, row.unit)}</div>
                      <div className="text-xs text-muted-foreground">{formatMoney(row.soldCostCents)}</div>
                    </Td>
                    <Td className="text-right tabular-nums">
                      <div>{formatQuantity(row.otherExitQuantity, row.unit)}</div>
                      <div className="text-xs text-muted-foreground">{formatMoney(row.otherExitCostCents)}</div>
                    </Td>
                    <Td className="text-right tabular-nums">
                      <div className={row.lossQuantity > 0 ? 'text-danger' : undefined}>{formatQuantity(row.lossQuantity, row.unit)}</div>
                      <div className="text-xs text-muted-foreground">{formatMoney(row.lossCostCents)}</div>
                    </Td>
                    <Td className="text-right font-semibold tabular-nums text-foreground">{formatQuantity(row.currentQuantity, row.unit)}</Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <ReportPager meta={data.meta} noun="insumos" onPage={setPage} />
        </Card>
      )}
      <p className="text-xs text-muted-foreground">
        Valores pelo custo registrado em cada movimentação. Posição, alertas e validade ficam em Estoque.
      </p>
    </div>
  );
}

// ---- delivery -------------------------------------------------------------------------------

export function DeliveryPanel({ filters }: { filters: ReportFilters }) {
  const { accessToken } = useAuth();
  const query = useQuery({
    queryKey: ['reports', 'delivery', filters],
    queryFn: () => reportsApi.delivery(accessToken as string, filters),
    enabled: !!accessToken,
    placeholderData: (previous) => previous,
  });

  if (query.isPending) return <LoadingState label="Calculando entregas..." />;
  if (query.isError || !query.data) return <ErrorState message="Não foi possível carregar o relatório de delivery." onRetry={() => void query.refetch()} />;

  const { totals, byCourier, byDay, period } = query.data;
  if (totals.total === 0) {
    return <EmptyState title="Nenhuma entrega no período" description="Pedidos para entrega criados no período aparecem aqui." />;
  }
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Entregas" value={totals.total} hint={describePeriod(period)} featured />
        <StatCard label="Entregues" value={totals.delivered} hint={`Taxa de sucesso ${formatBps(totals.successRateBps)}`} tone="success" />
        <StatCard label="Tempo em rota" value={formatMinutes(totals.averageRouteMinutes)} hint={`Do pedido à porta: ${formatMinutes(totals.averageDoorMinutes)}`} />
        <StatCard label="Taxas de entrega" value={formatMoney(totals.feeCents)} hint={`${formatMoney(totals.deliveredOrdersCents)} em pedidos entregues`} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ReportCard title="Situação" hint={`${plural(totals.attempts, 'saída', 'saídas')} para entrega; ${plural(totals.redelivered, 'entrega precisou', 'entregas precisaram')} de mais de uma.`}>
          <BarList
            emptyText="Sem entregas."
            data={[
              { key: 'delivered', label: 'Entregues', value: totals.delivered },
              { key: 'out', label: 'Em rota', value: totals.outForDelivery },
              { key: 'pending', label: 'Aguardando despacho', value: totals.pending },
              { key: 'failed', label: 'Falharam', value: totals.failed },
              { key: 'cancelled', label: 'Canceladas', value: totals.cancelled },
            ].map((row) => ({ ...row, display: String(row.value) }))}
          />
        </ReportCard>
        <ReportCard title="Entregas por dia" hint="Pelo dia em que o pedido foi feito.">
          <ColumnChart
            label={`Entregas por dia: ${totals.total} no período`}
            emptyText="Sem entregas."
            data={byDay.map((row) => ({
              key: row.day,
              label: formatDayShort(row.day),
              value: row.total,
              title: `${formatDayShort(row.day)}: ${plural(row.total, 'entrega', 'entregas')}, ${row.delivered} entregue(s)`,
            }))}
          />
        </ReportCard>
      </div>

      <Card className="overflow-hidden">
        <div className="border-b border-line px-4 py-3">
          <h3 className="text-sm font-semibold text-foreground">Por entregador</h3>
        </div>
        <TableWrap>
          <Table className="min-w-[560px]">
            <THead>
              <Tr className="hover:bg-transparent">
                <Th>Entregador</Th>
                <Th className="text-right">Entregas</Th>
                <Th className="text-right">Entregues</Th>
                <Th className="text-right">Falhas</Th>
                <Th className="text-right">Tempo médio em rota</Th>
              </Tr>
            </THead>
            <TBody>
              {byCourier.map((row) => (
                <Tr key={row.courierId ?? 'none'}>
                  <Td className={row.courierId ? 'font-medium text-foreground' : 'text-muted-foreground'}>{row.courierName ?? 'Sem entregador atribuído'}</Td>
                  <Td className="text-right tabular-nums">{row.total}</Td>
                  <Td className="text-right tabular-nums">{row.delivered}</Td>
                  <Td className="text-right tabular-nums">{row.failed}</Td>
                  <Td className="text-right tabular-nums">{formatMinutes(row.averageRouteMinutes)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </Card>
    </div>
  );
}

// ---- cash -----------------------------------------------------------------------------------

export function CashPanel({ filters }: { filters: ReportFilters }) {
  const { accessToken } = useAuth();
  const [page, setPage] = useState(1);
  useEffect(() => setPage(1), [filters]);

  const query = useQuery({
    queryKey: ['reports', 'cash', filters, page],
    queryFn: () => reportsApi.cash(accessToken as string, { ...filters, page }),
    enabled: !!accessToken,
    placeholderData: (previous) => previous,
  });

  const data = query.data;
  const totals = data?.totals;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Vendas em dinheiro"
          value={totals ? formatMoney(totals.salesCents) : '—'}
          hint={
            totals
              ? `${plural(totals.sessions, 'sessão', 'sessões')}, ${totals.open} aberta(s)${
                  totals.saleRefundsCents > 0 ? ` · estornos: − ${formatMoney(totals.saleRefundsCents)}` : ''
                }`
              : undefined
          }
          loading={query.isPending}
          featured
        />
        <StatCard
          label="Fiado recebido"
          value={totals ? formatMoney(totals.receivablePaymentsCents) : '—'}
          hint={totals && totals.receivableRefundsCents > 0 ? `Estornos: − ${formatMoney(totals.receivableRefundsCents)}` : 'Em dinheiro'}
          loading={query.isPending}
        />
        <StatCard
          label="Suprimentos e sangrias"
          value={totals ? `+ ${formatMoney(totals.suppliesCents)}` : '—'}
          hint={totals ? `Sangrias: − ${formatMoney(totals.withdrawalsCents)}` : undefined}
          loading={query.isPending}
        />
        <StatCard
          label="Diferenças no fechamento"
          value={totals ? formatMoney(totals.shortageCents + totals.surplusCents) : '—'}
          hint={totals ? `Faltas ${formatMoney(totals.shortageCents)} · sobras ${formatMoney(totals.surplusCents)}` : undefined}
          tone={totals && totals.shortageCents < 0 ? 'danger' : 'neutral'}
          loading={query.isPending}
        />
      </div>

      {query.isPending ? (
        <LoadingState label="Calculando caixa..." />
      ) : query.isError || !data ? (
        <ErrorState message="Não foi possível carregar o relatório de caixa." onRetry={() => void query.refetch()} />
      ) : data.data.length === 0 ? (
        <EmptyState title="Nenhuma sessão de caixa" description="Caixas abertos no período aparecem aqui, com o que passou por cada gaveta." />
      ) : (
        <Card className="overflow-hidden">
          <TableWrap>
            <Table className="min-w-[980px]">
              <THead>
                <Tr className="hover:bg-transparent">
                  <Th>Abertura</Th>
                  <Th>Unidade</Th>
                  <Th className="text-right">Saldo inicial</Th>
                  <Th className="text-right">Vendas</Th>
                  <Th className="text-right">Fiado</Th>
                  <Th className="text-right">Suprim. / sangrias</Th>
                  <Th className="text-right">Esperado</Th>
                  <Th className="text-right">Contado</Th>
                  <Th className="text-right">Diferença</Th>
                </Tr>
              </THead>
              <TBody>
                {data.data.map((row) => (
                  <Tr key={row.id}>
                    <Td>
                      <div className="flex items-center gap-2 whitespace-nowrap text-foreground">
                        {formatDateTime(row.openedAt)}
                        <Badge tone={row.status === 'OPEN' ? 'success' : 'neutral'}>{row.status === 'OPEN' ? 'Aberto' : 'Fechado'}</Badge>
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {row.openedBy.name}
                        {row.closedAt ? ` · fechado ${formatDateTime(row.closedAt)}` : ''}
                      </div>
                    </Td>
                    <Td className="text-muted-foreground">{row.branch.name}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(row.openingBalanceCents)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(row.totals.salesCents - row.totals.saleRefundsCents)}</Td>
                    <Td className="text-right tabular-nums">{formatMoney(row.totals.receivablePaymentsCents - row.totals.receivableRefundsCents)}</Td>
                    <Td className="whitespace-nowrap text-right tabular-nums">
                      + {formatMoney(row.totals.suppliesCents)} / − {formatMoney(row.totals.withdrawalsCents)}
                    </Td>
                    <Td className="text-right font-semibold tabular-nums text-foreground">{formatMoney(row.expectedBalanceCents)}</Td>
                    <Td className="text-right tabular-nums">{row.countedClosingBalanceCents === null ? '—' : formatMoney(row.countedClosingBalanceCents)}</Td>
                    <Td
                      className={
                        row.differenceCents === null || row.differenceCents === 0
                          ? 'text-right tabular-nums text-muted-foreground'
                          : row.differenceCents < 0
                            ? 'text-right font-semibold tabular-nums text-danger'
                            : 'text-right font-semibold tabular-nums text-success'
                      }
                    >
                      {row.differenceCents === null ? '—' : formatMoney(row.differenceCents)}
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          <ReportPager meta={data.meta} noun="sessões" onPage={setPage} />
        </Card>
      )}
    </div>
  );
}
