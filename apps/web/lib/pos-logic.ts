// Deliberately separate from lib/cart-logic.ts (the public cardápio cart):
// that module's CartState bakes in a restaurantSlug/restaurantName concept
// for switching between restaurants, which doesn't apply here — the logged
// -in staff member's own tenant IS the restaurant, there is no switching.
// Reusing it as-is would mean carrying irrelevant fields around; this is a
// small, PDV-specific pure module instead, per the explicit instruction to
// give the PDV its own state rather than force-fit the public cart.

export interface PosCartItem {
  productId: string;
  name: string;
  // Snapshot at add-time, for display only — never sent to the backend.
  // POST /v1/pos/orders only ever receives {productId, quantity} per item;
  // price is always recalculated server-side from the current Product row.
  priceCents: number;
  quantity: number;
}

export function addToCart(
  items: PosCartItem[],
  product: { productId: string; name: string; priceCents: number },
): PosCartItem[] {
  const existing = items.find((i) => i.productId === product.productId);
  if (existing) {
    return items.map((i) =>
      i.productId === product.productId ? { ...i, quantity: i.quantity + 1 } : i,
    );
  }
  return [...items, { ...product, quantity: 1 }];
}

export function incrementItem(items: PosCartItem[], productId: string): PosCartItem[] {
  return items.map((i) => (i.productId === productId ? { ...i, quantity: i.quantity + 1 } : i));
}

// quantity >= 1 always. Reaching 0 removes the item entirely.
export function decrementItem(items: PosCartItem[], productId: string): PosCartItem[] {
  return items
    .map((i) => (i.productId === productId ? { ...i, quantity: i.quantity - 1 } : i))
    .filter((i) => i.quantity > 0);
}

export function removeItem(items: PosCartItem[], productId: string): PosCartItem[] {
  return items.filter((i) => i.productId !== productId);
}

export function getSubtotalCents(items: PosCartItem[]): number {
  return items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
}

export function getTotalQuantity(items: PosCartItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity, 0);
}

export interface PosFilterableProduct {
  id: string;
  name: string;
  categoryId: string;
  active: boolean;
}

// Combines "PDV only shows active products" with the search box and the
// category filter in one pure, testable function — the PDV page calls this
// on every keystroke/click rather than re-fetching anything.
export function filterPosProducts<T extends PosFilterableProduct>(
  products: T[],
  query: string,
  categoryId: string | null,
): T[] {
  const normalizedQuery = query.trim().toLowerCase();
  return products.filter((product) => {
    if (!product.active) return false;
    if (categoryId && product.categoryId !== categoryId) return false;
    if (normalizedQuery && !product.name.toLowerCase().includes(normalizedQuery)) return false;
    return true;
  });
}
