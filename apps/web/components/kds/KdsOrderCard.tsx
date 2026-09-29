'use client';

import clsx from 'clsx';
import { CheckCircle2, Clock, Flame, Sparkles, StickyNote } from 'lucide-react';
import { AdminOrderListItem, FULFILLMENT_LABEL, OrderStatus } from '@/lib/orders-api';
import { useElapsedMinutes } from '@/lib/use-elapsed-minutes';
import { Button } from '@/components/ds/Button';

// Card shown to the kitchen — deliberately narrower than the admin detail
// card: no customer phone, no address. The kitchen needs to know WHAT to
// make and HOW LONG it's been waiting, not who to call.
const ACTION_BY_STATUS: Record<string, { label: string; nextStatus: OrderStatus } | undefined> = {
  PENDING: { label: 'Aceitar', nextStatus: 'CONFIRMED' },
  CONFIRMED: { label: 'Iniciar preparo', nextStatus: 'PREPARING' },
  PREPARING: { label: 'Marcar como pronto', nextStatus: 'READY' },
  READY: { label: 'Finalizar', nextStatus: 'COMPLETED' },
};

// Minutes waited before a card gets the "this is taking a while" treatment.
// READY orders don't get the urgent treatment for waiting — once food is
// ready, "how long has it sat" is a different concern than prep time.
const URGENT_AFTER_MINUTES = 15;

// Status emphasis: new = highest (gold frame + pulse), preparing = medium
// (caramel frame), ready = positive (green frame). Each also carries a TEXT
// label + icon, so status never depends on color alone.
const STATUS_LOOK: Record<string, { label: string; icon: typeof Flame; card: string; tag: string } | undefined> = {
  PENDING: {
    label: 'Novo',
    icon: Sparkles,
    card: 'border-accent bg-accent/5 animate-pulse-ring',
    tag: 'bg-accent text-accent-foreground',
  },
  CONFIRMED: {
    label: 'Confirmado',
    icon: CheckCircle2,
    card: 'border-line-strong',
    tag: 'bg-surface-hover text-foreground',
  },
  PREPARING: {
    label: 'Em preparo',
    icon: Flame,
    card: 'border-primary/70',
    tag: 'bg-primary/25 text-brand-muted',
  },
  READY: {
    label: 'Pronto',
    icon: CheckCircle2,
    card: 'border-success/50 bg-success/5',
    tag: 'bg-success/15 text-success',
  },
};

export function KdsOrderCard({
  order,
  onAdvance,
  isAdvancing,
}: {
  order: AdminOrderListItem;
  onAdvance: (nextStatus: OrderStatus) => void;
  isAdvancing: boolean;
}) {
  const minutes = useElapsedMinutes(order.createdAt);
  const action = ACTION_BY_STATUS[order.status];
  const isUrgent = order.status !== 'READY' && minutes >= URGENT_AFTER_MINUTES;
  const look = STATUS_LOOK[order.status];

  return (
    <div
      className={clsx(
        'flex flex-col gap-3 rounded-card border bg-surface p-4 transition-colors',
        isUrgent ? 'border-danger/70 bg-danger/5' : (look?.card ?? 'border-line'),
      )}
    >
      {look && (
        <span
          className={clsx(
            'inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide',
            look.tag,
          )}
        >
          <look.icon className="h-3.5 w-3.5" aria-hidden />
          {look.label}
        </span>
      )}
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-3xl font-bold leading-none tracking-tight text-foreground">#{order.orderNumber}</p>
          <p className="mt-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {FULFILLMENT_LABEL[order.fulfillmentType] ?? order.fulfillmentType}
          </p>
        </div>
        <span
          className={clsx(
            'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-base font-bold',
            isUrgent ? 'bg-danger/15 text-danger' : 'bg-surface-hover text-foreground',
          )}
        >
          <Clock className="h-4 w-4" aria-hidden />
          {minutes} min
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

      {action && (
        <Button
          size="lg"
          className="mt-1 h-14 text-base uppercase tracking-wide"
          fullWidth
          loading={isAdvancing}
          onClick={() => onAdvance(action.nextStatus)}
        >
          {isAdvancing ? 'Enviando...' : action.label}
        </Button>
      )}
    </div>
  );
}
