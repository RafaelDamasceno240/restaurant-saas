// Pure, no Prisma/Nest — same reasoning as order-status.util.ts: the money
// math a Tab needs is trivial enough that it doesn't need its own service,
// but it's still worth isolating from the DB round trip so it's directly
// testable. No delivery fee/discount/tax yet — totalCents mirrors
// subtotalCents, same as Order.
export interface TabItemForTotals {
  unitPriceCentsSnapshot: number;
  quantity: number;
  // B9: units cancelled so far. They are not charged.
  cancelledQuantity: number;
}

export interface TabTotals {
  subtotalCents: number;
  totalCents: number;
  itemCount: number;
}

// B9: the units of an item that are still due - what the bill charges, what the kitchen still
// makes and what the 50-units limit (B7) counts.
export function activeUnits(item: { quantity: number; cancelledQuantity: number }): number {
  return item.quantity - item.cancelledQuantity;
}

export function computeTabTotals(items: TabItemForTotals[]): TabTotals {
  const subtotalCents = items.reduce((sum, item) => sum + item.unitPriceCentsSnapshot * activeUnits(item), 0);
  return {
    subtotalCents,
    totalCents: subtotalCents,
    itemCount: items.reduce((sum, item) => sum + activeUnits(item), 0),
  };
}

export interface RoundLine {
  productId: string;
  quantity: number;
  notes: string | null;
}

// B9: what a round asked for, independent of the order of its lines. A repeated send with the same
// idempotency key is a retry only if it asks for exactly this; anything else is another round
// and the key cannot be reused for it.
export function roundSignature(lines: RoundLine[]): string {
  return lines
    .map((line) => JSON.stringify([line.productId, line.quantity, line.notes ?? null]))
    .sort()
    .join('|');
}

// B9 (B7 for tabs): the first product whose active units on the tab plus the units of the round
// go over `limit`, or null when everything fits.
export function productOverTabUnitLimit(
  existing: { productId: string; quantity: number; cancelledQuantity: number }[],
  round: { productId: string; quantity: number }[],
  limit: number,
): string | null {
  const units = new Map<string, number>();
  for (const item of existing) units.set(item.productId, (units.get(item.productId) ?? 0) + activeUnits(item));
  for (const line of round) {
    const total = (units.get(line.productId) ?? 0) + line.quantity;
    if (total > limit) return line.productId;
    units.set(line.productId, total);
  }
  return null;
}
