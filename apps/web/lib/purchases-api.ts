import { apiFetch } from './api-client';
import { InventoryUnit } from './inventory-api';

export type PurchaseStatus = 'DRAFT' | 'RECEIVED' | 'CANCELLED';

export const PURCHASE_STATUS_LABEL: Record<PurchaseStatus, string> = {
  DRAFT: 'Rascunho',
  RECEIVED: 'Recebida',
  CANCELLED: 'Cancelada',
};

export const PURCHASE_EVENT_LABEL: Record<string, string> = {
  PURCHASE_CREATED: 'Compra criada',
  PURCHASE_UPDATED: 'Compra editada',
  PURCHASE_RECEIVED: 'Compra recebida e estoque atualizado',
  PURCHASE_CANCELLED: 'Compra cancelada',
};

export interface Supplier {
  id: string;
  name: string;
  document: string | null;
  phone: string | null;
  email: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierInput {
  name?: string;
  document?: string | null;
  phone?: string | null;
  email?: string | null;
  notes?: string | null;
  active?: boolean;
}

export interface PurchaseListItem {
  id: string;
  purchaseNumber: string;
  status: PurchaseStatus;
  purchaseDate: string;
  supplier: { id: string; name: string };
  branch: { id: string; name: string };
  itemCount: number;
  subtotalCents: number;
  totalCents: number;
  receivedAt: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
}

export type PurchaseSummary = Record<PurchaseStatus, { count: number; totalCents: number }>;

export interface PurchasePage {
  data: PurchaseListItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  summary: PurchaseSummary;
}

export interface PurchaseItemView {
  id: string;
  inventoryItem: { id: string; name: string; unit: InventoryUnit };
  quantity: number;
  unitCostCents: number;
  totalCostCents: number;
  lotCode: string | null;
  expiresAt: string | null;
}

export interface PurchaseEvent {
  id: string;
  action: string;
  createdAt: string;
  user: { id: string; name: string } | null;
  reason: string | null;
}

export interface PurchaseDetail {
  id: string;
  purchaseNumber: string;
  status: PurchaseStatus;
  purchaseDate: string;
  supplier: { id: string; name: string };
  branch: { id: string; name: string };
  subtotalCents: number;
  discountCents: number;
  freightCents: number;
  otherCostsCents: number;
  totalCents: number;
  notes: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
  receivedAt: string | null;
  receivedBy: { id: string; name: string } | null;
  cancelledAt: string | null;
  cancelledBy: { id: string; name: string } | null;
  cancelReason: string | null;
  items: PurchaseItemView[];
  events: PurchaseEvent[];
  idempotentReplay?: boolean;
}

export interface PurchaseItemInput {
  inventoryItemId: string;
  quantity: number;
  unitCostCents: number;
  lotCode?: string;
  expiresAt?: string;
}

export interface PurchaseInput {
  supplierId: string;
  purchaseDate: string;
  notes?: string;
  discountCents: number;
  freightCents: number;
  otherCostsCents: number;
  items: PurchaseItemInput[];
}

export interface PurchaseFilters {
  status?: PurchaseStatus;
  supplierId?: string;
  dateFrom?: string;
  dateTo?: string;
  search?: string;
  page?: number;
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  return search.toString();
}

export const suppliersApi = {
  list: (token: string, includeInactive = false) =>
    apiFetch<Supplier[]>(`/suppliers?${qs({ includeInactive: includeInactive ? 'true' : undefined })}`, {
      accessToken: token,
    }),
  create: (token: string, input: SupplierInput) =>
    apiFetch<Supplier>('/suppliers', { method: 'POST', body: input, accessToken: token }),
  update: (token: string, id: string, input: SupplierInput) =>
    apiFetch<Supplier>(`/suppliers/${id}`, { method: 'PATCH', body: input, accessToken: token }),
};

export const purchasesApi = {
  list: (token: string, branchId: string, filters: PurchaseFilters) =>
    apiFetch<PurchasePage>(`/purchases?${qs({ branchId, ...filters })}`, { accessToken: token }),
  get: (token: string, id: string) => apiFetch<PurchaseDetail>(`/purchases/${id}`, { accessToken: token }),
  create: (token: string, input: PurchaseInput & { branchId: string; receiveNow?: boolean }) =>
    apiFetch<PurchaseDetail>('/purchases', { method: 'POST', body: input, accessToken: token }),
  update: (token: string, id: string, input: PurchaseInput) =>
    apiFetch<PurchaseDetail>(`/purchases/${id}`, { method: 'PATCH', body: input, accessToken: token }),
  receive: (token: string, id: string) =>
    apiFetch<PurchaseDetail>(`/purchases/${id}/receive`, { method: 'POST', accessToken: token }),
  cancel: (token: string, id: string, reason?: string) =>
    apiFetch<PurchaseDetail>(`/purchases/${id}/cancel`, { method: 'POST', body: { reason }, accessToken: token }),
};
