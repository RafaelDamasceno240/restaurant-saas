import { PricedOrderItem } from '../order-creation/order-creation.service';
import { activeUnits } from './tab-calculations';

export interface TabItemSnapshot {
  id: string;
  productId: string;
  productNameSnapshot: string;
  unitPriceCentsSnapshot: number;
  quantity: number;
  cancelledQuantity: number;
  notes?: string | null;
  // The add-ons frozen when the round was sent (already inside unitPriceCentsSnapshot).
  options?: {
    optionItemId: string | null;
    groupNameSnapshot: string;
    optionNameSnapshot: string;
    unitPriceCents: number;
    quantity: number;
  }[];
}

// The sale is priced EXCLUSIVELY from the TabItem snapshots (the price at the
// moment each item was added), never from the current Product row — a price
// change between "added to the tab" and "checkout" must not change the bill.
// One OrderItem per TabItem (two lines of the same product with different
// notes stay two lines). B9: each line bills only the units still due
// (quantity - cancelledQuantity), a line with every unit cancelled is not
// billed at all, and each line names the tab item it bills (UNIQUE: a tab item
// is charged once). Each line also carries the item's add-ons and note, copied from the tab's own
// snapshots (never re-read from the menu), so the sale's history shows what was served.
export function buildPricedItemsFromTab(items: TabItemSnapshot[]): PricedOrderItem[] {
  return items
    .filter((item) => activeUnits(item) > 0)
    .map((item) => ({
      productId: item.productId,
      productNameSnapshot: item.productNameSnapshot,
      unitPriceCents: item.unitPriceCentsSnapshot,
      quantity: activeUnits(item),
      tabItemId: item.id,
      notes: item.notes ?? null,
      options: (item.options ?? []).map((option) => ({
        optionItemId: option.optionItemId,
        groupNameSnapshot: option.groupNameSnapshot,
        optionNameSnapshot: option.optionNameSnapshot,
        unitPriceCents: option.unitPriceCents,
        quantity: option.quantity,
      })),
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
