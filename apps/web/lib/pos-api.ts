import { apiFetch } from './api-client';
import { AdminOrderDetail } from './orders-api';
import { PaymentMethod } from './checkout-api';
import type { CouponPreview } from './coupons-api';

// Deliberately minimal — only productId + quantity per item, exactly what
// the backend's CreatePosOrderDto accepts. No price, no name, no subtotal,
// no total: those are always recalculated server-side. No fulfillmentType
// or address either — a counter sale is always PICKUP internally, set by
// the backend, never chosen here.
export interface CreatePosOrderInput {
  // Fatia 08: operating branch — re-validated by the backend on every call.
  branchId: string;
  items: { productId: string; quantity: number }[];
  customerName?: string;
  customerPhone?: string;
  paymentMethod: PaymentMethod;
  // Only the CODE travels (needs coupons.apply): the server decides everything about the discount.
  couponCode?: string;
  idempotencyKey?: string;
}

export function createPosOrder(
  accessToken: string,
  input: CreatePosOrderInput,
): Promise<AdminOrderDetail> {
  return apiFetch<AdminOrderDetail>('/pos/orders', {
    method: 'POST',
    body: input,
    accessToken,
  });
}

// Read-only preview for the current basket (needs coupons.apply). Prices are never sent.
export function previewPosCoupon(
  accessToken: string,
  input: { branchId: string; items: { productId: string; quantity: number }[]; code: string },
): Promise<CouponPreview> {
  return apiFetch<CouponPreview>('/pos/orders/coupon-preview', { method: 'POST', body: input, accessToken });
}
