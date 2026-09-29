import Link from 'next/link';
import { BookOpen, ChefHat, ClipboardList, DollarSign, Flame, Receipt, Store, TrendingUp, Wallet } from 'lucide-react';
import { demoOrders, demoStats } from '@/lib/demo/data';
import { formatDemoBRL } from '@/lib/demo/format';
import { Button } from '@/components/ds/Button';
import { Card, CardHeader } from '@/components/ds/Card';
import { Page, PageHeader } from '@/components/ds/PageHeader';
import { StatCard } from '@/components/ds/StatCard';
import { DemoOrderCard } from '@/components/demo/DemoOrderCard';

const SHORTCUTS = [
  { href: '/demo/pdv', label: 'Nova venda', hint: 'PDV de balcão', icon: Store },
  { href: '/demo/pedidos', label: 'Pedidos', hint: 'Painel por status', icon: ClipboardList },
  { href: '/demo/cozinha', label: 'Cozinha', hint: 'Tela de produção', icon: ChefHat },
  { href: '/demo/caixa', label: 'Caixa', hint: 'Sessão do dia', icon: Wallet },
  { href: '/demo/cardapio', label: 'Cardápio', hint: 'Categorias e produtos', icon: BookOpen },
];

export default function DemoDashboardPage() {
  const recent = [...demoOrders].sort((a, b) => a.elapsedMinutes - b.elapsedMinutes).slice(0, 4);

  return (
    <Page wide>
      <PageHeader
        title="Visão geral"
        description="Plataforma completa para gestão de restaurantes — cardápio, pedidos, cozinha, PDV e caixa num só sistema."
        actions={
          <Link href="/demo/pdv">
            <Button icon={<Store className="h-4 w-4" />}>Nova venda</Button>
          </Link>
        }
      />

      <section aria-label="Resumo da operação" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard label="Vendas hoje" value={formatDemoBRL(demoStats.salesTodayCents)} icon={<DollarSign />} tone="success" hint="Dados fictícios" />
        <StatCard label="Pedidos" value={String(demoStats.ordersToday)} icon={<Receipt />} tone="info" hint="Hoje" />
        <StatCard label="Ticket médio" value={formatDemoBRL(demoStats.avgTicketCents)} icon={<TrendingUp />} hint="Vendas ÷ pedidos" />
        <StatCard label="Em preparo" value={String(demoStats.inPreparation)} icon={<Flame />} tone="warning" hint="Agora na cozinha" />
      </section>

      <Card>
        <CardHeader
          title="Pedidos recentes"
          description="Os últimos pedidos recebidos"
          action={
            <Link href="/demo/pedidos">
              <Button variant="ghost" size="sm">
                Ver todos
              </Button>
            </Link>
          }
        />
        <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-4">
          {recent.map((order) => (
            <DemoOrderCard key={order.orderNumber} order={order} />
          ))}
        </div>
      </Card>

      <section aria-label="Atalhos">
        <h2 className="mb-2 text-sm font-semibold text-foreground">Atalhos</h2>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {SHORTCUTS.map((s) => {
            const Icon = s.icon;
            return (
              <Link key={s.href} href={s.href} className="group">
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
    </Page>
  );
}
