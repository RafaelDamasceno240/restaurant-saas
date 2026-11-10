import { apiFetch } from './api-client';
import { PaymentMethod, StaffPaymentMethod } from './checkout-api';
import type { CreditTerms } from './receivables-api';

export type TabStatus = 'OPEN' | 'CLOSED';

// B9: where an item is. SENT/PREPARING/READY = with the kitchen; SERVED = at the table;
// CANCELLED = every unit cancelled.
export type TabItemStatus = 'SENT' | 'PREPARING' | 'READY' | 'SERVED' | 'CANCELLED';

export interface TabItem {
  id: string;
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  // B9: units cancelled so far, and the ones still due (what subtotalCents charges).
  cancelledQuantity: number;
  activeQuantity: number;
  subtotalCents: number;
  notes: string | null;
  status: TabItemStatus;
  // null = launched before rounds existed (never went to the kitchen, counts as delivered).
  roundId: string | null;
  roundNumber: number | null;
  sentAt: string | null;
  preparingAt: string | null;
  readyAt: string | null;
  servedAt: string | null;
  cancelledAt: string | null;
}

export interface Tab {
  id: string;
  tenantId: string;
  branchId: string;
  status: TabStatus;
  customerName: string | null;
  table: { id: string; number: number; name: string | null };
  subtotalCents: number;
  totalCents: number;
  itemCount: number;
  items: TabItem[];
  openedAt: string;
  closedAt: string | null;
  // Fatia 10: the sale this tab was checked out into (null while OPEN).
  order: TabSale | null;
  // Only on GET /tabs/:id — whether CASH can go through right now.
  branchCashRegisterOpen?: boolean;
  // Only on POST /tabs/:id/checkout and /rounds — true when the same idempotencyKey was
  // already processed and the existing result was returned.
  idempotentReplay?: boolean;
  // Only on POST /tabs/:id/rounds — the round just sent (or found again by its key).
  round?: { id: string; number: number };
}

export interface TabSale {
  id: string;
  orderNumber: string;
  status: string;
  paymentMethod: StaffPaymentMethod;
  totalCents: number;
  // null for a bill put on account (fiado): nothing was received, the debt is in contas a receber.
  payment: {
    status: 'PENDING' | 'CONFIRMED' | 'FAILED';
    method: PaymentMethod;
    amountCents: number;
    confirmedAt: string | null;
  } | null;
}

// No amount field: the backend always charges the sum of the tab's snapshots.
export interface CheckoutTabInput {
  paymentMethod: StaffPaymentMethod;
  idempotencyKey: string;
  // Only with paymentMethod ON_ACCOUNT (needs receivables.sell and a customerId).
  creditTerms?: CreditTerms;
  // A customer of the registry the sale belongs to (needs customers.read). Only the id travels.
  customerId?: string;
  // Cents of that customer's cashback balance to spend on this sale (needs cashback.use).
  cashbackToUseCents?: number;
}

export interface OpenTabInput {
  branchId: string;
  tableId: string;
  customerName?: string;
}

// B9: one "Enviar para a cozinha". Deliberately no price field — the backend always looks up
// Product itself and snapshots name/price (SendTabRoundDto). The key is generated once per send
// and re-sent on retries: the API then returns the round it already made.
export interface SendRoundInput {
  idempotencyKey: string;
  items: { productId: string; quantity: number; notes?: string }[];
}

// B9: cancelling units of a sent item. returnToStock only matters for an item in preparation or
// ready (manager); the reason is always required.
export interface CancelTabItemInput {
  quantity: number;
  reason: string;
  returnToStock?: boolean;
}

export const tabsApi = {
  list: (token: string, branchId: string, status?: TabStatus) =>
    apiFetch<Tab[]>(`/tabs?branchId=${branchId}${status ? `&status=${status}` : ''}`, {
      accessToken: token,
    }),
  get: (token: string, id: string) => apiFetch<Tab>(`/tabs/${id}`, { accessToken: token }),
  open: (token: string, input: OpenTabInput) =>
    apiFetch<Tab>('/tabs', { method: 'POST', body: input, accessToken: token }),
  sendRound: (token: string, tabId: string, input: SendRoundInput) =>
    apiFetch<Tab>(`/tabs/${tabId}/rounds`, { method: 'POST', body: input, accessToken: token }),
  cancelItem: (token: string, tabId: string, itemId: string, input: CancelTabItemInput) =>
    apiFetch<Tab>(`/tabs/${tabId}/items/${itemId}/cancel`, { method: 'POST', body: input, accessToken: token }),
  serveItem: (token: string, tabId: string, itemId: string) =>
    apiFetch<Tab>(`/tabs/${tabId}/items/${itemId}/serve`, { method: 'POST', accessToken: token }),
  // Frees the table of a tab with nothing to charge, without a sale.
  closeEmpty: (token: string, tabId: string) =>
    apiFetch<Tab>(`/tabs/${tabId}/close-empty`, { method: 'POST', accessToken: token }),
  checkout: (token: string, tabId: string, input: CheckoutTabInput) =>
    apiFetch<Tab>(`/tabs/${tabId}/checkout`, { method: 'POST', body: input, accessToken: token }),
};
