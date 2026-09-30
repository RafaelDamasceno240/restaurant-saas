import { deliveryMinOrderNotMet, deliveryUnavailable, orderTotalTooLarge } from './delivery-errors';

// Money columns are 32-bit INTEGER cents.
export const MAX_AMOUNT_CENTS = 2_147_483_647;

export interface DeliverySettings {
  enabled: boolean;
  feeCents: number;
  minOrderCents: number;
}

export interface DeliveryPricing {
  deliveryFeeCents: number;
  totalCents: number;
}

// Single source of truth for what a delivery costs. Runs on the server only,
// from the branch settings and the subtotal the server itself computed — the
// client never sends (and cannot influence) the fee. The minimum order is
// compared against the items subtotal, not against subtotal + fee.
export function priceDelivery(subtotalCents: number, settings: DeliverySettings): DeliveryPricing {
  if (!settings.enabled) throw deliveryUnavailable();
  if (subtotalCents < settings.minOrderCents) throw deliveryMinOrderNotMet(settings.minOrderCents);
  const totalCents = subtotalCents + settings.feeCents;
  if (totalCents > MAX_AMOUNT_CENTS) throw orderTotalTooLarge();
  return { deliveryFeeCents: settings.feeCents, totalCents };
}
