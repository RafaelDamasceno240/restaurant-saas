import { apiFetch } from './api-client';

export type TableStatus = 'AVAILABLE' | 'OCCUPIED';

export interface DiningTable {
  id: string;
  tenantId: string;
  branchId: string;
  number: number;
  name: string | null;
  active: boolean;
  // Derived by the backend from whether the table has an OPEN tab — never
  // stored, never computed here.
  status: TableStatus;
  openTabId: string | null;
  openTabTotalCents: number | null;
  openTabItemCount: number | null;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTableInput {
  branchId: string;
  number: number;
  name?: string;
  active?: boolean;
}

export interface UpdateTableInput {
  number?: number;
  name?: string;
  active?: boolean;
}

export const tablesApi = {
  list: (token: string, branchId: string) =>
    apiFetch<DiningTable[]>(`/tables?branchId=${branchId}`, { accessToken: token }),
  get: (token: string, id: string) => apiFetch<DiningTable>(`/tables/${id}`, { accessToken: token }),
  create: (token: string, input: CreateTableInput) =>
    apiFetch<DiningTable>('/tables', { method: 'POST', body: input, accessToken: token }),
  update: (token: string, id: string, input: UpdateTableInput) =>
    apiFetch<DiningTable>(`/tables/${id}`, { method: 'PATCH', body: input, accessToken: token }),
  remove: (token: string, id: string) =>
    apiFetch<void>(`/tables/${id}`, { method: 'DELETE', accessToken: token }),
};
