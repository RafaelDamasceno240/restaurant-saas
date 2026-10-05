import { apiFetch } from './api-client';

// Fiado / contas a receber. Money is integer cents; dates of installments are calendar days
// ('YYYY-MM-DD') in the restaurant's time zone. Limits, what is overdue and what a payment
// settles are all decided by the API: nothing here is computed on the client.

export type ReceivableStatus = 'OPEN' | 'PAID' | 'CANCELLED';
export type ReceivableStatusFilter = 'open' | 'overdue' | 'paid' | 'cancelled' | 'all';
// Real money only: a debt is never paid "on account".
export type ReceivablePaymentMethod = 'CASH' | 'PIX' | 'CARD';
export type ReceivableEntryType = 'CHARGE' | 'PAYMENT' | 'REVERSAL';

export interface CreditAccount {
  customerId: string;
  // 0 = this customer does not buy on account.
  creditLimitCents: number;
  // What the customer owes now.
  balanceCents: number;
  availableCents: number;
  overdueCents: number;
  canBuyOnAccount: boolean;
}

export interface ReceivableInstallment {
  id: string;
  number: number;
  dueDate: string;
  amountCents: number;
  paidCents: number;
  openCents: number;
  overdue: boolean;
}

export interface Receivable {
  id: string;
  description: string;
  status: ReceivableStatus;
  totalCents: number;
  paidCents: number;
  openCents: number;
  overdueCents: number;
  overdue: boolean;
  daysOverdue: number;
  nextDueDate: string | null;
  customer: { id: string; name: string; phone: string };
  branch: { id: string; name: string };
  order: { id: string; orderNumber: string } | null;
  createdAt: string;
  settledAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  installments: ReceivableInstallment[];
}

export interface ReceivableEntry {
  id: string;
  type: ReceivableEntryType;
  // Signed, from the debt's point of view: a charge adds, a payment subtracts.
  amountCents: number;
  balanceAfterCents: number;
  paymentMethod: ReceivablePaymentMethod | null;
  reason: string | null;
  reversedEntryId: string | null;
  reversed: boolean;
  allocations: { installmentNumber: number; amountCents: number }[];
  createdBy: { id: string; name: string } | null;
  createdAt: string;
}

export interface ReceivableDetail extends Receivable {
  entries: ReceivableEntry[];
  // The restaurant's calendar day the "overdue" flags were computed for.
  today: string;
  // Present on the answer of a write.
  entryId?: string;
  idempotentReplay?: boolean;
}

export interface ReceivablesSummary {
  openCents: number;
  openCount: number;
  overdueCents: number;
  overdueCount: number;
  customersInDebt: number;
}

export interface ReceivablesPage {
  data: Receivable[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  summary: ReceivablesSummary;
  today: string;
}

export interface CreditTerms {
  installments: number;
  firstDueDate: string;
}

export interface ListReceivablesParams {
  status?: ReceivableStatusFilter;
  customerId?: string;
  branchId?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

function toQuery(params: ListReceivablesParams): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(name, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

export const receivablesApi = {
  list: (token: string, params: ListReceivablesParams = {}) =>
    apiFetch<ReceivablesPage>(`/receivables${toQuery(params)}`, { accessToken: token }),
  get: (token: string, id: string) => apiFetch<ReceivableDetail>(`/receivables/${id}`, { accessToken: token }),

  getAccount: (token: string, customerId: string) =>
    apiFetch<CreditAccount>(`/receivables/customers/${customerId}`, { accessToken: token }),
  setLimit: (token: string, customerId: string, creditLimitCents: number) =>
    apiFetch<CreditAccount>(`/receivables/customers/${customerId}/limit`, {
      method: 'PUT',
      body: { creditLimitCents },
      accessToken: token,
    }),

  create: (
    token: string,
    input: { customerId: string; branchId: string; description: string; totalCents: number; idempotencyKey: string } & CreditTerms,
  ) => apiFetch<ReceivableDetail>('/receivables', { method: 'POST', body: input, accessToken: token }),

  pay: (
    token: string,
    id: string,
    input: { amountCents: number; method: ReceivablePaymentMethod; branchId: string; installmentId?: string; idempotencyKey: string },
  ) => apiFetch<ReceivableDetail>(`/receivables/${id}/payments`, { method: 'POST', body: input, accessToken: token }),

  reversePayment: (token: string, entryId: string, input: { reason: string; branchId?: string; idempotencyKey: string }) =>
    apiFetch<ReceivableDetail>(`/receivables/entries/${entryId}/reverse`, { method: 'POST', body: input, accessToken: token }),

  cancel: (token: string, id: string, reason: string) =>
    apiFetch<ReceivableDetail>(`/receivables/${id}/cancel`, { method: 'POST', body: { reason }, accessToken: token }),
};
