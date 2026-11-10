import { apiFetch } from './api-client';
import { CheckoutAddressInput, FulfillmentType, StaffPaymentMethod } from './checkout-api';

export type OrderStatus =
  | 'PENDING'
  | 'CONFIRMED'
  | 'PREPARING'
  | 'READY'
  | 'OUT_FOR_DELIVERY'
  | 'DELIVERED'
  | 'COMPLETED'
  | 'CANCELLED';

// TABLE / DINE_IN added in fatia 10 (table checkout). Staff-facing only —
// the public checkout types in checkout-api.ts deliberately don't include them.
export type OrderSource = 'ONLINE' | 'COUNTER' | 'TABLE';
export type AdminFulfillmentType = FulfillmentType | 'DINE_IN';

export const ORDER_SOURCE_LABEL: Record<OrderSource, string> = {
  ONLINE: 'Online',
  COUNTER: 'Balcão',
  TABLE: 'Mesa',
};
export const FULFILLMENT_LABEL: Record<AdminFulfillmentType, string> = {
  DELIVERY: 'Entrega',
  PICKUP: 'Retirada',
  DINE_IN: 'Mesa',
};

// Authenticated, staff-facing shapes — unlike the public confirmation
// response, customerName/customerPhone ARE included here on purpose (staff
// need to be able to call the customer). See docs/PROJECT_STATUS.md
// "Fatia 05". Both are nullable as of fatia 07 — a COUNTER (PDV) sale can
// have no customer identification at all; ONLINE orders still always have
// both.
// Operational state of the order's delivery (null for PICKUP / DINE_IN). Kept apart
// from the commercial OrderStatus: only the Delivery screen moves it.
export interface AdminOrderDelivery {
  id: string;
  status: 'PENDING' | 'OUT_FOR_DELIVERY' | 'DELIVERED' | 'FAILED' | 'CANCELLED';
  // Delivery instructions ("Portão azul"), separate from the order's own `notes`.
  notes: string | null;
}

export interface AdminOrderListItem {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  source: OrderSource;
  branchId: string;
  customerName: string | null;
  customerPhone: string | null;
  // Link to the customer registry (null for guest orders); the registry data itself is read
  // through /customers, which has its own permission.
  customerId: string | null;
  fulfillmentType: AdminFulfillmentType;
  paymentMethod: StaffPaymentMethod;
  notes: string | null;
  subtotal: number;
  // Coupon discount over the items subtotal (0 without coupon); total = subtotal - discount + deliveryFee.
  discount: number;
  couponCode: string | null;
  // Cashback balance of the linked customer spent on the items (0 when none);
  // total = subtotal - discount - cashbackUsed + deliveryFee.
  cashbackUsed: number;
  deliveryFee: number;
  total: number;
  delivery: AdminOrderDelivery | null;
  itemCount: number;
  // Added in fatia 06 — the KDS needs items/quantities per card without an
  // extra request per order; the fatia 05 admin list page keeps using
  // itemCount and simply ignores this field.
  items: AdminOrderItem[];
  createdAt: string;
}

