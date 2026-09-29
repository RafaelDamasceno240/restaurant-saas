import { demoOrders } from '@/lib/demo/data';
import { DemoOrderStatus } from '@/lib/demo/types';
import { DemoOrderCard } from '@/components/demo/DemoOrderCard';
import { Page, PageHeader } from '@/components/ds/PageHeader';

const COLUMNS: { status: DemoOrderStatus; label: string; tone: string }[] = [
  { status: 'PENDING', label: 'Novos', tone: 'bg-accent' },
  { status: 'CONFIRMED', label: 'Confirmados', tone: 'bg-info' },
  { status: 'PREPARING', label: 'Preparando', tone: 'bg-primary' },
  { status: 'READY', label: 'Prontos', tone: 'bg-success' },
  { status: 'COMPLETED', label: 'Finalizados', tone: 'bg-subtle' },
];

export default function DemoPedidosPage() {
  return (
    <Page wide>
      <PageHeader title="Pedidos" description="Painel administrativo — do recebimento até a finalização." />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-5">
        {COLUMNS.map((column) => {
          const orders = demoOrders
            .filter((o) => o.status === column.status)
            .sort((a, b) => a.elapsedMinutes - b.elapsedMinutes);
          return (
            <section key={column.status} aria-label={column.label} className="space-y-3">
              <div className="flex items-center justify-between px-1">
                <p className="flex items-center gap-2 text-sm font-semibold text-foreground">
                  <span className={`h-2 w-2 rounded-full ${column.tone}`} aria-hidden />
                  {column.label}
                </p>
                <span className="rounded-full bg-surface-hover px-2 py-0.5 text-2xs font-semibold text-muted-foreground">
                  {orders.length}
                </span>
              </div>
              <div className="space-y-2">
                {orders.map((order) => (
                  <DemoOrderCard key={order.orderNumber} order={order} />
                ))}
                {orders.length === 0 && (
                  <p className="rounded-card border border-dashed border-line-strong p-4 text-center text-xs text-subtle">
                    Nenhum pedido
                  </p>
                )}
              </div>
            </section>
          );
        })}
      </div>
    </Page>
  );
}
