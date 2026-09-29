import { CartItem, CartState } from './cart-types';

export const CART_STORAGE_KEY = 'restaurant-saas:cart';

export const emptyCart: CartState = { restaurantSlug: null, restaurantName: null, items: [] };

export interface AddItemInput {
  productId: string;
  name: string;
  priceCents: number;
  imageUrl: string | null;
}

export interface RestaurantRef {
  slug: string;
  name: string;
}

// Pure predicate: does adding a product from `restaurantSlug` require
// confirming a cart wipe first? True only when the cart already belongs to
// a *different* restaurant AND actually has items in it.
export function needsRestaurantSwitchConfirm(state: CartState, restaurantSlug: string): boolean {
  return (
    state.restaurantSlug !== null && state.restaurantSlug !== restaurantSlug && state.items.length > 0
  );
}

// Pure: computes the next state for "add one unit of this product".
// Never shows a dialog itself — a pure function can't. When switching
// restaurants would be required, it only proceeds if `force` is true; the
// caller (CartProvider) is responsible for confirming with the user first
// and passing force=true, or not calling this again at all.
export function addItem(
  state: CartState,
  item: AddItemInput,
  restaurant: RestaurantRef,
  force = false,
): CartState {
  const mustSwitch = needsRestaurantSwitchConfirm(state, restaurant.slug);
  if (mustSwitch && !force) {
    return state; // unchanged — caller must confirm and retry with force
  }

  const baseItems = mustSwitch ? [] : state.items;
  const existing = baseItems.find((i) => i.productId === item.productId);
  const items: CartItem[] = existing
    ? baseItems.map((i) => (i.productId === item.productId ? { ...i, quantity: i.quantity + 1 } : i))
    : [...baseItems, { ...item, quantity: 1 }];

  return { restaurantSlug: restaurant.slug, restaurantName: restaurant.name, items };
}

export function incrementItem(state: CartState, productId: string): CartState {
  return {
    ...state,
    items: state.items.map((i) => (i.productId === productId ? { ...i, quantity: i.quantity + 1 } : i)),
  };
}

// quantity >= 1 always. Reaching 0 removes the item entirely.
export function decrementItem(state: CartState, productId: string): CartState {
  return {
    ...state,
    items: state.items
      .map((i) => (i.productId === productId ? { ...i, quantity: i.quantity - 1 } : i))
      .filter((i) => i.quantity > 0),
  };
}

export function removeItem(state: CartState, productId: string): CartState {
  return { ...state, items: state.items.filter((i) => i.productId !== productId) };
}

export function clearCart(): CartState {
  return { ...emptyCart, items: [] };
}

export function getTotalQuantity(state: CartState): number {
  return state.items.reduce((sum, i) => sum + i.quantity, 0);
}

// Cents in, cents out — no float touches this. Formatting to reais happens
// only at render time, via lib/money.ts.
export function getSubtotalCents(state: CartState): number {
  return state.items.reduce((sum, i) => sum + i.priceCents * i.quantity, 0);
}

export function loadCart(): CartState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<CartState> | null;
    if (!parsed || !Array.isArray(parsed.items)) return null;
    return {
      restaurantSlug: parsed.restaurantSlug ?? null,
      restaurantName: parsed.restaurantName ?? null,
      items: parsed.items,
    };
  } catch {
    return null; // corrupted storage — start fresh rather than crash
  }
}

export function saveCart(state: CartState): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // storage unavailable/full — cart still works in-memory this session
  }
}
