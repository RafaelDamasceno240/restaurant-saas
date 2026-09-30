import type { BadgeTone } from '@/components/ds/Badge';
import type { DeliveryAddress, DeliveryItem, DeliveryStatus } from './delivery-api';

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  PENDING: 'Pendente',
  OUT_FOR_DELIVERY: 'Em rota',
  DELIVERED: 'Entregue',
  FAILED: 'Falhou',
  CANCELLED: 'Cancelada',
};

export const DELIVERY_STATUS_TONE: Record<DeliveryStatus, BadgeTone> = {
  PENDING: 'warning',
  OUT_FOR_DELIVERY: 'info',
  DELIVERED: 'success',
  FAILED: 'danger',
  CANCELLED: 'neutral',
};

// Tab order: what needs action first, history last.
export const DELIVERY_TABS: DeliveryStatus[] = ['PENDING', 'OUT_FOR_DELIVERY', 'FAILED', 'DELIVERED', 'CANCELLED'];

export const MAX_DELIVERY_TEXT = 300;
export const MIN_FAILURE_REASON = 3;

// "Rua das Flores, 120 · Ap 4 — Centro, São Paulo/SP"
export function addressSummary(address: DeliveryAddress): string {
  const street = [address.street, address.number].filter(Boolean).join(', ');
  const complement = address.complement ? ` · ${address.complement}` : '';
  const place = [address.neighborhood, [address.city, address.state].filter(Boolean).join('/')]
    .filter(Boolean)
    .join(', ');
  return `${street}${complement}${place ? ` — ${place}` : ''}`;
}

// Integer cents -> the "12,50" shape the money inputs use.
export function centsToInput(cents: number): string {
  const whole = Math.trunc(cents / 100);
  const fraction = String(cents % 100).padStart(2, '0');
  return `${whole},${fraction}`;
}

// A "YYYY-MM-DD" day picked by the operator -> the start and end of THAT LOCAL day as ISO
// instants, so "today" means today in the operator's timezone (the API filters by instant).
export function localDayRange(day: string): { from: string; to: string } {
  return {
    from: new Date(`${day}T00:00:00.000`).toISOString(),
    to: new Date(`${day}T23:59:59.999`).toISOString(),
  };
}

// Shown next to the status: which attempt this is, only when it is not the first.
export function attemptLabel(item: Pick<DeliveryItem, 'status' | 'attemptCount'>): string | null {
  if (item.status === 'PENDING' && item.attemptCount > 0) return `Reentrega · ${item.attemptCount + 1}ª tentativa`;
  if (item.attemptCount > 1) return `${item.attemptCount}ª tentativa`;
  return null;
}

export function isValidFailureReason(reason: string): boolean {
  const length = reason.trim().length;
  return length >= MIN_FAILURE_REASON && length <= MAX_DELIVERY_TEXT;
}
