import { demoOrders } from '@/lib/demo/data';
import { DemoOrderStatus } from '@/lib/demo/types';
import { DemoKdsCard } from '@/components/demo/DemoKdsCard';

// The kitchen doesn't need a "Confirmados" column separate from "Novos" —
// once accepted, it's queued the same way until prep starts. Mirrors the
// same simplification the real KDS makes.
const COLUMNS: { statuses: DemoOrderStatus[]; label: string; tone: string }[] = [
  { statuses: ['PENDING', 'CONFIRMED'], label: 'Novos', tone: 'bg-accent' },
  { statuses: ['PREPARING'], label: 'Preparando', tone: 'bg-primary' },
  { statuses: ['READY'], label: 'Prontos', tone: 'bg-success' },
];

export default function DemoCozinhaPage() {
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b border-line px-4 py-2.5">
        <h1 className="text-base font-semibold text-foreground">Cozinha</h1>
        <p className="text-xs text-muted-foreground">Tela de produção — cards grandes, pensados para tela na cozinha.</p>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto p-3 sm:grid-cols-3 sm:overflow-hidden">
        {COLUMNS.map((column) => {
          const orders = demoOrders
            .filter((o) => column.statuses.includes(o.status))
            .sort((a, b) => b.elapsedMinutes - a.elapsedMinutes);
          return (
            <section
              key={column.label}
              aria-label={column.label}
              className="flex min-h-[16rem] flex-col overflow-hidden rounded-card border border-line bg-background sm:min-h-0"
            >
              <h2 className="flex items-center justify-between border-b border-line bg-surface px-3 py-2.5 text-sm font-bold uppercase tracking-wide text-foreground">
                <span className="flex items-center gap-2">
                  <span className={`h-2.5 w-2.5 rounded-full ${column.tone}`} aria-hidden />
                  {column.label}
                </span>
                <span className="rounded-full bg-surface-hover px-2.5 py-0.5 text-xs">{orders.length}</span>
              </h2>
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-2.5">
                {orders.map((order) => (
                  <DemoKdsCard key={order.orderNumber} order={order} />
                ))}
                {orders.length === 0 && <p className="px-2 py-6 text-center text-sm text-subtle">Nenhum pedido.</p>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
