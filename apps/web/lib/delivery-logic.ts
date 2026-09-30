import type { BadgeTone } from '@/components/ds/Badge';
import type { DeliveryAddress, DeliveryStatus } from './delivery-api';

export const DELIVERY_STATUS_LABEL: Record<DeliveryStatus, string> = {
  PENDING: 'Pendente',
  OUT_FOR_DELIVERY: 'Em rota',
  DELIVERED: 'Entregue',
  CANCELLED: 'Cancelada',
};

export const DELIVERY_STATUS_TONE: Record<DeliveryStatus, BadgeTone> = {
  PENDING: 'warning',
  OUT_FOR_DELIVERY: 'info',
  DELIVERED: 'success',
  CANCELLED: 'danger',
};

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
