import type { BadgeTone } from '@/components/ds/Badge';
import { parseMoneyToCents } from './coupons-logic';
import type {
  CreditAccount,
  CreditTerms,
  Receivable,
  ReceivableEntry,
  ReceivableEntryType,
  ReceivablePaymentMethod,
  ReceivableStatusFilter,
} from './receivables-api';

// Presentation and form rules for fiado / contas a receber. The API is the authority (limit,
// overdue, what a payment settles); these give fast feedback and readable output only.

export const MAX_INSTALLMENTS = 12;
export const MAX_FIRST_DUE_DAYS = 365;
export const DEFAULT_DUE_IN_DAYS = 30;
// Same ceiling as the API (R$ 20.000.000,00).
export const MAX_RECEIVABLE_CENTS = 2_000_000_000;
export const MIN_REASON = 3;
export const MAX_REASON = 200;
export const MIN_DESCRIPTION = 2;
export const MAX_DESCRIPTION = 200;

export const RECEIVABLE_TABS: ReceivableStatusFilter[] = ['open', 'overdue', 'paid', 'cancelled', 'all'];
export const RECEIVABLE_TAB_LABEL: Record<ReceivableStatusFilter, string> = {
  open: 'Em aberto',
  overdue: 'Vencidas',
  paid: 'Quitadas',
  cancelled: 'Canceladas',
  all: 'Todas',
};

export const RECEIVABLE_PAYMENT_METHODS: ReceivablePaymentMethod[] = ['PIX', 'CASH', 'CARD'];
export const RECEIVABLE_METHOD_LABEL: Record<ReceivablePaymentMethod, string> = { CASH: 'Dinheiro', PIX: 'Pix', CARD: 'Cartão' };

export const RECEIVABLE_ENTRY_LABEL: Record<ReceivableEntryType, string> = {
  CHARGE: 'Lançamento',
  PAYMENT: 'Pagamento',
  REVERSAL: 'Estorno',
};
export const RECEIVABLE_ENTRY_TONE: Record<ReceivableEntryType, BadgeTone> = {
  CHARGE: 'info',
  PAYMENT: 'success',
  REVERSAL: 'warning',
};

export function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// ---- calendar days ('YYYY-MM-DD'), never through a time zone ---------------------------------

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateOnly(value: string): boolean {
  const match = DATE_ONLY.exec(value);
  if (!match) return false;
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  return date.toISOString().slice(0, 10) === value;
}

// '2026-11-05' -> '05/11/2026'. Pure text: a calendar day has no time zone to shift it.
export function formatDateOnly(value: string | null | undefined): string {
  const match = value ? DATE_ONLY.exec(value) : null;
  return match ? `${match[3]}/${match[2]}/${match[1]}` : '—';
}

