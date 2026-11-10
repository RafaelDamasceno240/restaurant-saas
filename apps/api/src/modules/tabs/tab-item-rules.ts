import { TabItemStatus, TabItemStockOutcome } from '@prisma/client';

// Pure, no Prisma/Nest: the B9 rules for one item of a tab, kept apart so they can be tested
// directly. TabRoundsService applies them under the tab and item locks.

// The kitchen moves an item forward one step at a time; the waiter may deliver it (SERVED) from
// any state still in production (a drink taken straight from the fridge never goes through the
// kitchen). Nothing leaves SERVED or CANCELLED.
const PRODUCTION_FLOW: Record<TabItemStatus, TabItemStatus[]> = {
  SENT: ['PREPARING', 'READY', 'SERVED'],
  PREPARING: ['READY', 'SERVED'],
  READY: ['SERVED'],
  SERVED: [],
  CANCELLED: [],
};

export function isValidTabItemTransition(from: TabItemStatus, to: TabItemStatus): boolean {
  return PRODUCTION_FLOW[from].includes(to);
}

// Still in the kitchen's hands: what the kitchen board shows.
export const TAB_ITEM_IN_PRODUCTION: readonly TabItemStatus[] = ['SENT', 'PREPARING', 'READY'];

export type CancelDecision =
  | { ok: true; needsManager: boolean; stockOutcome: TabItemStockOutcome }
  | { ok: false; code: 'TAB_ITEM_ALREADY_CANCELLED' | 'SERVED_ITEM_CANNOT_RETURN' };

// Who may cancel units of an item and where their ingredients go:
//  - SENT (the kitchen has not started): any waiter with tabs.update; the ingredients go back;
//  - PREPARING / READY: only who may cancel orders (orders.cancel); lost by default, back to the
//    stock if the manager says so (an unopened can, a dish not started after all);
//  - SERVED (delivered to the table; also every item launched before rounds existed): only
//    orders.cancel; it is taken off the bill and never goes back;
//  - nothing consumed for the item (no recipe, or a legacy item whose recipe is only consumed at
//    checkout): the outcome is NONE whatever was asked.
export function decideCancellation(input: {
  status: TabItemStatus;
  consumedStock: boolean;
  returnToStock: boolean | undefined;
}): CancelDecision {
  const { status, consumedStock, returnToStock } = input;
  if (status === 'CANCELLED') return { ok: false, code: 'TAB_ITEM_ALREADY_CANCELLED' };
  if (status === 'SERVED' && returnToStock === true) return { ok: false, code: 'SERVED_ITEM_CANNOT_RETURN' };

  const needsManager = status !== 'SENT';
  if (!consumedStock) return { ok: true, needsManager, stockOutcome: 'NONE' };
  if (status === 'SENT') return { ok: true, needsManager, stockOutcome: 'RETURNED' };
  if (status === 'SERVED') return { ok: true, needsManager, stockOutcome: 'WASTED' };
  return { ok: true, needsManager, stockOutcome: returnToStock ? 'RETURNED' : 'WASTED' };
}
