import { apiFetch } from './api-client';

// All money in the cash module travels as INTEGER CENTS, both ways. Expected
// balance and difference are always computed by the backend.
export type CashMovementType = 'SALE' | 'SUPPLY' | 'WITHDRAWAL';

export interface CashMovement {
  id: string;
  type: CashMovementType;
  amountCents: number;
  reason: string | null;
  orderId: string | null;
  orderNumber: string | null;
  createdBy: { id: string; name: string };
  createdAt: string;
}

export interface CashSession {
  id: string;
  branchId: string;
  branchName: string;
  status: 'OPEN' | 'CLOSED';
  openingBalanceCents: number;
  totals: { salesCents: number; suppliesCents: number; withdrawalsCents: number };
  expectedBalanceCents: number | null;
  countedClosingBalanceCents: number | null;
  differenceCents: number | null;
  openedBy: { id: string; name: string };
  closedBy: { id: string; name: string } | null;
  openedAt: string;
  closedAt: string | null;
  notes: string | null;
  movements: CashMovement[];
}

export function getCurrentSession(token: string, branchId: string) {
  return apiFetch<{ session: CashSession | null }>(
    `/cash/sessions/current?branchId=${encodeURIComponent(branchId)}`,
    { accessToken: token },
  );
}

export function openSession(token: string, branchId: string, openingBalanceCents: number) {
  return apiFetch<CashSession>('/cash/sessions', {
    method: 'POST',
    body: { branchId, openingBalanceCents },
    accessToken: token,
  });
}

export function addMovement(
  token: string,
  sessionId: string,
  input: { type: 'SUPPLY' | 'WITHDRAWAL'; amountCents: number; reason?: string },
) {
  return apiFetch<CashSession>(`/cash/sessions/${sessionId}/movements`, {
    method: 'POST',
    body: input,
    accessToken: token,
  });
}

export function closeSession(token: string, sessionId: string, countedClosingBalanceCents: number) {
  return apiFetch<CashSession>(`/cash/sessions/${sessionId}/close`, {
    method: 'PATCH',
    body: { countedClosingBalanceCents },
    accessToken: token,
  });
}

// "10,50" / "10.50" / "10" -> 1050. Returns null for invalid input. String
// parsing (not float math) so "0,1" + "0,2" style errors never happen.
export function parseBRLToCents(input: string): number | null {
  const normalized = input.trim().replace(/\s/g, '').replace(/^R\$/i, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return null;
  const [intPart, decPart = ''] = normalized.split('.');
  return Number(intPart) * 100 + Number(decPart.padEnd(2, '0'));
}

export function formatCents(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '—';
  const sign = cents < 0 ? '-' : '';
  return `${sign}R$ ${(Math.abs(cents) / 100).toFixed(2).replace('.', ',')}`;
}
