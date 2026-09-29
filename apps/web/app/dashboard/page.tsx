'use client';

import Link from 'next/link';
import {
  BookOpen,
  ChefHat,
  ClipboardList,
  DollarSign,
  Flame,
  LayoutGrid,
  Receipt,
  Store,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { formatBRL, timeAgo } from '@/lib/format';
import { useDashboardStats } from '@/lib/use-dashboard-stats';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Card, CardHeader } from '@/components/ds/Card';
import { Page, PageHeader } from '@/components/ds/PageHeader';
import { StatCard } from '@/components/ds/StatCard';
import { EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { OrdersTable } from '@/components/pedidos/OrdersTable';
import { STATUS_LABEL } from '@/components/pedidos/StatusBadge';
import { DASHBOARD_NAV, filterNav } from '@/components/shell/nav';

const FLOW: { status: string; tone: string }[] = [
  { status: 'PENDING', tone: 'bg-accent' },
  { status: 'CONFIRMED', tone: 'bg-info' },
  { status: 'PREPARING', tone: 'bg-primary' },
  { status: 'READY', tone: 'bg-success' },
  { status: 'COMPLETED', tone: 'bg-subtle' },
  { status: 'CANCELLED', tone: 'bg-danger' },
];

const SHORTCUTS = [
  { key: 'pdv', href: '/dashboard/pdv', label: 'Nova venda', hint: 'PDV de balcão', icon: Store },
  { key: 'mesas', href: '/dashboard/mesas', label: 'Mesas e Comandas', hint: 'Salão', icon: LayoutGrid },
  { key: 'cozinha', href: '/dashboard/cozinha', label: 'Cozinha', hint: 'Tela de produção', icon: ChefHat },
  { key: 'caixa', href: '/dashboard/caixa', label: 'Caixa', hint: 'Abertura e fechamento', icon: Wallet },
  { key: 'cardapio', href: '/dashboard/cardapio', label: 'Cardápio', hint: 'Categorias e produtos', icon: BookOpen },
  { key: 'pedidos', href: '/dashboard/pedidos', label: 'Pedidos', hint: 'Todos os pedidos', icon: ClipboardList },
];

export default function DashboardPage() {
  const { user } = useAuth();
  const { stats, isLoading, isError, refetch } = useDashboardStats();

  // Same role visibility the sidebar uses, so a shortcut never leads to a
  // screen the sidebar hides for this user.
  const visibleKeys = new Set(
    filterNav(DASHBOARD_NAV, user?.roles ?? null)
      .flatMap((g) => g.items)
      .map((i) => i.key),
  );
  const shortcuts = SHORTCUTS.filter((s) => visibleKeys.has(s.key));
  const canOpenPdv = visibleKeys.has('pdv');

  const firstName = user?.name.split(' ')[0] ?? '';
  const today = new Date().toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <Page wide>
      <PageHeader
        title={`Olá, ${firstName}`}
        description={
          <>
            {user?.tenant?.name ?? 'Seu restaurante'} · <span className="first-letter:uppercase">{today}</span>
          </>
        }
        actions={
          canOpenPdv ? (
            <Link href="/dashboard/pdv">
              <Button icon={<Store className="h-4 w-4" />}>Nova venda</Button>
            </Link>
          ) : undefined
        }
      />

      {isError && <ErrorState message="Não foi possível carregar os indicadores agora." onRetry={() => refetch()} />}

      <section aria-label="Resumo da operação" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          label="Vendas hoje"
          value={stats ? formatBRL(stats.salesToday) : '—'}
          hint={stats?.partial ? 'Parcial: mais de 100 pedidos hoje' : 'Exclui pedidos cancelados'}
          icon={<DollarSign />}
          tone="success"
          loading={isLoading}
        />
        <StatCard
          label="Pedidos"
          value={stats ? stats.ordersToday : '—'}
          hint="Hoje"
          icon={<Receipt />}
          tone="info"
          loading={isLoading}
        />
        <StatCard
          label="Ticket médio"
          value={stats ? formatBRL(stats.avgTicket) : '—'}
          hint="Vendas ÷ pedidos"
          icon={<TrendingUp />}
          loading={isLoading}
        />
        <StatCard
          label="Em preparo"
          value={stats ? stats.inPreparation : '—'}
          hint="Agora na cozinha"
          icon={<Flame />}
          tone="warning"
          loading={isLoading}
        />
      </section>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Pedidos recentes"
            description="Os últimos pedidos recebidos"
            action={
              <Link href="/dashboard/pedidos">
                <Button variant="ghost" size="sm">
                  Ver todos
                </Button>
              </Link>
            }
          />
          {isLoading ? (
            <LoadingState label="Carregando pedidos..." />
          ) : !stats || stats.recent.length === 0 ? (
            <div className="p-4">
              <EmptyState
                icon={<ClipboardList />}
                title="Nenhum pedido ainda"
                description="Os pedidos do cardápio online, do PDV e das mesas aparecem aqui assim que chegarem."
              />
            </div>
          ) : (
            <OrdersTable orders={stats.recent} compact />
          )}
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Fluxo de hoje" description="Pedidos por etapa" />
            <div className="space-y-3 p-4">
              {isLoading ? (
                <LoadingState className="py-4" />
              ) : !stats || stats.ordersToday === 0 && !stats.byStatus.CANCELLED ? (
                <p className="text-sm text-muted-foreground">Sem pedidos hoje ainda.</p>
              ) : (
                FLOW.map(({ status, tone }) => {
                  const count = stats.byStatus[status as keyof typeof stats.byStatus] ?? 0;
                  const total = Object.values(stats.byStatus).reduce((a, b) => a + (b ?? 0), 0) || 1;
                  return (
                    <div key={status}>
                      <div className="mb-1 flex items-center justify-between text-xs">
                        <span className="text-muted-foreground">{STATUS_LABEL[status]}</span>
                        <span className="font-semibold text-foreground">{count}</span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-surface-hover">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${tone}`}
                          style={{ width: `${(count / total) * 100}%` }}
                        />
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          </Card>

          <Card>
            <CardHeader title="Atividade operacional" />
            {isLoading ? (
              <LoadingState className="py-6" />
            ) : !stats || stats.recent.length === 0 ? (
              <p className="p-4 text-sm text-muted-foreground">Nenhuma atividade registrada.</p>
            ) : (
              <ul className="divide-y divide-line">
                {stats.recent.slice(0, 5).map((order) => (
                  <li key={order.id} className="flex items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <span className="min-w-0 truncate text-foreground">
                      Pedido <span className="font-semibold">#{order.orderNumber}</span> recebido
                    </span>
                    <span className="shrink-0 text-xs text-subtle">{timeAgo(order.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      {shortcuts.length > 0 && (
        <section aria-label="Atalhos">
          <h2 className="mb-2 text-sm font-semibold text-foreground">Atalhos</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
            {shortcuts.map((s) => {
              const Icon = s.icon;
              return (
                <Link key={s.key} href={s.href} className="group">
                  <Card className="flex h-full flex-col gap-2 p-3.5 transition-colors group-hover:border-line-strong group-hover:bg-surface-hover">
                    <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent/10 text-accent">
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <span className="text-sm font-medium text-foreground">{s.label}</span>
                    <span className="text-2xs text-subtle">{s.hint}</span>
                  </Card>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {stats && stats.partial && (
        <p className="text-center text-2xs text-subtle">
          <Badge tone="warning">Parcial</Badge> Indicadores calculados sobre os 100 pedidos mais recentes.
        </p>
      )}
    </Page>
  );
}
