import { apiFetch } from './api-client';
import { OrderStatus } from './orders-api';

// Money is integer cents on this API (same convention as delivery and purchases).

export type CustomerStatusFilter = 'active' | 'inactive' | 'all';

export interface CustomerListItem {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  active: boolean;
  createdAt: string;
  ordersCount: number;
  totalSpentCents: number;
  lastOrderAt: string | null;
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
}

// What create/update return (no metrics).
export type CustomerRecord = Omit<CustomerDetail, 'metrics'>;

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
  paymentMethod: 'CASH' | 'PIX' | 'CARD';
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
  page?: number;
}

export const customersApi = {
  list: (token: string, filters: CustomerFilters) => {
    const params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.status) params.set('status', filters.status);
    if (filters.page) params.set('page', String(filters.page));
    const query = params.toString();
    return apiFetch<CustomerPage>(`/customers${query ? `?${query}` : ''}`, { accessToken: token });
  },
  get: (token: string, id: string) => apiFetch<CustomerDetail>(`/customers/${id}`, { accessToken: token }),
  orders: (token: string, id: string, page: number) =>
    apiFetch<CustomerOrdersPage>(`/customers/${id}/orders?page=${page}`, { accessToken: token }),
  create: (token: string, input: CustomerInput) =>
    apiFetch<CustomerRecord>('/customers', { method: 'POST', body: input, accessToken: token }),
  update: (token: string, id: string, input: CustomerInput) =>
    apiFetch<CustomerRecord>(`/customers/${id}`, { method: 'PATCH', body: input, accessToken: token }),
};
