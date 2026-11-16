import { apiFetch } from './api-client';

export type StaffRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'CASHIER' | 'WAITER' | 'KITCHEN' | 'DELIVERY' | 'VIEWER';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'BLOCKED' | 'INVITED';

export interface StaffUser {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  status: UserStatus;
  lastLoginAt: string | null;
  createdAt: string;
  roles: StaffRole[];
  branchIds: string[];
}

export interface CreateUserInput {
  name: string;
  email: string;
  password: string;
  role: StaffRole;
  branchIds?: string[];
}

export interface UpdateUserInput {
  name?: string;
  role?: StaffRole;
  branchIds?: string[];
  active?: boolean;
}

export const usersApi = {
  list: (accessToken: string) => apiFetch<StaffUser[]>('/users', { accessToken }),
  create: (accessToken: string, input: CreateUserInput) =>
    apiFetch<StaffUser>('/users', { method: 'POST', body: input, accessToken }),
  update: (accessToken: string, id: string, input: UpdateUserInput) =>
    apiFetch<StaffUser>(`/users/${id}`, { method: 'PATCH', body: input, accessToken }),
  resetPassword: (accessToken: string, id: string, password: string) =>
    apiFetch<void>(`/users/${id}/reset-password`, { method: 'POST', body: { password }, accessToken }),
  // Ends every session of the account, this one included: the caller signs in again.
  changeOwnPassword: (accessToken: string, currentPassword: string, newPassword: string) =>
    apiFetch<void>('/auth/change-password', {
      method: 'POST',
      body: { currentPassword, newPassword },
      accessToken,
    }),
};
