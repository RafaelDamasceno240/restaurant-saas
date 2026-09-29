import { Badge, BadgeTone } from '@/components/ds/Badge';
import { DemoOrderStatus } from '@/lib/demo/types';

// Same tone convention as the real components/pedidos/StatusBadge.tsx
// (brand(dourado)=novo, info=confirmado, primary(caramelo)=preparando, success=pronto,
// neutral=finalizado) — duplicated on purpose so /demo never imports from
// the real-API modules.
const LABEL: Record<DemoOrderStatus, string> = {
  PENDING: 'Novo',
  CONFIRMED: 'Confirmado',
  PREPARING: 'Preparando',
  READY: 'Pronto',
  COMPLETED: 'Finalizado',
};

const TONE: Record<DemoOrderStatus, BadgeTone> = {
  PENDING: 'brand',
  CONFIRMED: 'info',
  PREPARING: 'primary',
  READY: 'success',
  COMPLETED: 'neutral',
};

export function DemoStatusBadge({ status }: { status: DemoOrderStatus }) {
  return (
    <Badge tone={TONE[status]} dot>
      {LABEL[status]}
    </Badge>
  );
}