// The calendar day on this device (what the date field shows by default).
export function localDateOnly(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function addDaysToDateOnly(value: string, days: number): string {
  const date = new Date(`${value}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Same day of the following months, clamped to the month's last day (31/01 -> 28/02 -> 31/03).
export function addMonthsToDateOnly(value: string, months: number): string {
  const [year, month, day] = value.split('-').map(Number);
  const target = new Date(Date.UTC(year, month - 1 + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

// ---- status ---------------------------------------------------------------------------------

export function receivableBadge(receivable: Pick<Receivable, 'status' | 'overdue' | 'daysOverdue'>): { label: string; tone: BadgeTone } {
  if (receivable.status === 'PAID') return { label: 'Quitada', tone: 'success' };
  if (receivable.status === 'CANCELLED') return { label: 'Cancelada', tone: 'neutral' };
  if (receivable.overdue) {
    const days = receivable.daysOverdue;
    return { label: days > 0 ? `Vencida há ${days} ${days === 1 ? 'dia' : 'dias'}` : 'Vencida', tone: 'danger' };
  }
  return { label: 'Em aberto', tone: 'warning' };
}

// ---- terms of a sale on account ---------------------------------------------------------------

export interface TermsDraft {
  installments: number;
  firstDueDate: string;
}

export function defaultTerms(today: string): TermsDraft {
  return { installments: 1, firstDueDate: addDaysToDateOnly(today, DEFAULT_DUE_IN_DAYS) };
}

export function validateTerms(draft: TermsDraft, totalCents: number, today: string): string | null {
  if (!Number.isInteger(draft.installments) || draft.installments < 1 || draft.installments > MAX_INSTALLMENTS) {
    return `Escolha de 1 a ${MAX_INSTALLMENTS} parcelas.`;
  }
  if (!isDateOnly(draft.firstDueDate)) return 'Informe a data do primeiro vencimento.';
  if (draft.firstDueDate < today) return 'O primeiro vencimento não pode estar no passado.';
  if (draft.firstDueDate > addDaysToDateOnly(today, MAX_FIRST_DUE_DAYS)) return 'O primeiro vencimento pode ser em até 1 ano.';
  if (totalCents > 0 && totalCents < draft.installments) return 'O valor é pequeno demais para tantas parcelas.';
  return null;
}

export function toCreditTerms(draft: TermsDraft): CreditTerms {
  return { installments: draft.installments, firstDueDate: draft.firstDueDate };
}

// What the installments will look like (the API builds the real ones with the same rule: equal
// parts, the leftover cents on the first ones, monthly due dates).
export function previewInstallments(totalCents: number, draft: TermsDraft): { number: number; dueDate: string; amountCents: number }[] {
  if (totalCents < 1 || draft.installments < 1 || !isDateOnly(draft.firstDueDate)) return [];
  const base = Math.floor(totalCents / draft.installments);
  const leftover = totalCents - base * draft.installments;
  return Array.from({ length: draft.installments }, (_, index) => ({
    number: index + 1,
    dueDate: addMonthsToDateOnly(draft.firstDueDate, index),
    amountCents: base + (index < leftover ? 1 : 0),
  }));
}

// Why this customer cannot take this sale on account right now (null = may). The API decides
// again, against the locked account, when the sale is sent.
export function creditBlockReason(account: CreditAccount, totalCents: number): string | null {
  if (account.creditLimitCents <= 0) return 'Este cliente não tem limite de fiado.';
  if (account.overdueCents > 0) return `Cliente com ${formatMoney(account.overdueCents)} em atraso: receba antes de vender fiado.`;
  if (totalCents > account.availableCents) {
    return `Limite insuficiente: disponível ${formatMoney(account.availableCents)} de ${formatMoney(account.creditLimitCents)}.`;
  }
  return null;
}

// ---- forms ----------------------------------------------------------------------------------

export function validateReason(reason: string): string | null {
  const text = reason.trim();
  if (text.length < MIN_REASON) return `Informe o motivo (mínimo ${MIN_REASON} caracteres).`;
  if (text.length > MAX_REASON) return `O motivo aceita até ${MAX_REASON} caracteres.`;
  return null;
}

// '' is a valid limit: it means "no fiado" (0).
export function parseLimit(raw: string): number | null {
  if (raw.trim() === '') return 0;
  const cents = parseMoneyToCents(raw);
  return cents === null || cents < 0 || cents > MAX_RECEIVABLE_CENTS ? null : cents;
}

export function validatePayment(amount: string, openCents: number): string | null {
  const cents = parseMoneyToCents(amount);
  if (cents === null || cents < 1) return 'Informe o valor recebido (a partir de R$ 0,01).';
  if (cents > openCents) return `O valor é maior que o que está em aberto (${formatMoney(openCents)}).`;
  return null;
}

export interface ChargeDraft {
  description: string;
  amount: string;
  installments: number;
  firstDueDate: string;
}

export function validateCharge(draft: ChargeDraft, hasCustomer: boolean, today: string): string | null {
  if (!hasCustomer) return 'Escolha o cliente.';
  const description = draft.description.trim();
  if (description.length < MIN_DESCRIPTION) return 'Descreva a dívida (ex.: saldo do caderno).';
  if (description.length > MAX_DESCRIPTION) return `A descrição aceita até ${MAX_DESCRIPTION} caracteres.`;
  const cents = parseMoneyToCents(draft.amount);
  if (cents === null || cents < 1 || cents > MAX_RECEIVABLE_CENTS) return 'Informe o valor da dívida (a partir de R$ 0,01).';
  return validateTerms(draft, cents, today);
}

// ---- history --------------------------------------------------------------------------------

export function describeReceivableEntry(entry: Pick<ReceivableEntry, 'type' | 'paymentMethod' | 'reason' | 'allocations'>): string {
  switch (entry.type) {
    case 'CHARGE':
      return 'Dívida lançada';
    case 'PAYMENT': {
      const method = entry.paymentMethod ? RECEIVABLE_METHOD_LABEL[entry.paymentMethod] : 'Pagamento';
      const numbers = entry.allocations.map((allocation) => allocation.installmentNumber);
      if (numbers.length === 0) return method;
      return `${method} · ${numbers.length === 1 ? 'parcela' : 'parcelas'} ${numbers.join(', ')}`;
    }
    case 'REVERSAL':
      return entry.reason ?? 'Estorno';
  }
}

// Only a payment that was not reversed yet can be reversed.
export function isPaymentReversible(entry: Pick<ReceivableEntry, 'type' | 'reversed'>): boolean {
  return entry.type === 'PAYMENT' && !entry.reversed;
}

// "−R$ 30,00" for a payment, "+R$ 30,00" for what increases the debt.
export function formatSignedMoney(cents: number): string {
  return `${cents > 0 ? '+' : '−'}${formatMoney(Math.abs(cents))}`;
}

// Friendly text for the API error codes of these screens; unknown codes keep the API message.
export function receivableErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'RECEIVABLE_CUSTOMER_REQUIRED':
      return 'Escolha um cliente cadastrado para vender fiado.';
    case 'RECEIVABLE_CREDIT_NOT_ALLOWED':
      return 'Este cliente não tem limite de fiado.';
    case 'RECEIVABLE_LIMIT_EXCEEDED':
      return 'A venda ultrapassa o limite de fiado do cliente.';
    case 'RECEIVABLE_CUSTOMER_OVERDUE':
      return 'O cliente tem parcela vencida: receba antes de vender fiado.';
    case 'RECEIVABLE_NOTHING_TO_CHARGE':
      return 'Não há valor a lançar no fiado nesta venda.';
    case 'RECEIVABLE_OVERPAYMENT':
      return 'O valor é maior que o que está em aberto.';
    case 'RECEIVABLE_NOT_OPEN':
      return 'Esta conta não está mais em aberto.';
    case 'RECEIVABLE_HAS_PAYMENTS':
      return 'Esta conta já recebeu pagamentos: estorne os pagamentos antes de cancelar.';
    case 'RECEIVABLE_ENTRY_ALREADY_REVERSED':
      return 'Este pagamento já foi estornado.';
    case 'RECEIVABLE_REFUND_BRANCH_REQUIRED':
      return 'Selecione a unidade: o estorno de dinheiro sai do caixa aberto.';
    case 'CASH_REGISTER_NOT_OPEN':
      return `${fallback} (Menu: Caixa → Abrir caixa)`;
    case 'ORDER_HAS_RECEIVABLE':
      return 'Este pedido foi vendido fiado e não pode trocar de cliente.';
    case 'CUSTOMER_INACTIVE':
      return 'Este cliente está inativo.';
    default:
      return fallback;
  }
}
