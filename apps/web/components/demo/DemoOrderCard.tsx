import { StickyNote } from 'lucide-react';
import { DemoOrder } from '@/lib/demo/types';
import { formatDemoBRL } from '@/lib/demo/format';
import { Card } from '@/components/ds/Card';
import { DemoStatusBadge } from './DemoStatusBadge';

export function DemoOrderCard({ order }: { order: DemoOrder }) {
  return (
    <Card className="p-3.5 transition-colors hover:bg-surface-hover">
      <div className="flex items-start justify-between gap-2">
        <p className="text-base font-bold text-foreground">#{order.orderNumber}</p>
        <DemoStatusBadge status={order.status} />
      </div>

      <ul className="mt-2 space-y-0.5">
        {order.items.map((item) => (
          <li key={item.productId} className="text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">{item.quantity}×</span> {item.name}
          </li>
        ))}
      </ul>

      {order.notes && (
        <p className="mt-2 flex items-center gap-1.5 rounded-ctl bg-warning/10 px-2 py-1 text-xs text-warning">
          <StickyNote className="h-3.5 w-3.5 shrink-0" aria-hidden />
          {order.notes}
        </p>
      )}

      <div className="mt-3 flex items-center justify-between border-t border-line pt-2">
        <span className="text-xs text-subtle">{order.elapsedMinutes} min atrás</span>
        <span className="text-sm font-semibold text-foreground">{formatDemoBRL(order.totalCents)}</span>
      </div>
    </Card>
  );
}
