import { CartItem, CartItemOption, CartState } from './cart-types';

export const CART_STORAGE_KEY = 'restaurant-saas:cart';

// B7 (piloto 2026-10-23): at most 50 units of one product (the API refuses more: it is the same
// MAX_UNITS_PER_PRODUCT of apps/api/src/common/util/item-quantity.util.ts). The cart, the PDV and
// the tab stop the "+" there instead of letting the order fail at the end.
export const MAX_UNITS_PER_PRODUCT = 50;
export const MAX_UNITS_HINT = `Máximo de ${MAX_UNITS_PER_PRODUCT} unidades por produto.`;

export function atUnitLimit(quantity: number): boolean {
  return quantity >= MAX_UNITS_PER_PRODUCT;
}

// Units of one product over every line that has it (a tab adds a new line per launch; the cart
// has one line per combination of add-ons and note).
export function unitsOfProduct(
  items: { productId: string; quantity: number }[],
  productId: string,
): number {
  return items.reduce((sum, i) => (i.productId === productId ? sum + i.quantity : sum), 0);
}

export const emptyCart: CartState = { restaurantSlug: null, restaurantName: null, items: [] };

export interface AddItemInput {
  productId: string;
  name: string;
  // One unit, add-ons included.
  priceCents: number;
  imageUrl: string | null;
  options?: CartItemOption[];
  notes?: string | null;
  // How many units to add (the product page has its own counter). Default 1.
  quantity?: number;
}

export interface RestaurantRef {
  slug: string;
  name: string;
}

// Identity of a cart line: the product, its add-ons and its note. Without add-ons and note it is
// just the productId, so a line saved before add-ons existed keeps the same id.
export function lineKey(
  productId: string,
  options: { optionId: string; quantity: number }[] = [],
  notes?: string | null,
): string {
  const opts = options
    .map((o) => `${o.optionId}x${o.quantity}`)
    .sort()
    .join(',');
  const note = notes?.trim() ?? '';
  return opts || note ? `${productId}|${opts}|${note}` : productId;
}

// Pure predicate: does adding a product from `restaurantSlug` require
// confirming a cart wipe first? True only when the cart already belongs to
// a *different* restaurant AND actually has items in it.
export function needsRestaurantSwitchConfirm(state: CartState, restaurantSlug: string): boolean {
  return (
    state.restaurantSlug !== null &&
    state.restaurantSlug !== restaurantSlug &&
    state.items.length > 0
  );
}

// Pure: computes the next state for "add these units of this product (with these add-ons)".
// Never shows a dialog itself — a pure function can't. When switching
// restaurants would be required, it only proceeds if `force` is true; the
// caller (CartProvider) is responsible for confirming with the user first
// and passing force=true, or not calling this again at all.
// The same product with the same add-ons and note adds up on one line. Units over the
// per-product limit (all lines of the product together) are not added.
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
  const options = item.options ?? [];
  const notes = item.notes?.trim() || null;
  const lineId = lineKey(item.productId, options, notes);
  const room = MAX_UNITS_PER_PRODUCT - unitsOfProduct(baseItems, item.productId);
  const units = Math.min(item.quantity ?? 1, room);
  if (units <= 0) return state;

  const existing = baseItems.find((i) => i.lineId === lineId);
  const items: CartItem[] = existing
    ? baseItems.map((i) => (i.lineId === lineId ? { ...i, quantity: i.quantity + units } : i))
    : [
        ...baseItems,
        {
          lineId,
          productId: item.productId,
          name: item.name,
          priceCents: item.priceCents,
          imageUrl: item.imageUrl,
          quantity: units,
          options,
          notes,
        },
      ];

  return { restaurantSlug: restaurant.slug, restaurantName: restaurant.name, items };
}

// Stops at MAX_UNITS_PER_PRODUCT (B7), counted over every line of the product.
export function incrementItem(state: CartState, lineId: string): CartState {
  const line = state.items.find((i) => i.lineId === lineId);
  if (!line || atUnitLimit(unitsOfProduct(state.items, line.productId))) return state;
  return {
    ...state,
    items: state.items.map((i) => (i.lineId === lineId ? { ...i, quantity: i.quantity + 1 } : i)),
  };
}

// quantity >= 1 always. Reaching 0 removes the line entirely.
export function decrementItem(state: CartState, lineId: string): CartState {
  return {
    ...state,
    items: state.items
      .map((i) => (i.lineId === lineId ? { ...i, quantity: i.quantity - 1 } : i))
      .filter((i) => i.quantity > 0),
  };
}

export function removeItem(state: CartState, lineId: string): CartState {
  return { ...state, items: state.items.filter((i) => i.lineId !== lineId) };
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

// What the order sends for each line: ids and quantities only (the server prices everything).
export function toOrderItems(items: CartItem[]) {
  return items.map((item) => ({
    productId: item.productId,
    quantity: item.quantity,
    ...(item.options.length
      ? { options: item.options.map((o) => ({ optionId: o.optionId, quantity: o.quantity })) }
      : {}),
    ...(item.notes ? { notes: item.notes } : {}),
  }));
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
      items: parsed.items.map((i) => {
        // A cart saved before add-ons existed: same line, no add-ons, no note.
        const options = Array.isArray(i.options) ? i.options : [];
        const notes = typeof i.notes === 'string' ? i.notes : null;
        // A cart saved before B7 may hold more than the limit: brought down to it, not lost.
        const quantity = atUnitLimit(i.quantity) ? MAX_UNITS_PER_PRODUCT : i.quantity;
        return {
          ...i,
          lineId: i.lineId ?? lineKey(i.productId, options, notes),
          options,
          notes,
          quantity,
        };
      }),
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
