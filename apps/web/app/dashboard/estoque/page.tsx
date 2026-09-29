'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  ArrowDownToLine,
  ArrowUpFromLine,
  CircleSlash,
  ClipboardList,
  PackageX,
  TrendingDown,
  Wallet,
} from 'lucide-react';
import clsx from 'clsx';
import { ApiError } from '@/lib/api-client';
import { useAuth } from '@/lib/auth-context';
import { formatCents } from '@/lib/cash-api';
import {
  formatDate,
  formatQuantity,
  formatSignedQuantity,
  InventoryAlert,
  InventoryAlertType,
  inventoryApi,
} from '@/lib/inventory-api';
import { Button } from '@/components/ds/Button';
import { Card, CardHeader } from '@/components/ds/Card';
import { StatCard } from '@/components/ds/StatCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Switch } from '@/components/ds/Switch';
import { Tabs } from '@/components/ds/Tabs';
import { useToast } from '@/components/ds/Toast';
import { AlertBadge, MovementTypeBadge } from '@/components/estoque/badges';
import { useEstoque } from '@/components/estoque/EstoqueProvider';
import { INVENTORY_QUERY_ROOT } from '@/components/estoque/use-inventory';

type AlertFilter = 'ALL' | 'LOW' | 'OUT' | 'EXPIRY' | 'NO_RECIPE';

const ALERT_FILTER_TYPES: Record<AlertFilter, InventoryAlertType[] | null> = {
  ALL: null,
  LOW: ['LOW_STOCK'],
  OUT: ['OUT_OF_STOCK'],
  EXPIRY: ['EXPIRED', 'EXPIRING_SOON'],
  NO_RECIPE: ['NO_RECIPE'],
};

const PERIODS = [
  { key: '7', label: '7 dias' },
  { key: '30', label: '30 dias' },
  { key: '90', label: '90 dias' },
] as const;

type PeriodKey = (typeof PERIODS)[number]['key'];

function startOfPeriod(days: number): string {
  const date = new Date();
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() - (days - 1));
  return date.toISOString();
}

