// Deliberately separate from lib/cart-logic.ts (the public cardápio cart):
// that module's CartState bakes in a restaurantSlug/restaurantName concept
// for switching between restaurants, which doesn't apply here — the logged
// -in staff member's own tenant IS the restaurant, there is no switching.
// Reusing it as-is would mean carrying irrelevant fields around; this is a
// small, PDV-specific pure module instead, per the explicit instruction to
// give the PDV its own state rather than force-fit the public cart.
//
// Add-ons: a line is a product WITH its add-ons and its note (the public cart's own identity rule,
// lineKey). A product without either keeps its productId as the key, so the plain counter flow
// (tap, tap, tap) still adds up on one line.

import { MAX_UNITS_PER_PRODUCT, atUnitLimit, lineKey, unitsOfProduct } from './cart-logic';
import type { ChosenOptionLine } from './menu-display';

export interface PosCartItem {
  // Identity of the line: product + add-ons + note.
  key: string;
  productId: string;
  name: string;
  // Snapshot at add-time, for display only — never sent to the backend. One unit, add-ons
  // included. POST /v1/pos/orders only ever receives productId, quantity, option ids and
  // quantities and the note; every price is recalculated server-side.
  priceCents: number;
  quantity: number;
  options: ChosenOptionLine[];
  notes: string | null;
}

export interface PosLineInput {
  productId: string;
  name: string;
  priceCents: number;
  options?: ChosenOptionLine[];
  notes?: string | null;
  quantity?: number;
}

function keyOf(line: { productId: string; options?: ChosenOptionLine[]; notes?: string | null }): string {
  return lineKey(line.productId, line.options ?? [], line.notes ?? null);
}

// Units of this product the sale may still take (B7: all its lines together).
export function roomFor(items: PosCartItem[], productId: string): number {
  return Math.max(0, MAX_UNITS_PER_PRODUCT - unitsOfProduct(items, productId));
}

// Adds `quantity` units (default 1) of a line; the same personalization adds up on one line.
// B7: at most MAX_UNITS_PER_PRODUCT of one product over all its lines, as the public cart.
export function addToCart(items: PosCartItem[], product: PosLineInput): PosCartItem[] {
  const room = roomFor(items, product.productId);
  const quantity = Math.min(product.quantity ?? 1, room);
  if (quantity <= 0) return items;
  const key = keyOf(product);
  const existing = items.find((i) => i.key === key);
  if (existing) {
    return items.map((i) => (i.key === key ? { ...i, quantity: i.quantity + quantity } : i));
  }
  return [
    ...items,
    {
      key,
      productId: product.productId,
      name: product.name,
      priceCents: product.priceCents,
      quantity,
      options: product.options ?? [],
      notes: product.notes?.trim() || null,
    },
  ];
}

// Replaces a line by its edited version (other add-ons, note or quantity). If the edit makes it
// identical to another line, the two become one. The line keeps its place in the sale.
export function replaceLine(items: PosCartItem[], key: string, edited: PosLineInput): PosCartItem[] {
  const index = items.findIndex((i) => i.key === key);
  if (index < 0) return items;
  const others = items.filter((i) => i.key !== key);
  const room = roomFor(others, edited.productId);
  const quantity = Math.min(edited.quantity ?? items[index].quantity, room);
  if (quantity <= 0) return others;
  const newKey = keyOf(edited);
  const twin = others.find((i) => i.key === newKey);
  if (twin) return others.map((i) => (i.key === newKey ? { ...i, quantity: i.quantity + quantity } : i));
  const line: PosCartItem = {
    key: newKey,
    productId: edited.productId,
    name: edited.name,
    priceCents: edited.priceCents,
    quantity,
    options: edited.options ?? [],
    notes: edited.notes?.trim() || null,
  };
  return [...items.slice(0, index), line, ...items.slice(index + 1)];
}

export function incrementItem(items: PosCartItem[], key: string): PosCartItem[] {
  const line = items.find((i) => i.key === key);
  if (!line || atUnitLimit(unitsOfProduct(items, line.productId))) return items;
  return items.map((i) => (i.key === key ? { ...i, quantity: i.quantity + 1 } : i));
}

// quantity >= 1 always. Reaching 0 removes the item entirely.
export function decrementItem(items: PosCartItem[], key: string): PosCartItem[] {
  return items
    .map((i) => (i.key === key ? { ...i, quantity: i.quantity - 1 } : i))
    .filter((i) => i.quantity > 0);
}

// Removes ONE line; the other lines of the same product are left alone.
export function removeItem(items: PosCartItem[], key: string): PosCartItem[] {
  return items.filter((i) => i.key !== key);
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
