import { deliveryMinOrderNotMet, deliveryUnavailable, orderTotalTooLarge } from './delivery-errors';

// Money columns are 32-bit INTEGER cents.
export const MAX_AMOUNT_CENTS = 2_147_483_647;

export interface DeliverySettings {
  enabled: boolean;
  feeCents: number;
  minOrderCents: number;
  // Free from this items subtotal on; null/absent = the fee always applies.
  freeAboveCents?: number | null;
}

export interface DeliveryPricing {
  deliveryFeeCents: number;
  totalCents: number;
}

// Single source of truth for what a delivery costs. Runs on the server only,
// from the branch settings and the subtotal the server itself computed — the
// client never sends (and cannot influence) the fee. The minimum order is
// compared against the items subtotal, not against subtotal + fee. So is the free-delivery
// threshold: from it on, the fee is not charged.
export function priceDelivery(subtotalCents: number, settings: DeliverySettings): DeliveryPricing {
  if (!settings.enabled) throw deliveryUnavailable();
  if (subtotalCents < settings.minOrderCents) throw deliveryMinOrderNotMet(settings.minOrderCents);
  const free = settings.freeAboveCents != null && subtotalCents >= settings.freeAboveCents;
  const deliveryFeeCents = free ? 0 : settings.feeCents;
  const totalCents = subtotalCents + deliveryFeeCents;
  if (totalCents > MAX_AMOUNT_CENTS) throw orderTotalTooLarge();
  return { deliveryFeeCents, totalCents };
}
