import { Badge, BadgeTone } from '@/components/ds/Badge';
import type { OrderSource } from '@/lib/orders-api';

export const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Novo',
  CONFIRMED: 'Confirmado',
  PREPARING: 'Preparando',
  READY: 'Pronto',
  OUT_FOR_DELIVERY: 'Saiu para entrega',
  DELIVERED: 'Entregue',
  COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado',
};

const STATUS_TONE: Record<string, BadgeTone> = {
  PENDING: 'brand',
  CONFIRMED: 'info',
  PREPARING: 'primary',
  READY: 'success',
  OUT_FOR_DELIVERY: 'info',
  DELIVERED: 'neutral',
  COMPLETED: 'neutral',
  CANCELLED: 'danger',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge tone={STATUS_TONE[status] ?? 'neutral'} dot>
      {STATUS_LABEL[status] ?? status}
    </Badge>
  );
}

const SOURCE_TONE: Record<OrderSource, BadgeTone> = {
  COUNTER: 'primary',
  TABLE: 'brand',
  ONLINE: 'info',
};

export function SourceBadge({ source, label }: { source: OrderSource; label: string }) {
  return <Badge tone={SOURCE_TONE[source] ?? 'neutral'}>{label}</Badge>;
}
