import { apiFetch } from './api-client';

export type FulfillmentType = 'DELIVERY' | 'PICKUP';
export type PaymentMethod = 'CASH' | 'PIX' | 'CARD';

export interface CheckoutAddressInput {
  street: string;
  number: string;
  complement?: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
}

// Deliberately minimal: ONLY productId + quantity per item. Price, name and
// subtotal are never sent as authority — the backend re-reads them from the
// database. See docs/PROJECT_STATUS.md "Fatia 04" and
// apps/api/.../public-orders.service.ts for the enforcement side of this.
export interface CreateOrderInput {
  restaurantSlug: string;
  items: { productId: string; quantity: number }[];
  customer: { name: string; phone: string };
  fulfillmentType: FulfillmentType;
  address?: CheckoutAddressInput;
  paymentMethod: PaymentMethod;
  notes?: string;
  idempotencyKey?: string;
}

export interface OrderItemResponse {
  productId: string;
  name: string;
  unitPrice: number;
  quantity: number;
  subtotal: number;
}

// Returned ONLY by createOrder(), synchronously, to the browser that just
// submitted customer.name/customer.phone — the same trust boundary as any
// form echoing back what you just typed.
export interface OrderResponse {
  id: string;
  orderNumber: string;
  status: string;
  customerName: string;
  customerPhone: string;
  fulfillmentType: FulfillmentType;
  address: CheckoutAddressInput | null;
  paymentMethod: PaymentMethod;
  notes: string | null;
  items: OrderItemResponse[];
  subtotal: number;
  total: number;
  createdAt: string;
}

// Returned by getOrder() — the confirmation page, reachable by anyone with
// the order id (no auth, no secret token yet). Deliberately missing
// customerName/customerPhone; mirrors the backend's PublicOrderConfirmationDto
// exactly. Delivery address stays, since the confirmation page's job is to
// confirm it back to the customer.
export type PublicOrderConfirmation = Omit<OrderResponse, 'customerName' | 'customerPhone'>;

export function createOrder(input: CreateOrderInput): Promise<OrderResponse> {
  return apiFetch<OrderResponse>('/public/orders', { method: 'POST', body: input });
}

export function getOrder(slug: string, orderId: string): Promise<PublicOrderConfirmation> {
  return apiFetch<PublicOrderConfirmation>(
    `/public/orders/${encodeURIComponent(slug)}/${encodeURIComponent(orderId)}`,
  );
}