export interface AdminOrderListResponse {
  data: AdminOrderListItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface AdminOrderItem {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
}

export interface AdminOrderDetail {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  source: OrderSource;
  branchId: string;
  customerName: string | null;
  customerPhone: string | null;
  // Link to the customer registry (null for guest orders); the registry data itself is read
  // through /customers, which has its own permission.
  customerId: string | null;
  fulfillmentType: AdminFulfillmentType;
  address: CheckoutAddressInput | null;
  paymentMethod: StaffPaymentMethod;
  notes: string | null;
  items: AdminOrderItem[];
  subtotal: number;
  // Coupon discount over the items subtotal (0 without coupon); total = subtotal - discount + deliveryFee.
  discount: number;
  couponCode: string | null;
  // Cashback balance of the linked customer spent on the items (0 when none);
  // total = subtotal - discount - cashbackUsed + deliveryFee.
  cashbackUsed: number;
  deliveryFee: number;
  total: number;
  delivery: AdminOrderDelivery | null;
  createdAt: string;
}

export function listOrders(
  accessToken: string,
  params: { status?: OrderStatus; page?: number; pageSize?: number },
): Promise<AdminOrderListResponse> {
  const search = new URLSearchParams();
  if (params.status) search.set('status', params.status);
  if (params.page) search.set('page', String(params.page));
  if (params.pageSize) search.set('pageSize', String(params.pageSize));
  const qs = search.toString();
  return apiFetch<AdminOrderListResponse>(`/orders${qs ? `?${qs}` : ''}`, { accessToken });
}

// The kitchen board: the in-progress statuses, each with its newest orders (at most
// `columnLimit`) and its total, in ONE request. The kitchen screen polls this instead of asking
// for each status separately (lib/kds-logic.ts).
// B9: production status of a table item while the kitchen has it.
export type KitchenRoundStatus = 'SENT' | 'PREPARING' | 'READY';

// B9: one round sent from a table ("Mesa 4 · rodada 2") with only its items still to be made.
// `status` is the least advanced of them; the card's action moves exactly those.
export interface KitchenTableRound {
  id: string;
  tabId: string;
  roundNumber: number;
  tableNumber: number;
  tableName: string | null;
  sentAt: string;
  status: KitchenRoundStatus;
  items: { id: string; name: string; quantity: number; notes: string | null; status: KitchenRoundStatus }[];
}

export interface OrdersBoardColumn {
  status: OrderStatus;
  data: AdminOrderListItem[];
  total: number;
  // B9: table rounds in this stage (SENT ones in PENDING, "Novos"). Absent = none.
  tableRounds?: KitchenTableRound[];
  tableRoundsTotal?: number;
}

export interface OrdersBoard {
  columns: OrdersBoardColumn[];
  columnLimit: number;
}

export function getOrdersBoard(accessToken: string): Promise<OrdersBoard> {
  return apiFetch<OrdersBoard>('/orders/board', { accessToken });
}

// B9: the kitchen moves the items of a round that are in `from` (what its card shows) to `to`.
// 409 TAB_ROUND_ALREADY_MOVED when another screen (or a cancellation) got there first.
export function advanceKitchenRound(
  accessToken: string,
  roundId: string,
  from: KitchenRoundStatus,
  to: 'PREPARING' | 'READY' | 'SERVED',
): Promise<unknown> {
  return apiFetch(`/kitchen/tab-rounds/${roundId}/status`, { method: 'PATCH', body: { from, to }, accessToken });
}

export function getOrderDetail(accessToken: string, id: string): Promise<AdminOrderDetail> {
  return apiFetch<AdminOrderDetail>(`/orders/${id}`, { accessToken });
}

// A cancellation needs a reason (B5); the API refuses CANCELLED without one.
export function updateOrderStatus(
  accessToken: string,
  id: string,
  status: OrderStatus,
  reason?: string,
): Promise<AdminOrderDetail> {
  return apiFetch<AdminOrderDetail>(`/orders/${id}/status`, {
    method: 'PATCH',
    body: reason === undefined ? { status } : { status, reason },
    accessToken,
  });
}

// Customers of the registry whose phone is the one typed on the order (a hint, never an
// automatic attribution). Needs customers.read.
export function getOrderCustomerSuggestions(
  accessToken: string,
  id: string,
): Promise<{ data: { id: string; name: string; phone: string; active: boolean }[] }> {
  return apiFetch(`/orders/${id}/customer-suggestions`, { accessToken });
}

// Attaches the order to a customer of the registry, or removes the link (null). Only the id
// travels; the order's own name/phone snapshot is never changed.
export function setOrderCustomer(
  accessToken: string,
  id: string,
  customerId: string | null,
): Promise<AdminOrderDetail> {
  return apiFetch<AdminOrderDetail>(`/orders/${id}/customer`, {
    method: 'PATCH',
    body: { customerId },
    accessToken,
  });
}
