import { apiFetch } from './api-client';

// Points are whole numbers. Every amount is decided by the backend (the order for a credit, the
// reward for a redemption); the only number a screen sends is a manual adjustment, which has
// its own permission.

export interface LoyaltyProgram {
  enabled: boolean;
  // Points for each whole R$ 1,00 paid for the items of a concluded order.
  pointsPerReal: number;
}

export interface LoyaltyReward {
  id: string;
  name: string;
  description: string | null;
  pointsCost: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface LoyaltyAccount {
  customerId: string;
  balancePoints: number;
  program: LoyaltyProgram;
}

export type LoyaltyEntryType = 'EARN' | 'REDEEM' | 'ADJUSTMENT' | 'REVERSAL';

export interface LoyaltyEntry {
  id: string;
  type: LoyaltyEntryType;
  // Signed: credit > 0, debit < 0.
  points: number;
  balanceAfter: number;
  orderId: string | null;
  orderNumber: string | null;
  reward: { id: string; name: string } | null;
  reason: string | null;
  reversedEntryId: string | null;
  // true when another entry undid this one.
  reversed: boolean;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  idempotentReplay?: boolean;
}

export interface LoyaltyEntriesPage {
  data: LoyaltyEntry[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export type RewardStatusFilter = 'active' | 'inactive' | 'all';

export const loyaltyApi = {
  getProgram: (token: string) => apiFetch<LoyaltyProgram>('/loyalty/program', { accessToken: token }),
  updateProgram: (token: string, input: LoyaltyProgram) =>
    apiFetch<LoyaltyProgram>('/loyalty/program', { method: 'PUT', body: input, accessToken: token }),

  listRewards: (token: string, status: RewardStatusFilter = 'active') =>
    apiFetch<{ data: LoyaltyReward[] }>(`/loyalty/rewards?status=${status}`, { accessToken: token }),
  createReward: (token: string, input: { name: string; description?: string | null; pointsCost: number }) =>
    apiFetch<LoyaltyReward>('/loyalty/rewards', { method: 'POST', body: input, accessToken: token }),
  updateReward: (
    token: string,
    id: string,
    input: { name?: string; description?: string | null; pointsCost?: number; active?: boolean },
  ) => apiFetch<LoyaltyReward>(`/loyalty/rewards/${id}`, { method: 'PATCH', body: input, accessToken: token }),

  getAccount: (token: string, customerId: string) =>
    apiFetch<LoyaltyAccount>(`/loyalty/customers/${customerId}`, { accessToken: token }),
  listEntries: (token: string, customerId: string, page: number) =>
    apiFetch<LoyaltyEntriesPage>(`/loyalty/customers/${customerId}/entries?page=${page}&pageSize=10`, { accessToken: token }),

  // The idempotency key is generated once per attempt and re-sent on retries, so a repeated
  // click or a retried request never moves the balance twice.
  redeem: (token: string, customerId: string, input: { rewardId: string; branchId: string; idempotencyKey: string }) =>
    apiFetch<LoyaltyEntry>(`/loyalty/customers/${customerId}/redeem`, { method: 'POST', body: input, accessToken: token }),
  adjust: (token: string, customerId: string, input: { points: number; reason: string; idempotencyKey: string }) =>
    apiFetch<LoyaltyEntry>(`/loyalty/customers/${customerId}/adjust`, { method: 'POST', body: input, accessToken: token }),
  reverse: (token: string, entryId: string, input: { reason: string; idempotencyKey: string }) =>
    apiFetch<LoyaltyEntry>(`/loyalty/entries/${entryId}/reverse`, { method: 'POST', body: input, accessToken: token }),
};
