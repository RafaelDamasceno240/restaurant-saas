import { apiFetch } from './api-client';

// Money is integer cents on this API (same convention as delivery, purchases and customers).
// Every rule is decided by the backend; this module only carries data.

export type CouponDiscountType = 'PERCENTAGE' | 'FIXED';
export type CouponStatusFilter = 'active' | 'inactive' | 'all';
export type CouponAvailability = 'INACTIVE' | 'SCHEDULED' | 'EXPIRED' | 'EXHAUSTED' | 'AVAILABLE';

export interface Coupon {
  id: string;
  code: string;
  description: string | null;
  discountType: CouponDiscountType;
  // PERCENTAGE: whole percent (1-100). FIXED: cents.
  value: number;
  minOrderCents: number;
  maxDiscountCents: number | null;
  startsAt: string | null;
  endsAt: string | null;
  active: boolean;
  availability: CouponAvailability;
  usageLimit: number | null;
  usageCount: number;
  perCustomerLimit: number | null;
  branch: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface CouponPage {
  data: Coupon[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  summary: { active: number; inactive: number };
}

export interface CouponFilters {
  search?: string;
  status?: CouponStatusFilter;
  page?: number;
}

// What create sends. The code, the branch and the activation are fixed at creation / have their
// own endpoints, so PATCH (CouponUpdateInput) cannot carry them.
export interface CouponCreateInput {
  code: string;
  description?: string | null;
  discountType: CouponDiscountType;
  value: number;
  minOrderCents?: number;
  maxDiscountCents?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
  branchId?: string | null;
}

export type CouponUpdateInput = Partial<Omit<CouponCreateInput, 'code' | 'branchId'>>;

// Read-only preview answer (PDV and public checkout share the shape).
export interface CouponPreview {
  code: string;
  discountType: CouponDiscountType;
  subtotalCents: number;
  discountCents: number;
  subtotalAfterDiscountCents: number;
}

export const couponsApi = {
  list: (token: string, filters: CouponFilters) => {
    const params = new URLSearchParams();
    if (filters.search) params.set('search', filters.search);
    if (filters.status) params.set('status', filters.status);
    if (filters.page) params.set('page', String(filters.page));
    const query = params.toString();
    return apiFetch<CouponPage>(`/coupons${query ? `?${query}` : ''}`, { accessToken: token });
  },
  create: (token: string, input: CouponCreateInput) =>
    apiFetch<Coupon>('/coupons', { method: 'POST', body: input, accessToken: token }),
  update: (token: string, id: string, input: CouponUpdateInput) =>
    apiFetch<Coupon>(`/coupons/${id}`, { method: 'PATCH', body: input, accessToken: token }),
  activate: (token: string, id: string) =>
    apiFetch<Coupon>(`/coupons/${id}/activate`, { method: 'POST', accessToken: token }),
  deactivate: (token: string, id: string) =>
    apiFetch<Coupon>(`/coupons/${id}/deactivate`, { method: 'POST', accessToken: token }),
};
