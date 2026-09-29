import clsx from 'clsx';
import { CheckCircle2, Clock, Flame, Sparkles, StickyNote } from 'lucide-react';
import { DemoOrder } from '@/lib/demo/types';

const URGENT_AFTER_MINUTES = 15;

// Same emphasis rules as the real KDS card (new = gold, preparing = caramel,
// ready = green), each with a text label + icon so status isn't color-only.
const LOOK: Record<string, { label: string; icon: typeof Flame; card: string; tag: string }> = {
  PENDING: { label: 'Novo', icon: Sparkles, card: 'border-accent bg-accent/5', tag: 'bg-accent text-accent-foreground' },
  CONFIRMED: { label: 'Confirmado', icon: CheckCircle2, card: 'border-line-strong', tag: 'bg-surface-hover text-foreground' },
  PREPARING: { label: 'Em preparo', icon: Flame, card: 'border-primary/70', tag: 'bg-primary/25 text-brand-muted' },
  READY: { label: 'Pronto', icon: CheckCircle2, card: 'border-success/50 bg-success/5', tag: 'bg-success/15 text-success' },
};

// Visually mirrors the real components/kds/KdsOrderCard.tsx (big numbers,
// bold item list, red border once an order has waited too long), but with no
// `onAdvance`/mutation — this board never changes state from a click, it's
// a static snapshot for the demo.
export function DemoKdsCard({ order }: { order: DemoOrder }) {
  const isUrgent = order.status !== 'READY' && order.elapsedMinutes >= URGENT_AFTER_MINUTES;
  const look = LOOK[order.status];

  return (
    <div
      className={clsx(
        'flex flex-col gap-3 rounded-card border bg-surface p-4',
        isUrgent ? 'border-danger/70 bg-danger/5' : (look?.card ?? 'border-line'),
        // One-shot "just arrived" ring — plain CSS keyframe, not a
        // WebSocket-driven update.
        order.elapsedMinutes <= 2 && 'animate-pulse-ring',
      )}
    >
      {look && (
        <span className={clsx('inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide', look.tag)}>
          <look.icon className="h-3.5 w-3.5" aria-hidden />
          {look.label}
        </span>
      )}
      <div className="flex items-start justify-between">
        <p className="text-3xl font-bold leading-none tracking-tight text-foreground">#{order.orderNumber}</p>
        <span
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-base font-bold',
            isUrgent ? 'bg-danger/15 text-danger' : 'bg-surface-hover text-foreground',
          )}
        >
          <Clock className="h-4 w-4" aria-hidden />
          {order.elapsedMinutes} min
        </span>
      </div>

      <ul className="space-y-1.5 border-t border-line pt-3">
        {order.items.map((item) => (
          <li key={item.productId} className="text-lg leading-snug text-foreground">
            <span className="mr-1 font-bold text-accent">{item.quantity}×</span>
            {item.name}
          </li>
        ))}
      </ul>

      {order.notes && (
        <p className="flex items-start gap-2 rounded-ctl border border-warning/30 bg-warning/10 px-3 py-2 text-sm text-warning">
          <StickyNote className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {order.notes}
        </p>
      )}
    </div>
  );
}
