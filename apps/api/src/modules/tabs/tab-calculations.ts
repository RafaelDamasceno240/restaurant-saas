// Pure, no Prisma/Nest — same reasoning as order-status.util.ts: the money
// math a Tab needs is trivial enough that it doesn't need its own service,
// but it's still worth isolating from the DB round trip so it's directly
// testable. No delivery fee/discount/tax yet — totalCents mirrors
// subtotalCents, same as Order.
import { optionsSignature } from '../order-creation/option-pricing';

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

export interface RoundLineOption {
  optionItemId: string | null;
  quantity: number;
}

export interface RoundLine {
  productId: string;
  quantity: number;
  notes: string | null;
  // The add-ons of each unit, one entry per option (the same option sent twice is added up).
  options: RoundLineOption[];
}

// The add-ons as sent: the same option listed twice counts once, with the quantities added up
// (that is how they are stored, so a retry compares equal to what was saved).
export function mergeRoundOptions(options: { optionId: string; quantity: number }[] | undefined): RoundLineOption[] {
  const byId = new Map<string, number>();
  for (const option of options ?? []) byId.set(option.optionId, (byId.get(option.optionId) ?? 0) + option.quantity);
  return [...byId].map(([optionItemId, quantity]) => ({ optionItemId, quantity }));
}

// B9: what a round asked for, independent of the order of its lines (and of its add-ons). A
// repeated send with the same idempotency key is a retry only if it asks for exactly this;
// anything else is another round and the key cannot be reused for it.
export function roundSignature(lines: RoundLine[]): string {
  return lines
    .map((line) => JSON.stringify([line.productId, line.quantity, line.notes ?? null, optionsSignature(line.options)]))
    .sort()
    .join('|');
}

// The add-ons of one unit of a tab item, in cents: unitPriceCentsSnapshot already includes them,
// so the product's own price at the time is the snapshot minus these.
export function optionsExtraCents(options: { unitPriceCents: number; quantity: number }[]): number {
  return options.reduce((sum, option) => sum + option.unitPriceCents * option.quantity, 0);
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
