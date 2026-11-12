import { apiFetch } from './api-client';
import { AdminOrderDetail } from './orders-api';
import { StaffPaymentMethod } from './checkout-api';
import type { CreditTerms } from './receivables-api';
import type { CouponPreview } from './coupons-api';
import type { ItemsQuote } from './staff-addons';

// Deliberately minimal — only productId + quantity per item, exactly what
// the backend's CreatePosOrderDto accepts. No price, no name, no subtotal,
// no total: those are always recalculated server-side. No fulfillmentType
// or address either — a counter sale is always PICKUP internally, set by
// the backend, never chosen here.
// One line: the product, how many, the add-ons of EACH unit (ids and quantities) and the note.
export interface PosOrderLine {
  productId: string;
  quantity: number;
  options?: { optionId: string; quantity: number }[];
  notes?: string;
}

export interface CreatePosOrderInput {
  // Fatia 08: operating branch — re-validated by the backend on every call.
  branchId: string;
  items: PosOrderLine[];
  customerName?: string;
  customerPhone?: string;
  // A customer of the registry (needs customers.read). Only the id travels; when no name or
  // phone is typed, the server copies them from the registry into the order.
  customerId?: string;
  // Cents of that customer's cashback balance to spend on this sale (needs cashback.use). The
  // server checks it against the real balance and against what the items cost.
  cashbackToUseCents?: number;
  paymentMethod: StaffPaymentMethod;
  // Only with paymentMethod ON_ACCOUNT (needs receivables.sell and a customerId): how the debt
  // will be paid back. The server checks the customer's limit and builds the installments.
  creditTerms?: CreditTerms;
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
  input: { branchId: string; items: PosOrderLine[]; code: string; customerId?: string },
): Promise<CouponPreview> {
  return apiFetch<CouponPreview>('/pos/orders/coupon-preview', { method: 'POST', body: input, accessToken });
}

// Read-only: what these lines cost right now, add-ons included, priced by the server (pos.create).
export function quotePosItems(accessToken: string, items: PosOrderLine[]): Promise<ItemsQuote> {
  return apiFetch<ItemsQuote>('/pos/orders/quote', { method: 'POST', body: { items }, accessToken });
}
