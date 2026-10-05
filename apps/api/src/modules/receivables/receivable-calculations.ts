import { addMonthsClamped, daysBetween, isValidDateOnly } from '../../common/util/timezone.util';

// Pure rules of receivables (fiado): integer cents and calendar days, no I/O. The ONE definition
// of how a debt is split, how a payment is spread over installments and when one is overdue.

export const MAX_INSTALLMENTS = 12;
// A receivable cannot be scheduled further than this from the day it is created.
export const MAX_FIRST_DUE_DAYS = 365;
export const MAX_RECEIVABLE_CENTS = 2_000_000_000;

export interface InstallmentPlanItem {
  number: number;
  // 'YYYY-MM-DD' in the restaurant's calendar.
  dueDate: string;
  amountCents: number;
}

// Equal parts in whole cents; the cents that do not divide go to the FIRST installments, one
// each, so the parts always add up to the total exactly (10,00 in 3 = 3,34 + 3,33 + 3,33).
export function splitAmount(totalCents: number, count: number): number[] {
  if (!Number.isInteger(totalCents) || !Number.isInteger(count) || count < 1 || totalCents < count) {
    throw new RangeError('cannot split this amount in that many installments');
  }
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

// Monthly installments from the first due date, each on the same day of the month (clamped to
// the month's last day, always counted from the first date).
export function buildInstallmentPlan(totalCents: number, count: number, firstDueDate: string): InstallmentPlanItem[] {
  if (!isValidDateOnly(firstDueDate)) throw new RangeError('invalid first due date');
  return splitAmount(totalCents, count).map((amountCents, index) => ({
    number: index + 1,
    dueDate: addMonthsClamped(firstDueDate, index),
    amountCents,
  }));
}

export type TermsProblem = 'INSTALLMENTS_RANGE' | 'DUE_DATE_INVALID' | 'DUE_DATE_PAST' | 'DUE_DATE_TOO_FAR' | 'AMOUNT_TOO_SMALL';

// What can be wrong with the terms of a debt, checked against the restaurant's "today".
export function validateTerms(input: { totalCents: number; installments: number; firstDueDate: string; today: string }): TermsProblem | null {
  const { totalCents, installments, firstDueDate, today } = input;
  if (!Number.isInteger(installments) || installments < 1 || installments > MAX_INSTALLMENTS) return 'INSTALLMENTS_RANGE';
  if (!isValidDateOnly(firstDueDate)) return 'DUE_DATE_INVALID';
  const days = daysBetween(today, firstDueDate);
  if (days < 0) return 'DUE_DATE_PAST';
  if (days > MAX_FIRST_DUE_DAYS) return 'DUE_DATE_TOO_FAR';
  // Every installment must be worth at least one cent.
  if (!Number.isInteger(totalCents) || totalCents < installments) return 'AMOUNT_TOO_SMALL';
  return null;
}

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

// How much more the customer may buy on account: never negative.
export function availableCreditCents(creditLimitCents: number, balanceCents: number): number {
  return Math.max(0, creditLimitCents - balanceCents);
}
