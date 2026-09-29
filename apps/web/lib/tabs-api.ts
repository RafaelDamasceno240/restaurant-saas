import { apiFetch } from './api-client';
import { PaymentMethod } from './checkout-api';

export type TabStatus = 'OPEN' | 'CLOSED';

export interface TabItem {
  id: string;
  productId: string;
  name: string;
  unitPriceCents: number;
  quantity: number;
  subtotalCents: number;
  notes: string | null;
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
  // Only on POST /tabs/:id/checkout — true when the same idempotencyKey was
  // already processed and the existing sale was returned.
  idempotentReplay?: boolean;
}

export interface TabSale {
  id: string;
  orderNumber: string;
  status: string;
  paymentMethod: PaymentMethod;
  totalCents: number;
  payment: {
    status: 'PENDING' | 'CONFIRMED' | 'FAILED';
    method: PaymentMethod;
    amountCents: number;
    confirmedAt: string | null;
  } | null;
}

// No amount field: the backend always charges the sum of the tab's snapshots.
export interface CheckoutTabInput {
  paymentMethod: PaymentMethod;
  idempotencyKey: string;
}

export interface OpenTabInput {
  branchId: string;
  tableId: string;
  customerName?: string;
}

// Deliberately no price field — the backend always looks up Product itself
// and snapshots name/price. See AddTabItemDto on the API side.
export interface AddTabItemInput {
  productId: string;
  quantity: number;
  notes?: string;
}

export interface UpdateTabItemInput {
  quantity?: number;
  notes?: string;
}

export const tabsApi = {
  list: (token: string, branchId: string, status?: TabStatus) =>
    apiFetch<Tab[]>(`/tabs?branchId=${branchId}${status ? `&status=${status}` : ''}`, {
      accessToken: token,
    }),
  get: (token: string, id: string) => apiFetch<Tab>(`/tabs/${id}`, { accessToken: token }),
  open: (token: string, input: OpenTabInput) =>
    apiFetch<Tab>('/tabs', { method: 'POST', body: input, accessToken: token }),
  addItem: (token: string, tabId: string, input: AddTabItemInput) =>
    apiFetch<Tab>(`/tabs/${tabId}/items`, { method: 'POST', body: input, accessToken: token }),
  updateItem: (token: string, tabId: string, itemId: string, input: UpdateTabItemInput) =>
    apiFetch<Tab>(`/tabs/${tabId}/items/${itemId}`, { method: 'PATCH', body: input, accessToken: token }),
  removeItem: (token: string, tabId: string, itemId: string) =>
    apiFetch<Tab>(`/tabs/${tabId}/items/${itemId}`, { method: 'DELETE', accessToken: token }),
  checkout: (token: string, tabId: string, input: CheckoutTabInput) =>
    apiFetch<Tab>(`/tabs/${tabId}/checkout`, { method: 'POST', body: input, accessToken: token }),
};
