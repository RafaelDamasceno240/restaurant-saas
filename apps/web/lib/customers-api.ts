import { apiFetch } from './api-client';
import { OrderStatus } from './orders-api';

// Money is integer cents on this API (same convention as delivery and purchases).

export type CustomerStatusFilter = 'active' | 'inactive' | 'all';

// Derived by the API from the customer's billable orders (docs/CRM.md). NEW: first purchase in
// the last 30 days; RECURRING: 2+ purchases, the last one in the last 60 days; AT_RISK: no
// purchase for 61 to 180 days; LOST: never purchased or no purchase for more than 180 days.
export type CustomerSegment = 'NEW' | 'RECURRING' | 'AT_RISK' | 'LOST';
// spent = biggest spenders first; ticket = highest average ticket first.
export type CustomerSort = 'name' | 'spent' | 'ticket' | 'orders' | 'recent';

export interface CustomerListItem {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  active: boolean;
  createdAt: string;
  ordersCount: number;
  totalSpentCents: number;
  averageTicketCents: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
  segments: CustomerSegment[];
}

export interface CustomerSegmentSummary {
  // Active customers of the restaurant.
  total: number;
  segments: Record<CustomerSegment, number>;
}

export interface CustomerTopProduct {
  productId: string;
  name: string;
  quantity: number;
  // Value of the items at the price charged, before any order discount.
  totalCents: number;
  timesOrdered: number;
}

export interface CustomerPage {
  data: CustomerListItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  summary: { active: number; inactive: number };
}

export interface CustomerMetrics {
  ordersCount: number;
  cancelledCount: number;
  totalSpentCents: number;
  averageTicketCents: number;
  firstOrderAt: string | null;
  lastOrderAt: string | null;
}

export interface CustomerDetail {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  cpf: string | null;
  notes: string | null;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  metrics: CustomerMetrics;
  segments: CustomerSegment[];
  topProducts: CustomerTopProduct[];
}

// What create/update return (no metrics).
export type CustomerRecord = Omit<CustomerDetail, 'metrics' | 'segments' | 'topProducts'>;

export interface CustomerInput {
  name?: string;
  phone?: string;
  email?: string | null;
  cpf?: string | null;
  notes?: string | null;
  active?: boolean;
}

export interface CustomerOrderItem {
  id: string;
  orderNumber: string;
  status: OrderStatus;
  // false for cancelled orders: they are listed but not part of the metrics
  counted: boolean;
  source: string;
  fulfillmentType: string;
  paymentMethod: 'CASH' | 'PIX' | 'CARD' | 'ON_ACCOUNT';
  totalCents: number;
  itemCount: number;
  branch: { id: string; name: string };
  createdAt: string;
}

export interface CustomerOrdersPage {
  data: CustomerOrderItem[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface CustomerFilters {
  search?: string;
  status?: CustomerStatusFilter;
  segment?: CustomerSegment;
  sort?: CustomerSort;
  page?: number;
  pageSize?: number;
}

export const customersApi = {
  list: (token: string, filters: CustomerFilters) => {
    const params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.status) params.set('status', filters.status);
    if (filters.segment) params.set('segment', filters.segment);
    if (filters.sort && filters.sort !== 'name') params.set('sort', filters.sort);
    if (filters.page) params.set('page', String(filters.page));
    if (filters.pageSize) params.set('pageSize', String(filters.pageSize));
    const query = params.toString();
    return apiFetch<CustomerPage>(`/customers${query ? `?${query}` : ''}`, { accessToken: token });
  },
  segments: (token: string) => apiFetch<CustomerSegmentSummary>('/customers/segments', { accessToken: token }),
  get: (token: string, id: string) => apiFetch<CustomerDetail>(`/customers/${id}`, { accessToken: token }),
  orders: (token: string, id: string, page: number) =>
    apiFetch<CustomerOrdersPage>(`/customers/${id}/orders?page=${page}`, { accessToken: token }),
  create: (token: string, input: CustomerInput) =>
    apiFetch<CustomerRecord>('/customers', { method: 'POST', body: input, accessToken: token }),
  update: (token: string, id: string, input: CustomerInput) =>
    apiFetch<CustomerRecord>(`/customers/${id}`, { method: 'PATCH', body: input, accessToken: token }),
};
