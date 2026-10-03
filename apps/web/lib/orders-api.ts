import { apiFetch } from './api-client';
import { CheckoutAddressInput, FulfillmentType, PaymentMethod } from './checkout-api';

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
  fulfillmentType: AdminFulfillmentType;
  paymentMethod: PaymentMethod;
  notes: string | null;
  subtotal: number;
  // Coupon discount over the items subtotal (0 without coupon); total = subtotal - discount + deliveryFee.
  discount: number;
  couponCode: string | null;
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
  fulfillmentType: AdminFulfillmentType;
  address: CheckoutAddressInput | null;
  paymentMethod: PaymentMethod;
  notes: string | null;
  items: AdminOrderItem[];
  subtotal: number;
  // Coupon discount over the items subtotal (0 without coupon); total = subtotal - discount + deliveryFee.
  discount: number;
  couponCode: string | null;
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

export function getOrderDetail(accessToken: string, id: string): Promise<AdminOrderDetail> {
  return apiFetch<AdminOrderDetail>(`/orders/${id}`, { accessToken });
}

export function updateOrderStatus(
  accessToken: string,
  id: string,
  status: OrderStatus,
): Promise<AdminOrderDetail> {
  return apiFetch<AdminOrderDetail>(`/orders/${id}/status`, {
    method: 'PATCH',
    body: { status },
    accessToken,
  });
}
