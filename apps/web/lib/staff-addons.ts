// Add-ons in the staff sale screens (PDV and table tabs). The rules of a choice are the public
// menu's own (lib/menu-display.ts: single choice, limits, required groups) so a customer and an
// attendant can never build different things; this module only adapts the panel's data to them
// and adds what the counter needs (sold-out options shown but not pickable, editing a line).
// Everything here is a display estimate: the API prices and validates every line again.
import type { OptionGroup, Product } from './cardapio-api';
import type { PublicMenuOption, PublicMenuOptionGroup } from './public-menu-api';
import { toCents } from './money';
import { lineKey } from './cart-logic';
import {
  ChosenOptionLine,
  Selection,
  canIncrement,
  chosenOptions,
  firstMissingGroup,
  groupUnits,
} from './menu-display';

export type { ChosenOptionLine, Selection } from './menu-display';

export interface StaffOption extends PublicMenuOption {
  // Shown (the attendant must know it exists and why it cannot be picked) but never selectable.
  soldOut: boolean;
}

export interface StaffOptionGroup extends PublicMenuOptionGroup {
  options: StaffOption[];
}

// The product's groups as the sale offers them: in the product's order, only active groups and
// active options. A required group stays even with everything sold out (the sale is then blocked
// with a reason, as the API would block it); an optional group with nothing active is dropped.
export function productSaleGroups(
  product: Pick<Product, 'optionGroupIds'>,
  groups: OptionGroup[] | undefined,
): StaffOptionGroup[] {
  if (!groups || product.optionGroupIds.length === 0) return [];
  const byId = new Map(groups.map((g) => [g.id, g]));
  return product.optionGroupIds
    .map((id) => byId.get(id))
    .filter((g): g is OptionGroup => !!g && g.active)
    .map((g) => ({
      id: g.id,
      name: g.name,
      minSelect: g.minSelect,
      maxSelect: g.maxSelect,
      options: g.options
        .filter((o) => o.active)
        .map((o) => ({
          id: o.id,
          name: o.name,
          description: o.description,
          price: o.price,
          maxQuantity: o.maxQuantity,
          imageUrl: null,
          soldOut: o.soldOut,
        })),
    }))
    .filter((g) => g.options.length > 0 || g.minSelect > 0);
}

// Whether tapping the product must open the personalization (it has something to choose).
export function needsPersonalization(groups: StaffOptionGroup[]): boolean {
  return groups.length > 0;
}

// "+" on an option: the menu's rule, and never a sold-out option.
export function canPick(group: StaffOptionGroup, optionId: string, selection: Selection): boolean {
  const option = group.options.find((o) => o.id === optionId);
  if (!option || option.soldOut) return false;
  return canIncrement(group, optionId, selection);
}

// A required group that can no longer be satisfied (every option sold out): nothing to do here,
// the product cannot be sold until the restaurant changes the menu.
export function blockedRequiredGroup(groups: StaffOptionGroup[]): StaffOptionGroup | null {
  return (
    groups.find((g) => {
      if (g.minSelect === 0) return false;
      const room = g.options.filter((o) => !o.soldOut).reduce((sum, o) => sum + o.maxQuantity, 0);
      return Math.min(room, g.maxSelect) < g.minSelect;
    }) ?? null
  );
}

// The first required group still short of its minimum, or null when the choice is complete.
export function missingGroup(groups: StaffOptionGroup[], selection: Selection): StaffOptionGroup | null {
  return firstMissingGroup(groups, selection) as StaffOptionGroup | null;
}

export function selectedUnits(group: StaffOptionGroup, selection: Selection): number {
  return groupUnits(group, selection);
}

// Back from a saved line to the modal: only what can still be chosen survives (an option that
// was sold out, removed or moved to another group meanwhile is dropped and reported).
export function selectionFromOptions(
  groups: StaffOptionGroup[],
  options: { optionId: string; quantity: number }[],
): { selection: Selection; dropped: string[] } {
  const available = new Map<string, StaffOption>();
  for (const g of groups) for (const o of g.options) if (!o.soldOut) available.set(o.id, o);
  const selection: Selection = {};
  const dropped: string[] = [];
  for (const o of options) {
    const option = available.get(o.optionId);
    if (!option) {
      dropped.push(o.optionId);
      continue;
    }
    selection[o.optionId] = Math.min(o.quantity, option.maxQuantity);
  }
  return { selection, dropped };
}

export function extrasCents(options: { priceCents: number; quantity: number }[]): number {
  return options.reduce((sum, o) => sum + o.priceCents * o.quantity, 0);
}

// What the modal hands back: one personalized line, ready for the cart or the round draft.
export interface PersonalizedLine {
  productId: string;
  name: string;
  basePriceCents: number;
  // One unit, add-ons included (display estimate).
  unitPriceCents: number;
  options: ChosenOptionLine[];
  notes: string | null;
  quantity: number;
}

export function buildPersonalizedLine(
  product: { id: string; name: string; price: number },
  groups: StaffOptionGroup[],
  selection: Selection,
  notes: string,
  quantity: number,
): PersonalizedLine {
  const options = chosenOptions(groups, selection);
  const basePriceCents = toCents(product.price);
  return {
    productId: product.id,
    name: product.name,
    basePriceCents,
    unitPriceCents: basePriceCents + extrasCents(options),
    options,
    notes: notes.trim() || null,
    quantity,
  };
}

// Identity of a line: product + add-ons + note (the public cart's own rule). The same
// personalization added twice adds up on one line; anything different is another line.
export function personalizedKey(line: { productId: string; options: { optionId: string; quantity: number }[]; notes: string | null }): string {
  return lineKey(line.productId, line.options, line.notes);
}

// What the API receives for a line: ids and quantities only, never a price or a name.
export function toApiLine(line: {
  productId: string;
  quantity: number;
  options: { optionId: string; quantity: number }[];
  notes: string | null;
}): { productId: string; quantity: number; options?: { optionId: string; quantity: number }[]; notes?: string } {
  return {
    productId: line.productId,
    quantity: line.quantity,
    ...(line.options.length ? { options: line.options.map((o) => ({ optionId: o.optionId, quantity: o.quantity })) } : {}),
    ...(line.notes?.trim() ? { notes: line.notes.trim() } : {}),
  };
}

// A short summary under a line name: "Ao ponto · 2× Bacon · Cheddar".
export function optionsSummary(options: { name: string; quantity: number }[]): string {
  return options.map((o) => (o.quantity > 1 ? `${o.quantity}× ${o.name}` : o.name)).join(' · ');
}

// ---- server quote ------------------------------------------------------------------------------

export interface QuoteLine {
  productId: string;
  name: string;
  quantity: number;
  basePriceCents: number;
  extrasCents: number;
  unitPriceCents: number;
  subtotalCents: number;
  notes: string | null;
  options: { optionId: string | null; group: string; name: string; unitPriceCents: number; quantity: number }[];
}

export interface ItemsQuote {
  items: QuoteLine[];
  subtotalCents: number;
}

// The quote answers for exactly the lines it was asked for, in that order; any change makes it
// stale (the screen then shows its estimate, marked as such, until the next answer).
export function quoteKey(lines: ReturnType<typeof toApiLine>[]): string {
  return JSON.stringify(lines);
}
