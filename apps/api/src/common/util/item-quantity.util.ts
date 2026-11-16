// B7 (piloto 2026-10-23): at most 50 units of one product in an order, a PDV sale or a tab. The
// cart and the PDV let the count reach 56 and the order then failed with "items.0.quantity must
// not be greater than 50". The limit is per product, so the same product split over several lines
// (a tab adds a new line per launch) still counts once. apps/web keeps the same number in
// lib/cart-logic.ts and stops the "+" there; this is the rule that counts.
export const MAX_UNITS_PER_PRODUCT = 50;

export const MAX_UNITS_MESSAGE = `No máximo ${MAX_UNITS_PER_PRODUCT} unidades de cada produto.`;

// The first product whose lines add up to more than the limit, or null when all fit.
export function productOverUnitLimit(items: { productId: string; quantity: number }[]): string | null {
  const units = new Map<string, number>();
  for (const item of items) {
    const total = (units.get(item.productId) ?? 0) + item.quantity;
    if (total > MAX_UNITS_PER_PRODUCT) return item.productId;
    units.set(item.productId, total);
  }
  return null;
}
