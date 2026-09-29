import { PricedOrderItem } from '../order-creation/order-creation.service';

export interface TabItemSnapshot {
  productId: string;
  productNameSnapshot: string;
  unitPriceCentsSnapshot: number;
  quantity: number;
}

// The sale is priced EXCLUSIVELY from the TabItem snapshots (the price at the
// moment each item was added), never from the current Product row — a price
// change between "added to the tab" and "checkout" must not change the bill.
// One OrderItem per TabItem (two lines of the same product with different
// notes stay two lines).
export function buildPricedItemsFromTab(items: TabItemSnapshot[]): PricedOrderItem[] {
  return items.map((item) => ({
    productId: item.productId,
    productNameSnapshot: item.productNameSnapshot,
    unitPriceCents: item.unitPriceCentsSnapshot,
    quantity: item.quantity,
  }));
}

export type ExistingCheckoutOutcome = 'REPLAY' | 'TAB_ALREADY_CHECKED_OUT' | 'IDEMPOTENCY_KEY_REUSED';

// Decides what an incoming checkout request means when a sale already exists
// (found either by the request's idempotency key or by the tab):
//  - same tab + same key  -> REPLAY: return the existing result, create nothing;
//  - same tab + other key -> the tab was already sold by a different request;
//  - other tab            -> the key was already used for a different sale.
export function classifyExistingCheckout(
  existing: { tabId: string | null; idempotencyKey: string | null },
  request: { tabId: string; idempotencyKey: string },
): ExistingCheckoutOutcome {
  if (existing.tabId !== request.tabId) return 'IDEMPOTENCY_KEY_REUSED';
  if (existing.idempotencyKey !== request.idempotencyKey) return 'TAB_ALREADY_CHECKED_OUT';
  return 'REPLAY';
}
