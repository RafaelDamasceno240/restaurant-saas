import type { TabItem, TabItemStatus } from './tabs-api';
import { MAX_UNITS_PER_PRODUCT } from './cart-logic';

// B9 (piloto 2026-10-23): the waiter builds a ROUND on the device and sends it whole with
// "Enviar para a cozinha". Until then nothing reaches the API: the draft is only here (and in
// this device's storage, so a reload does not lose it). Once sent, items are never edited:
// more units = a new round, fewer = a cancellation.

export interface DraftLine {
  // Local identity of the line (two lines of one product with different notes stay apart).
  key: string;
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  notes: string;
}

export type RoundDraft = DraftLine[];

let keySeq = 0;
function newKey(): string {
  keySeq += 1;
  return `line-${Date.now()}-${keySeq}`;
}

// A product tapped in the catalog: one more unit on its line without notes, or a new line.
export function addToDraft(draft: RoundDraft, product: { id: string; name: string; priceCents: number }): RoundDraft {
  const index = draft.findIndex((line) => line.productId === product.id && line.notes.trim() === '');
  if (index >= 0) {
    return draft.map((line, i) => (i === index ? { ...line, quantity: line.quantity + 1 } : line));
  }
  return [...draft, { key: newKey(), productId: product.id, name: product.name, unitPriceCents: product.priceCents, quantity: 1, notes: '' }];
}

// Zero or less removes the line.
export function setDraftQuantity(draft: RoundDraft, key: string, quantity: number): RoundDraft {
  if (quantity <= 0) return draft.filter((line) => line.key !== key);
  return draft.map((line) => (line.key === key ? { ...line, quantity } : line));
}

export function setDraftNotes(draft: RoundDraft, key: string, notes: string): RoundDraft {
  return draft.map((line) => (line.key === key ? { ...line, notes: notes.slice(0, 300) } : line));
}

export function draftUnits(draft: RoundDraft): number {
  return draft.reduce((sum, line) => sum + line.quantity, 0);
}

export function draftTotalCents(draft: RoundDraft): number {
  return draft.reduce((sum, line) => sum + line.unitPriceCents * line.quantity, 0);
}

export function unsentLabel(units: number): string {
  return units === 1 ? '1 item ainda não enviado' : `${units} itens ainda não enviados`;
}

// B7 for a tab: the active units of a product already on the tab plus the ones in the draft.
export function tabUnitsOfProduct(items: Pick<TabItem, 'productId' | 'activeQuantity'>[], draft: RoundDraft, productId: string): number {
  const onTab = items.filter((item) => item.productId === productId).reduce((sum, item) => sum + item.activeQuantity, 0);
  const inDraft = draft.filter((line) => line.productId === productId).reduce((sum, line) => sum + line.quantity, 0);
  return onTab + inDraft;
}

// What the API receives: product, quantity and the note when there is one. Never a price.
export function toRoundItems(draft: RoundDraft): { productId: string; quantity: number; notes?: string }[] {
  return draft.map((line) => ({
    productId: line.productId,
    quantity: line.quantity,
    ...(line.notes.trim() ? { notes: line.notes.trim() } : {}),
  }));
}

export const TAB_ITEM_STATUS_LABEL: Record<TabItemStatus, string> = {
  SENT: 'Enviado',
  PREPARING: 'Em preparo',
  READY: 'Pronto',
  SERVED: 'Entregue',
  CANCELLED: 'Cancelado',
};

// Still with the kitchen: the waiter may mark it delivered.
export function canServe(status: TabItemStatus): boolean {
  return status === 'SENT' || status === 'PREPARING' || status === 'READY';
}

// Who may cancel (the API decides; this only hides what would be refused): any waiter while the
// kitchen has not started, orders.cancel from then on.
export function cancelNeedsManager(status: TabItemStatus): boolean {
  return status !== 'SENT';
}

// Only an item already in preparation or ready asks where the ingredients went.
export function cancelAsksStock(status: TabItemStatus): boolean {
  return status === 'PREPARING' || status === 'READY';
}

// Items the bill charges but the table has not received yet.
export function itemsNotDelivered(items: Pick<TabItem, 'status' | 'activeQuantity'>[]): number {
  return items.filter((item) => canServe(item.status)).reduce((sum, item) => sum + item.activeQuantity, 0);
}

// --- the draft on this device ----------------------------------------------------------------
// Per tab. Storage may be missing or throw (private window, blocked site data): the screen works
// without it, the draft just does not survive a reload then.

export function draftStorageKey(tabId: string): string {
  return `restaurant-saas:tab-draft:${tabId}`;
}

export function parseDraft(raw: string | null): RoundDraft {
  if (!raw) return [];
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) return [];
    return value
      .filter(
        (line): line is DraftLine =>
          !!line &&
          typeof line.productId === 'string' &&
          typeof line.name === 'string' &&
          Number.isInteger(line.unitPriceCents) &&
          Number.isInteger(line.quantity) &&
          line.quantity > 0,
      )
      .map((line) => ({
        key: typeof line.key === 'string' ? line.key : newKey(),
        productId: line.productId,
        name: line.name,
        unitPriceCents: line.unitPriceCents,
        quantity: Math.min(line.quantity, MAX_UNITS_PER_PRODUCT),
        notes: typeof line.notes === 'string' ? line.notes.slice(0, 300) : '',
      }));
  } catch {
    return [];
  }
}

export function loadDraft(tabId: string): RoundDraft {
  try {
    return parseDraft(window.localStorage.getItem(draftStorageKey(tabId)));
  } catch {
    return [];
  }
}

export function saveDraft(tabId: string, draft: RoundDraft): void {
  try {
    if (draft.length === 0) window.localStorage.removeItem(draftStorageKey(tabId));
    else window.localStorage.setItem(draftStorageKey(tabId), JSON.stringify(draft));
  } catch {
    // Without storage the draft lives only on screen.
  }
}
