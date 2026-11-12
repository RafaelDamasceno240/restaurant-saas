import { daysBetween } from '../../common/util/timezone.util';

// Pure rules of receivables (fiado): integer cents and calendar days, no I/O. The ONE definition
// of how a debt is split, how a payment is spread over installments and when one is overdue.

export const MAX_RECEIVABLE_CENTS = 2_000_000_000;

export interface InstallmentState {
  id: string;
  number: number;
  dueDate: string;
  amountCents: number;
  paidCents: number;
}

export interface Allocation {
  installmentId: string;
  amountCents: number;
}

export const openCentsOf = (installment: Pick<InstallmentState, 'amountCents' | 'paidCents'>) =>
  installment.amountCents - installment.paidCents;

// Spreads a payment over the installments that still owe something: the one that is due
// first is paid first (then by number), each up to what it still owes. With `onlyInstallmentId`
// the whole payment goes to that installment. Returns null when the amount does not fit
// (more than what is open) - a payment is never accepted beyond the debt.
export function allocatePayment(installments: InstallmentState[], amountCents: number, onlyInstallmentId?: string): Allocation[] | null {
  if (!Number.isInteger(amountCents) || amountCents < 1) return null;
  const candidates = installments
    .filter((installment) => openCentsOf(installment) > 0 && (!onlyInstallmentId || installment.id === onlyInstallmentId))
    .sort((a, b) => (a.dueDate === b.dueDate ? a.number - b.number : a.dueDate < b.dueDate ? -1 : 1));

  const allocations: Allocation[] = [];
  let remaining = amountCents;
  for (const installment of candidates) {
    if (remaining === 0) break;
    const part = Math.min(remaining, openCentsOf(installment));
    allocations.push({ installmentId: installment.id, amountCents: part });
    remaining -= part;
  }
  return remaining === 0 ? allocations : null;
}

// Overdue = still owes something and its due date is BEFORE today (due today is not late).
export function isInstallmentOverdue(installment: Pick<InstallmentState, 'dueDate' | 'amountCents' | 'paidCents'>, today: string): boolean {
  return openCentsOf(installment) > 0 && installment.dueDate < today;
}

export interface ReceivableSummary {
  openCents: number;
  overdueCents: number;
  // Earliest due date among the installments that still owe something.
  nextDueDate: string | null;
  // How many days the oldest unpaid installment is late (0 when nothing is overdue).
  daysOverdue: number;
}

export function summarizeInstallments(installments: InstallmentState[], today: string): ReceivableSummary {
  let openCents = 0;
  let overdueCents = 0;
  let nextDueDate: string | null = null;
  for (const installment of installments) {
    const open = openCentsOf(installment);
    if (open <= 0) continue;
    openCents += open;
    if (installment.dueDate < today) overdueCents += open;
    if (nextDueDate === null || installment.dueDate < nextDueDate) nextDueDate = installment.dueDate;
  }
  const daysOverdue = nextDueDate !== null && nextDueDate < today ? daysBetween(nextDueDate, today) : 0;
  return { openCents, overdueCents, nextDueDate, daysOverdue };
}

