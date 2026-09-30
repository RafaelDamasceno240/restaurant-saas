import { apiFetch } from './api-client';
import { OrderStatus } from './orders-api';

export type DeliveryStatus = 'PENDING' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED' | 'CANCELLED';

export interface DeliveryAddress {
  street: string;
  number: string;
  complement: string | null;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
}

// Money is integer cents on this API (same convention as purchases).
export interface DeliveryItem {
  id: string;
  status: DeliveryStatus;
  orderId: string;
  orderNumber: string;
  orderStatus: OrderStatus;
  customerName: string | null;
  customerPhone: string | null;
  address: DeliveryAddress;
  paymentMethod: 'CASH' | 'PIX' | 'CARD';
  // Two different notes: the order's general observation and the delivery instructions.
  orderNotes: string | null;
  deliveryNotes: string | null;
  itemCount: number;
  subtotalCents: number;
  deliveryFeeCents: number;
  totalCents: number;
  attemptCount: number;
  failureReason: string | null;
  // Hints computed by the server from the current state; the API enforces them anyway.
  canDispatch: boolean;
  canFail: boolean;
  canRedeliver: boolean;
  canEditNotes: boolean;
  // Internal courier (a user with the DELIVERY role); null = nobody assigned yet.
  courier: { id: string; name: string } | null;
  assignedAt: string | null;
  canAssign: boolean;
  orderCreatedAt: string;
  dispatchedAt: string | null;
  deliveredAt: string | null;
  failedAt: string | null;
  cancelledAt: string | null;
}

export type DeliverySummary = Record<DeliveryStatus, number>;

export interface DeliveryPage {
  data: DeliveryItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  summary: DeliverySummary;
}

export interface DeliveryActionResult extends DeliveryItem {
  idempotentReplay: boolean;
}

export interface DeliverySettings {
  branchId: string;
  enabled: boolean;
  feeCents: number;
  minOrderCents: number;
}

export interface DeliveryFilters {
  status?: DeliveryStatus;
  orderStatus?: OrderStatus;
  search?: string;
  dateFrom?: string;
  dateTo?: string;
  // 'me' | 'none' | a courier's user id
  courier?: string;
  page?: number;
}

export interface CourierOption {
  id: string;
  name: string;
}

export type DeliveryHistoryKind =
  | 'CREATED'
  | 'ASSIGNED'
  | 'REASSIGNED'
  | 'UNASSIGNED'
  | 'DISPATCHED'
  | 'FAILED'
  | 'REDELIVERY_REQUESTED'
  | 'COMPLETED'
  | 'NOTES_UPDATED'
  | 'CANCELLED';

// A person as the history resolves it; `name` is null when the user no longer resolves.
export interface HistoryPerson {
  id: string;
  name: string | null;
}

export interface DeliveryHistoryEvent {
  id: string;
  kind: DeliveryHistoryKind;
  at: string;
  attempt: number | null;
  reason: string | null;
  actor: HistoryPerson | null;
  courier: HistoryPerson | null;
  previousCourier: HistoryPerson | null;
}

export const deliveryApi = {
  list: (token: string, branchId: string, filters: DeliveryFilters) => {
    const params = new URLSearchParams({ branchId });
    if (filters.status) params.set('status', filters.status);
    if (filters.orderStatus) params.set('orderStatus', filters.orderStatus);
    if (filters.search) params.set('search', filters.search);
    if (filters.dateFrom) params.set('dateFrom', filters.dateFrom);
    if (filters.dateTo) params.set('dateTo', filters.dateTo);
    if (filters.courier) params.set('courier', filters.courier);
    if (filters.page) params.set('page', String(filters.page));
    return apiFetch<DeliveryPage>(`/delivery?${params.toString()}`, { accessToken: token });
  },
  dispatch: (token: string, id: string) =>
    apiFetch<DeliveryActionResult>(`/delivery/${id}/dispatch`, { method: 'POST', accessToken: token }),
  complete: (token: string, id: string) =>
    apiFetch<DeliveryActionResult>(`/delivery/${id}/complete`, { method: 'POST', accessToken: token }),
  fail: (token: string, id: string, reason: string) =>
    apiFetch<DeliveryActionResult>(`/delivery/${id}/fail`, { method: 'POST', body: { reason }, accessToken: token }),
  redeliver: (token: string, id: string) =>
    apiFetch<DeliveryActionResult>(`/delivery/${id}/redeliver`, { method: 'POST', accessToken: token }),
  updateNotes: (token: string, id: string, notes: string | null) =>
    apiFetch<DeliveryActionResult>(`/delivery/${id}/notes`, { method: 'PATCH', body: { notes }, accessToken: token }),
  assignCourier: (token: string, id: string, courierUserId: string) =>
    apiFetch<DeliveryActionResult>(`/delivery/${id}/courier`, { method: 'PUT', body: { courierUserId }, accessToken: token }),
  unassignCourier: (token: string, id: string) =>
    apiFetch<DeliveryActionResult>(`/delivery/${id}/courier`, { method: 'DELETE', accessToken: token }),
  listCouriers: (token: string, branchId: string) =>
    apiFetch<{ data: CourierOption[] }>(`/delivery/couriers?branchId=${encodeURIComponent(branchId)}`, { accessToken: token }),
  history: (token: string, id: string) =>
    apiFetch<{ data: DeliveryHistoryEvent[] }>(`/delivery/${id}/history`, { accessToken: token }),
  getSettings: (token: string, branchId: string) =>
    apiFetch<DeliverySettings>(`/delivery/settings?branchId=${encodeURIComponent(branchId)}`, { accessToken: token }),
  updateSettings: (token: string, settings: DeliverySettings) =>
    apiFetch<DeliverySettings>('/delivery/settings', { method: 'PUT', body: settings, accessToken: token }),
};
