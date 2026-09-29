// Pure cart math for the /demo/pdv screen. Deliberately its own module
// instead of importing lib/pos-logic.ts (the real PDV's cart): the demo
// must stay isolated from the real flow (per the explicit "isolado do
// fluxo real" requirement) — nothing here ever calls `POST /v1/pos/orders`
// or any other endpoint, and no future change to the real PDV's rules can
// accidentally change what the demo shows tomorrow. Same shape on purpose,
// so this is easy to read side-by-side with the real one.

export interface DemoCartItem {
  productId: string;
  name: string;
  priceCents: number;
  quantity: number;
}

export function addToCart(
  items: DemoCartItem[],
  product: { productId: string; name: string; priceCents: number },
): DemoCartItem[] {
  const existing = items.find((i) => i.productId === product.productId);
  if (existing) {
    return items.map((i) =>
      i.productId === product.productId ? { ...i, quantity: i.quantity + 1 } : i,
    );
  }
  return [...items, { ...product, quantity: 1 }];
}

export function incrementItem(items: DemoCartItem[], productId: string): DemoCartItem[] {
  return items.map((i) => (i.productId === productId ? { ...i, quantity: i.quantity + 1 } : i));
}

export function decrementItem(items: DemoCartItem[], productId: string): DemoCartItem[] {
  return items
    .map((i) => (i.productId === productId ? { ...i, quantity: i.quantity - 1 } : i))
    .filter((i) => i.quantity > 0);
}

export function removeItem(items: DemoCartItem[], productId: string): DemoCartItem[] {
  return items.filter((i) => i.productId !== productId);
}

export function getSubtotalCents(items: DemoCartItem[]): number {
  return items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
}
