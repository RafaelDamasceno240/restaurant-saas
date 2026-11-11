// An add-on chosen for each unit of a cart line. Display snapshot only: the order sends just
// optionId + quantity and the server prices it again.
export interface CartItemOption {
  optionId: string;
  groupName: string;
  name: string;
  priceCents: number;
  quantity: number;
}

export interface CartItem {
  // The same product with other add-ons or another note is another line. A product without
  // either keeps its productId as lineId (carts saved before add-ons existed still work).
  lineId: string;
  productId: string;
  name: string;
  // Snapshot of the price shown on the menu at add-time, in cents, add-ons of one unit included —
  // never re-fetched, never floating point. See lib/money.ts.
  priceCents: number;
  imageUrl: string | null;
  quantity: number;
  options: CartItemOption[];
  notes: string | null;
}

export interface CartState {
  // Both null together (empty cart) or both set together — never mixed.
  restaurantSlug: string | null;
  restaurantName: string | null;
  items: CartItem[];
}