export default function EstoqueOverviewPage() {
  const { accessToken } = useAuth();
  const { branchId } = useEstoque();
  const [period, setPeriod] = useState<PeriodKey>('30');
  const from = useMemo(() => startOfPeriod(Number(period)), [period]);

  const summary = useQuery({
    queryKey: [INVENTORY_QUERY_ROOT, 'summary', branchId, period],
    queryFn: () => inventoryApi.summary(accessToken as string, branchId as string, from),
    enabled: !!accessToken && !!branchId,
  });
  const data = summary.data;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">Indicadores da unidade selecionada</p>
        <Tabs variant="pill" value={period} onChange={setPeriod} items={PERIODS.map((p) => ({ key: p.key, label: p.label }))} />
      </div>

      {summary.isError ? (
        <ErrorState message="Não foi possível carregar os indicadores do estoque." onRetry={() => summary.refetch()} />
      ) : (
        <section aria-label="Indicadores" className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
          <StatCard
            label="Valor em estoque"
            value={data ? formatCents(data.stockValueCents) : '—'}
            hint={data ? `${data.activeItemCount} insumos ativos` : undefined}
            icon={<Wallet />}
            featured
            loading={summary.isLoading}
          />
          <StatCard
            label="Estoque baixo"
            value={data?.lowStockCount ?? '—'}
            hint="Abaixo ou no mínimo"
            icon={<AlertTriangle />}
            tone="warning"
            loading={summary.isLoading}
          />
          <StatCard
            label="Sem estoque"
            value={data?.outOfStockCount ?? '—'}
            hint="Saldo zerado ou negativo"
            icon={<PackageX />}
            tone="danger"
            loading={summary.isLoading}
          />
          <StatCard
            label="Entradas no período"
            value={data ? formatCents(data.entries.valueCents) : '—'}
            hint={data ? `${data.entries.count} lançamento(s)` : undefined}
            icon={<ArrowDownToLine />}
            tone="success"
            loading={summary.isLoading}
          />
          <StatCard
            label="Saídas no período"
            value={data ? formatCents(data.exits.valueCents) : '—'}
            hint={data ? `${data.exits.count} lançamento(s), inclui vendas` : undefined}
            icon={<ArrowUpFromLine />}
            tone="info"
            loading={summary.isLoading}
          />
          <StatCard
            label="Perdas no período"
            value={data ? formatCents(data.losses.valueCents) : '—'}
            hint={data ? `${data.losses.count} perda(s) e avaria(s)` : undefined}
            icon={<TrendingDown />}
            tone="danger"
            loading={summary.isLoading}
          />
        </section>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <AlertsPanel />
        <div className="space-y-4">
          <SettingsCard />
          <Card>
            <CardHeader
              title="Atividade recente"
              action={
                <Link href="/dashboard/estoque/movimentacoes">
                  <Button variant="ghost" size="sm">
                    Ver tudo
                  </Button>
                </Link>
              }
            />
            {summary.isLoading ? (
              <LoadingState className="py-6" />
            ) : !data || data.recentActivity.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nenhuma movimentação ainda.</p>
            ) : (
              <ul className="divide-y divide-line">
                {data.recentActivity.map((movement) => (
                  <li key={movement.id} className="flex items-center gap-3 px-4 py-2.5">
                    <MovementTypeBadge type={movement.type} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm text-foreground">{movement.inventoryItem.name}</span>
                      <span className="block truncate text-2xs text-subtle">
                        {new Date(movement.createdAt).toLocaleString('pt-BR', {
                          day: '2-digit',
                          month: '2-digit',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                        {movement.createdBy ? ` · ${movement.createdBy.name}` : ' · Sistema'}
                      </span>
                    </span>
                    <span
                      className={clsx(
                        'shrink-0 text-sm font-semibold',
                        movement.quantity < 0 ? 'text-danger' : 'text-success',
                      )}
                    >
                      {formatSignedQuantity(movement.quantity, movement.inventoryItem.unit)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}

function AlertsPanel() {
  const { accessToken } = useAuth();
  const { branchId, canManage, openEntry } = useEstoque();
  const [filter, setFilter] = useState<AlertFilter>('ALL');
  const query = useQuery({
    queryKey: [INVENTORY_QUERY_ROOT, 'alerts', branchId],
    queryFn: () => inventoryApi.alerts(accessToken as string, branchId as string),
    enabled: !!accessToken && !!branchId,
  });

  const counts = query.data?.counts;
  const types = ALERT_FILTER_TYPES[filter];
  const alerts = (query.data?.alerts ?? []).filter((alert) => !types || types.includes(alert.type));
  const total = query.data?.alerts.length ?? 0;

  return (
    <Card className="overflow-hidden">
      <CardHeader
        title="Alertas"
        description={query.data ? `Validade próxima: vence em até ${query.data.expiryWarningDays} dias` : undefined}
      />
      <div className="border-b border-line px-4 py-2.5">
        <Tabs
          variant="pill"
          value={filter}
          onChange={setFilter}
          items={[
            { key: 'ALL', label: 'Todos', count: total },
            { key: 'LOW', label: 'Baixo estoque', count: counts?.LOW_STOCK ?? 0 },
            { key: 'OUT', label: 'Sem estoque', count: counts?.OUT_OF_STOCK ?? 0 },
            { key: 'EXPIRY', label: 'Validade', count: (counts?.EXPIRED ?? 0) + (counts?.EXPIRING_SOON ?? 0) },
            { key: 'NO_RECIPE', label: 'Sem ficha', count: counts?.NO_RECIPE ?? 0 },
          ]}
        />
      </div>
      {query.isLoading ? (
        <LoadingState className="py-10" />
      ) : query.isError ? (
        <ErrorState className="m-4" message="Não foi possível carregar os alertas." onRetry={() => query.refetch()} />
      ) : alerts.length === 0 ? (
        <div className="p-4">
          <EmptyState
            icon={<CircleSlash />}
            title={total === 0 ? 'Nenhum alerta' : 'Nada neste filtro'}
            description={total === 0 ? 'Estoque, validades e fichas técnicas estão em ordem.' : undefined}
          />
        </div>
      ) : (
        <ul className="max-h-[28rem] divide-y divide-line overflow-y-auto">
          {alerts.map((alert, index) => (
            <AlertRow key={`${alert.type}-${alert.inventoryItemId ?? alert.productId}-${index}`} alert={alert} canManage={canManage} onEntry={openEntry} />
          ))}
        </ul>
      )}
    </Card>
  );
}

function AlertRow({
  alert,
  canManage,
  onEntry,
}: {
  alert: InventoryAlert;
  canManage: boolean;
  onEntry: (itemId?: string) => void;
}) {
  const detail = describeAlert(alert);
  return (
    <li className="flex flex-wrap items-center gap-3 px-4 py-3">
      <AlertBadge type={alert.type} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium text-foreground">{alert.name}</span>
        <span className="block truncate text-xs text-muted-foreground">{detail}</span>
      </span>
      {alert.type === 'NO_RECIPE' ? (
        <Link href="/dashboard/estoque/fichas">
          <Button variant="outline" size="sm" icon={<ClipboardList className="h-3.5 w-3.5" />}>
            Criar ficha
          </Button>
        </Link>
      ) : (
        canManage &&
        alert.inventoryItemId &&
        (alert.type === 'LOW_STOCK' || alert.type === 'OUT_OF_STOCK') && (
          <Button variant="outline" size="sm" icon={<ArrowDownToLine className="h-3.5 w-3.5" />} onClick={() => onEntry(alert.inventoryItemId!)}>
            Entrada
          </Button>
        )
      )}
    </li>
  );
}

function describeAlert(alert: InventoryAlert): string {
  if (alert.type === 'NO_RECIPE') return 'Produto ativo sem ficha técnica: vendas não baixam estoque.';
  const quantity = alert.quantity !== null && alert.unit ? formatQuantity(alert.quantity, alert.unit) : '';
  if (alert.type === 'OUT_OF_STOCK') return `Saldo ${quantity}`;
  if (alert.type === 'LOW_STOCK') {
    return `Saldo ${quantity} · mínimo ${alert.minStock !== null && alert.unit ? formatQuantity(alert.minStock, alert.unit) : '—'}`;
  }
  const lot = alert.lotCode ? `Lote ${alert.lotCode} · ` : '';
  const date = alert.expiresAt ? formatDate(alert.expiresAt) : '';
  const days = alert.daysToExpiry ?? 0;
  const when = days < 0 ? `venceu há ${-days} dia(s)` : days === 0 ? 'vence hoje' : `vence em ${days} dia(s)`;
  return `${lot}${quantity} estimados · ${date} (${when})`;
}

function SettingsCard() {
  const { accessToken } = useAuth();
  const { branchId, canManage } = useEstoque();
  const toast = useToast();
  const queryClient = useQueryClient();
  const key = [INVENTORY_QUERY_ROOT, 'settings', branchId];
  const settings = useQuery({
    queryKey: key,
    queryFn: () => inventoryApi.getSettings(accessToken as string, branchId as string),
    enabled: !!accessToken && !!branchId,
  });
  const update = useMutation({
    mutationFn: (value: boolean) => inventoryApi.updateSettings(accessToken as string, branchId as string, value),
    onSuccess: (result) => {
      queryClient.setQueryData(key, result);
      toast.success(result.allowNegativeStock ? 'Estoque negativo permitido.' : 'Estoque negativo bloqueado.');
    },
    onError: (err) => toast.error(err instanceof ApiError ? err.message : 'Não foi possível salvar.'),
  });

  return (
    <Card>
      <CardHeader title="Configuração da unidade" />
      <div className="space-y-4 p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-foreground">Permitir estoque negativo</p>
            <p className="text-2xs text-subtle">Desligado: saídas e vendas que deixariam o saldo negativo são bloqueadas.</p>
          </div>
          <Switch
            label="Permitir estoque negativo"
            checked={settings.data?.allowNegativeStock ?? false}
            disabled={!canManage || !settings.data || update.isPending}
            onChange={(value) => update.mutate(value)}
          />
        </div>
        <div className="border-t border-line pt-3">
          <p className="text-sm font-medium text-foreground">Quando o estoque zerar</p>
          <div className="mt-2 flex gap-1 rounded-ctl bg-surface-2 p-1 opacity-60" aria-disabled>
            <span className="flex-1 rounded-md px-2.5 py-1 text-center text-xs font-medium text-subtle">Pausar o produto</span>
            <span className="flex-1 rounded-md px-2.5 py-1 text-center text-xs font-medium text-subtle">Vender sob encomenda</span>
          </div>
          <p className="mt-1 text-2xs text-subtle">Disponível em breve.</p>
        </div>
      </div>
    </Card>
  );
}
