'use client';

import clsx from 'clsx';
import { CheckCircle2, Clock, Flame, Sparkles, StickyNote, UtensilsCrossed } from 'lucide-react';
import { KitchenRoundStatus, KitchenTableRound } from '@/lib/orders-api';
import { ROUND_ACTION, roundTitle } from '@/lib/kds-logic';
import { useElapsedMinutes } from '@/lib/use-elapsed-minutes';
import { Button } from '@/components/ds/Button';

// B9: a round sent from a table. Same look as an order card (KdsOrderCard), with what the kitchen
// needs from a table: which table, which round, and each item's own note ("sem cebola").
const URGENT_AFTER_MINUTES = 15;

const STATUS_LOOK: Record<KitchenRoundStatus, { label: string; icon: typeof Flame; card: string; tag: string }> = {
  SENT: { label: 'Novo', icon: Sparkles, card: 'border-accent bg-accent/5 animate-pulse-ring', tag: 'bg-accent text-accent-foreground' },
  PREPARING: { label: 'Em preparo', icon: Flame, card: 'border-primary/70', tag: 'bg-primary/25 text-brand-muted' },
  READY: { label: 'Pronto', icon: CheckCircle2, card: 'border-success/50 bg-success/5', tag: 'bg-success/15 text-success' },
};

const ITEM_STATUS_LABEL: Record<KitchenRoundStatus, string> = {
  SENT: 'novo',
  PREPARING: 'em preparo',
  READY: 'pronto',
};

export function KdsTableRoundCard({
  round,
  onAdvance,
  isAdvancing,
}: {
  round: KitchenTableRound;
  onAdvance: () => void;
  isAdvancing: boolean;
}) {
  const minutes = useElapsedMinutes(round.sentAt);
  const look = STATUS_LOOK[round.status];
  const action = ROUND_ACTION[round.status];
  const isUrgent = round.status !== 'READY' && minutes >= URGENT_AFTER_MINUTES;

  return (
    <div
      className={clsx(
        'flex flex-col gap-3 rounded-card border bg-surface p-4 transition-colors',
        isUrgent ? 'border-danger/70 bg-danger/5' : look.card,
      )}
    >
      <span className={clsx('inline-flex w-fit items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wide', look.tag)}>
        <look.icon className="h-3.5 w-3.5" aria-hidden />
        {look.label}
      </span>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          {/* Each part never breaks inside itself; the round number wraps whole when narrow. */}
          <p className="text-2xl font-bold leading-tight tracking-tight text-foreground" title={roundTitle(round)}>
            <span className="whitespace-nowrap">Mesa {round.tableNumber}</span>{' '}
            <span className="whitespace-nowrap text-xl text-muted-foreground">· rodada {round.roundNumber}</span>
          </p>
          <p className="mt-1.5 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            <UtensilsCrossed className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
            {round.tableName ? `Mesa · ${round.tableName}` : 'Mesa'}
          </p>
        </div>
        <span
          className={clsx(
            'inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-base font-bold',
            isUrgent ? 'bg-danger/15 text-danger' : 'bg-surface-hover text-foreground',
          )}
        >
          <Clock className="h-4 w-4" aria-hidden />
          {minutes} min
        </span>
      </div>

      <ul className="space-y-2 border-t border-line pt-3">
        {round.items.map((item) => (
          <li key={item.id} className="text-lg leading-snug text-foreground">
            <span className="mr-1 font-bold text-accent">{item.quantity}×</span>
            {item.name}
            {item.status !== round.status && (
              <span className="ml-2 rounded-full bg-surface-hover px-2 py-0.5 align-middle text-xs font-semibold uppercase text-muted-foreground">
                {ITEM_STATUS_LABEL[item.status]}
              </span>
            )}
            {/* The add-ons of each unit, as on an order card. */}
            {(item.options ?? []).map((option, i) => (
              <span key={`${option.name}-${i}`} className="block pl-7 text-base text-muted-foreground">
                + {option.quantity > 1 ? `${option.quantity}× ` : ''}
                {option.name}
              </span>
            ))}
            {item.notes && (
              <span className="mt-1 flex items-start gap-1.5 rounded-ctl border border-warning/30 bg-warning/10 px-2.5 py-1.5 text-sm text-warning">
                <StickyNote className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                {item.notes}
              </span>
            )}
          </li>
        ))}
      </ul>

      <Button size="lg" className="mt-1 h-14 text-base uppercase tracking-wide" fullWidth loading={isAdvancing} onClick={onAdvance}>
        {isAdvancing ? 'Enviando...' : action.label}
      </Button>
    </div>
  );
}
