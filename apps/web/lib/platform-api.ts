import { apiFetch } from './api-client';

// /v1/platform: the administration of the platform (every restaurant). The API lets in only a
// platform administrator (PlatformAdminGuard); these calls are made only from /super-admin.

export type TenantStatus = 'ACTIVE' | 'TRIAL' | 'SUSPENDED' | 'CANCELLED';

export interface PlatformOverview {
  total: number;
  byStatus: Record<TenantStatus, number>;
}

export interface PlatformTenantRow {
  id: string;
  name: string;
  slug: string;
  status: TenantStatus;
  createdAt: string;
  branchCount: number;
  ownerEmail: string | null;
}

export interface PlatformTenantPage {
  items: PlatformTenantRow[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export interface PlatformHistoryEntry {
  action: string;
  at: string;
  by: { name: string; email: string } | null;
  reason: string | null;
}

export interface PlatformTenantDetail {
  id: string;
  name: string;
  legalName: string;
  document: string;
  slug: string;
  status: TenantStatus;
  timezone: string;
  createdAt: string;
  updatedAt: string;
  branches: { id: string; name: string; code: string; status: string; deliveryEnabled: boolean }[];
  mainBranchDeliveryEnabled: boolean | null;
  owners: { id: string; name: string; email: string; status: string }[];
  userCount: number;
  suspension: PlatformHistoryEntry | null;
  history: PlatformHistoryEntry[];
}

export interface NewTenantInput {
  tenantName: string;
  legalName: string;
  document: string;
  slug: string;
  branchName: string;
  userName: string;
  email: string;
  password: string;
}

export const platformApi = {
  overview: (accessToken: string) => apiFetch<PlatformOverview>('/platform/overview', { accessToken }),
  list: (accessToken: string, query: { search?: string; page?: number; pageSize?: number }) => {
    const params = new URLSearchParams();
    if (query.search) params.set('search', query.search);
    if (query.page && query.page > 1) params.set('page', String(query.page));
    if (query.pageSize) params.set('pageSize', String(query.pageSize));
    const qs = params.toString();
    return apiFetch<PlatformTenantPage>(`/platform/tenants${qs ? `?${qs}` : ''}`, { accessToken });
  },
  detail: (accessToken: string, id: string) =>
    apiFetch<PlatformTenantDetail>(`/platform/tenants/${encodeURIComponent(id)}`, { accessToken }),
  create: (accessToken: string, input: NewTenantInput) =>
    apiFetch<PlatformTenantDetail>('/platform/tenants', { method: 'POST', body: input, accessToken }),
  suspend: (accessToken: string, id: string, reason: string) =>
    apiFetch<PlatformTenantDetail>(`/platform/tenants/${encodeURIComponent(id)}/suspend`, {
      method: 'POST',
      body: { reason },
      accessToken,
    }),
  reactivate: (accessToken: string, id: string) =>
    apiFetch<PlatformTenantDetail>(`/platform/tenants/${encodeURIComponent(id)}/reactivate`, {
      method: 'POST',
      accessToken,
    }),
};
