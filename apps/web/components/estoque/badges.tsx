import { Badge, BadgeTone } from '@/components/ds/Badge';
import {
  ALERT_LABEL,
  InventoryAlertType,
  MOVEMENT_TYPE_LABEL,
  ORIGIN_LABEL,
  RecipeStatus,
  STOCK_STATUS_LABEL,
  StockMovementOrigin,
  StockMovementType,
} from '@/lib/inventory-api';

const STATUS_TONE: Record<RecipeStatus, BadgeTone> = {
  OK: 'success',
  LOW_STOCK: 'warning',
  OUT_OF_STOCK: 'danger',
  NO_RECIPE: 'neutral',
};

const TYPE_TONE: Record<StockMovementType, BadgeTone> = {
  ENTRY: 'success',
  EXIT: 'danger',
  ADJUSTMENT: 'info',
  SALE: 'primary',
  REVERSAL: 'brand',
};

const ALERT_TONE: Record<InventoryAlertType, BadgeTone> = {
  OUT_OF_STOCK: 'danger',
  EXPIRED: 'danger',
  LOW_STOCK: 'warning',
  EXPIRING_SOON: 'brand',
  NO_RECIPE: 'neutral',
};

export function StockStatusBadge({ status }: { status: RecipeStatus | null }) {
  if (!status) return null;
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {STOCK_STATUS_LABEL[status]}
    </Badge>
  );
}

export function MovementTypeBadge({ type }: { type: StockMovementType }) {
  return <Badge tone={TYPE_TONE[type]}>{MOVEMENT_TYPE_LABEL[type]}</Badge>;
}

export function OriginLabel({ origin }: { origin: StockMovementOrigin }) {
  return <span className="text-xs text-muted-foreground">{ORIGIN_LABEL[origin]}</span>;
}

export function AlertBadge({ type }: { type: InventoryAlertType }) {
  return (
    <Badge tone={ALERT_TONE[type]} dot>
      {ALERT_LABEL[type]}
    </Badge>
  );
}
