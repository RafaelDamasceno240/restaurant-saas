import { PricedOrderItem } from '../order-creation/order-creation.service';
import { activeUnits } from './tab-calculations';

export interface TabItemSnapshot {
  id: string;
  productId: string;
  productNameSnapshot: string;
  unitPriceCentsSnapshot: number;
  quantity: number;
  cancelledQuantity: number;
}

// The sale is priced EXCLUSIVELY from the TabItem snapshots (the price at the
// moment each item was added), never from the current Product row — a price
// change between "added to the tab" and "checkout" must not change the bill.
// One OrderItem per TabItem (two lines of the same product with different
// notes stay two lines). B9: each line bills only the units still due
// (quantity - cancelledQuantity), a line with every unit cancelled is not
// billed at all, and each line names the tab item it bills (UNIQUE: a tab item
// is charged once).
export function buildPricedItemsFromTab(items: TabItemSnapshot[]): PricedOrderItem[] {
  return items
    .filter((item) => activeUnits(item) > 0)
    .map((item) => ({
      productId: item.productId,
      productNameSnapshot: item.productNameSnapshot,
      unitPriceCents: item.unitPriceCentsSnapshot,
      quantity: activeUnits(item),
      tabItemId: item.id,
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
