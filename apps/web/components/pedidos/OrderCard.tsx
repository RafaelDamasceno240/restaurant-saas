import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { AdminOrderListItem, FULFILLMENT_LABEL, ORDER_SOURCE_LABEL } from '@/lib/orders-api';
import { formatBRL, formatTime } from '@/lib/format';
import { Card } from '@/components/ds/Card';
import { SourceBadge, StatusBadge } from './StatusBadge';

export const PAYMENT_LABEL: Record<string, string> = { CASH: 'Dinheiro', PIX: 'Pix', CARD: 'Cartão' };

export function customerLabel(order: Pick<AdminOrderListItem, 'customerName' | 'source'>): string {
  return order.customerName ?? (order.source === 'TABLE' ? 'Cliente mesa' : 'Cliente balcão');
}

// Compact card used on small screens, where the orders table would need
// horizontal scrolling.
export function OrderCard({ order }: { order: AdminOrderListItem }) {
  return (
    <Link href={`/dashboard/pedidos/${order.id}`} className="block">
      <Card className="p-3.5 transition-colors hover:bg-surface-hover">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 font-semibold text-foreground">
              #{order.orderNumber}
              <SourceBadge source={order.source} label={ORDER_SOURCE_LABEL[order.source] ?? order.source} />
            </p>
            <p className="truncate text-sm text-muted-foreground">{customerLabel(order)}</p>
          </div>
          <StatusBadge status={order.status} />
        </div>
        <div className="mt-3 flex items-center justify-between border-t border-line pt-2.5 text-xs text-muted-foreground">
          <span>
            {FULFILLMENT_LABEL[order.fulfillmentType] ?? order.fulfillmentType} ·{' '}
            {PAYMENT_LABEL[order.paymentMethod] ?? order.paymentMethod} · {order.itemCount} item(ns) ·{' '}
            {formatTime(order.createdAt)}
          </span>
          <span className="flex items-center gap-1 text-sm font-semibold text-foreground">
            {formatBRL(order.total)}
            <ChevronRight className="h-4 w-4 text-subtle" aria-hidden />
          </span>
        </div>
      </Card>
    </Link>
  );
}
