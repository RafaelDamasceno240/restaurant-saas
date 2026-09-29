// Pure, no Prisma/Nest — same reasoning as order-status.util.ts: the money
// math a Tab needs is trivial enough that it doesn't need its own service,
// but it's still worth isolating from the DB round trip so it's directly
// testable. No delivery fee/discount/tax yet — totalCents mirrors
// subtotalCents, same as Order.
export interface TabItemForTotals {
  unitPriceCentsSnapshot: number;
  quantity: number;
}

export interface TabTotals {
  subtotalCents: number;
  totalCents: number;
  itemCount: number;
}

export function computeTabTotals(items: TabItemForTotals[]): TabTotals {
  const subtotalCents = items.reduce((sum, item) => sum + item.unitPriceCentsSnapshot * item.quantity, 0);
  return {
    subtotalCents,
    totalCents: subtotalCents,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
  };
}
