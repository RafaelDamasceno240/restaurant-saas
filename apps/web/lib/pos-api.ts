import { apiFetch } from './api-client';
import { AdminOrderDetail } from './orders-api';
import { PaymentMethod } from './checkout-api';

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
