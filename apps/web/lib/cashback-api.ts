import { apiFetch } from './api-client';

// Money is integer cents on this API. Every amount is decided or validated by the backend: what
// an order gives back, and whether the balance covers what a sale wants to spend.

export interface CashbackProgram {
  enabled: boolean;
  // Basis points of the items value actually paid: 500 = 5,00%.
  earnRateBps: number;
  // null = the balance never expires.
  expireAfterDays: number | null;
}

export interface CashbackAccount {
  customerId: string;
  // What can be spent now (an expired balance already counts as zero).
  balanceCents: number;
  // Past the expiration but not yet written off the ledger.
  expiredPendingCents: number;
  expiresAt: string | null;
  program: CashbackProgram;
}

export type CashbackEntryType = 'EARN' | 'USE' | 'ADJUSTMENT' | 'REVERSAL' | 'EXPIRATION';

export interface CashbackEntry {
  id: string;
  type: CashbackEntryType;
  // Signed cents: credit > 0, debit < 0.
  amountCents: number;
  balanceAfterCents: number;
  orderId: string | null;
  orderNumber: string | null;
  reason: string | null;
  reversedEntryId: string | null;
  reversed: boolean;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
  idempotentReplay?: boolean;
}

export interface CashbackEntriesPage {
  data: CashbackEntry[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
}

export const cashbackApi = {
  getProgram: (token: string) => apiFetch<CashbackProgram>('/cashback/program', { accessToken: token }),
  updateProgram: (token: string, input: CashbackProgram) =>
    apiFetch<CashbackProgram>('/cashback/program', { method: 'PUT', body: input, accessToken: token }),
  expireIdle: (token: string) =>
    apiFetch<{ expiredAccounts: number; expiredCents: number; moreToProcess: boolean }>('/cashback/expire', {
      method: 'POST',
      accessToken: token,
    }),

  getAccount: (token: string, customerId: string) =>
    apiFetch<CashbackAccount>(`/cashback/customers/${customerId}`, { accessToken: token }),
  listEntries: (token: string, customerId: string, page: number) =>
    apiFetch<CashbackEntriesPage>(`/cashback/customers/${customerId}/entries?page=${page}&pageSize=10`, { accessToken: token }),

  adjust: (token: string, customerId: string, input: { amountCents: number; reason: string; idempotencyKey: string }) =>
    apiFetch<CashbackEntry>(`/cashback/customers/${customerId}/adjust`, { method: 'POST', body: input, accessToken: token }),
  reverse: (token: string, entryId: string, input: { reason: string; idempotencyKey: string }) =>
    apiFetch<CashbackEntry>(`/cashback/entries/${entryId}/reverse`, { method: 'POST', body: input, accessToken: token }),
};
