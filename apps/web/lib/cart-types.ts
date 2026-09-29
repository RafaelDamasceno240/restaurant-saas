export interface CartItem {
  productId: string;
  name: string;
  // Snapshot of the price shown on the menu at add-time, in cents — never
  // re-fetched, never floating point. See lib/money.ts.
  priceCents: number;
  imageUrl: string | null;
  quantity: number;
}

export interface CartState {
  // Both null together (empty cart) or both set together — never mixed.
  restaurantSlug: string | null;
  restaurantName: string | null;
  items: CartItem[];
}
