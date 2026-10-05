import type { BadgeTone } from '@/components/ds/Badge';
import type { CashbackEntry, CashbackEntryType, CashbackProgram } from './cashback-api';
import { parseMoneyToCents } from './coupons-logic';

// Presentation and form rules for cashback. The API is the authority (it recalculates and
// validates everything); these only give fast feedback and readable output.

export const MAX_EARN_RATE_BPS = 5000;
export const MAX_EXPIRE_AFTER_DAYS = 3650;
export const MAX_ADJUSTMENT_CENTS = 10_000_000;
export const MIN_REASON = 3;
export const MAX_REASON = 200;

export const CASHBACK_ENTRY_LABEL: Record<CashbackEntryType, string> = {
  EARN: 'Compra',
  USE: 'Uso',
  ADJUSTMENT: 'Ajuste',
  REVERSAL: 'Estorno',
  EXPIRATION: 'Expiração',
};

export const CASHBACK_ENTRY_TONE: Record<CashbackEntryType, BadgeTone> = {
  EARN: 'success',
  USE: 'brand',
  ADJUSTMENT: 'info',
  REVERSAL: 'warning',
  EXPIRATION: 'neutral',
};

// "+R$ 8,00" / "−R$ 12,00".
export function formatSignedCents(cents: number): string {
  const value = (Math.abs(cents) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  return `${cents > 0 ? '+' : '−'}${value}`;
}

// 500 -> "5%"; 250 -> "2,5%"; 333 -> "3,33%".
export function formatRate(earnRateBps: number): string {
  return `${(earnRateBps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
}

// What goes in the percentage field: "5", "2,5", "3,33".
export function rateToInput(earnRateBps: number): string {
  return (earnRateBps / 100).toLocaleString('pt-BR', { maximumFractionDigits: 2, useGrouping: false });
}

// "5" -> 500, "2,5" -> 250, "3.33" -> 333. Up to two decimals; anything else is null.
export function parseRateToBps(raw: string): number | null {
  const text = raw.trim().replace('%', '').trim();
  if (!/^\d{1,2}([.,]\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.replace(',', '.').split('.');
  const bps = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return bps >= 1 && bps <= MAX_EARN_RATE_BPS ? bps : null;
}

// '' means "never expires"; otherwise a whole number of days.
export function parseExpireDays(raw: string): number | null | undefined {
  const text = raw.trim();
  if (text === '') return null;
  if (!/^\d+$/.test(text)) return undefined;
  const days = Number(text);
  return days >= 1 && days <= MAX_EXPIRE_AFTER_DAYS ? days : undefined;
}

export interface ProgramDraft {
  enabled: boolean;
  rate: string;
  expireDays: string;
}

export function toProgramDraft(program: CashbackProgram): ProgramDraft {
  return {
    enabled: program.enabled,
    rate: rateToInput(program.earnRateBps),
    expireDays: program.expireAfterDays === null ? '' : String(program.expireAfterDays),
  };
}

export function validateProgramDraft(draft: ProgramDraft): string | null {
  if (parseRateToBps(draft.rate) === null) return 'Informe o percentual de cashback (de 0,01% a 50%).';
  if (parseExpireDays(draft.expireDays) === undefined) return `Informe os dias até expirar (1 a ${MAX_EXPIRE_AFTER_DAYS}) ou deixe em branco.`;
  return null;
}

export function draftToProgram(draft: ProgramDraft): CashbackProgram {
  return {
    enabled: draft.enabled,
    earnRateBps: parseRateToBps(draft.rate) as number,
    expireAfterDays: parseExpireDays(draft.expireDays) as number | null,
  };
}

export function isProgramDirty(draft: ProgramDraft, stored: CashbackProgram): boolean {
  return (
    draft.enabled !== stored.enabled ||
    parseRateToBps(draft.rate) !== stored.earnRateBps ||
    parseExpireDays(draft.expireDays) !== stored.expireAfterDays
  );
}

export function describeProgram(program: CashbackProgram): string {
  const expiration =
    program.expireAfterDays === null ? 'o saldo não expira' : `o saldo expira após ${program.expireAfterDays} dia(s) sem compra nem uso`;
  return `${formatRate(program.earnRateBps)} do valor pago nos itens; ${expiration}`;
}

// What the movement was about, in one line.
export function describeCashbackEntry(entry: Pick<CashbackEntry, 'type' | 'orderNumber' | 'reason'>): string {
  switch (entry.type) {
    case 'EARN':
    case 'USE':
      return entry.orderNumber ? `Pedido ${entry.orderNumber}` : 'Pedido';
    case 'ADJUSTMENT':
      return entry.reason ?? 'Ajuste manual';
    case 'REVERSAL':
      return entry.orderNumber && entry.reason ? `${entry.reason} (${entry.orderNumber})` : (entry.reason ?? 'Estorno');
    case 'EXPIRATION':
      return 'Saldo sem movimentação';
  }
}

// A use goes back only when its order is cancelled; expirations and reversals are final.
export function isCashbackReversible(entry: Pick<CashbackEntry, 'type' | 'reversed'>): boolean {
  return (entry.type === 'EARN' || entry.type === 'ADJUSTMENT') && !entry.reversed;
}

// How much of the balance may pay for a sale: never more than the balance, never more than the
// items after the coupon. The API enforces the same rule against the balance at that instant.
export function maxUsableCashbackCents(itemsAfterDiscountCents: number, balanceCents: number): number {
  return Math.max(0, Math.min(balanceCents, itemsAfterDiscountCents));
}

// What the cashier typed, as cents to send: null when empty/invalid, clamped to nothing.
export function parseCashbackToUse(raw: string): number | null {
  if (raw.trim() === '') return 0;
  const cents = parseMoneyToCents(raw);
  return cents === null || cents < 0 ? null : cents;
}

export function validateCashbackToUse(raw: string, maxCents: number): string | null {
  const cents = parseCashbackToUse(raw);
  if (cents === null) return 'Informe um valor válido de cashback.';
  if (cents > maxCents) return `O máximo que pode ser usado nesta venda é ${formatSignedCents(maxCents).slice(1)}.`;
  return null;
}

export type CashbackDirection = 'credit' | 'debit';

export interface CashbackAdjustDraft {
  direction: CashbackDirection;
  amount: string;
  reason: string;
}

export const EMPTY_CASHBACK_ADJUST: CashbackAdjustDraft = { direction: 'credit', amount: '', reason: '' };

export function validateCashbackReason(reason: string): string | null {
  const text = reason.trim();
  if (text.length < MIN_REASON) return `Informe o motivo (mínimo ${MIN_REASON} caracteres).`;
  if (text.length > MAX_REASON) return `O motivo aceita até ${MAX_REASON} caracteres.`;
  return null;
}

export function validateCashbackAdjust(draft: CashbackAdjustDraft, balanceCents: number): string | null {
  const cents = parseMoneyToCents(draft.amount);
  if (cents === null || cents < 1 || cents > MAX_ADJUSTMENT_CENTS) return 'Informe o valor do ajuste (a partir de R$ 0,01).';
  if (draft.direction === 'debit' && cents > balanceCents) return 'O débito é maior que o saldo do cliente.';
  return validateCashbackReason(draft.reason);
}

// Signed cents sent to the API: a debit is negative.
export function cashbackAdjustCents(draft: CashbackAdjustDraft): number {
  const cents = parseMoneyToCents(draft.amount) ?? 0;
  return draft.direction === 'debit' ? -cents : cents;
}

// Friendly text for the API error codes of these screens; unknown codes keep the API message.
export function cashbackErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'CASHBACK_INSUFFICIENT_BALANCE':
      return 'Saldo de cashback insuficiente.';
    case 'CASHBACK_DISABLED':
      return 'O cashback está desativado.';
    case 'CASHBACK_EXCEEDS_ORDER':
      return 'O cashback usado não pode ser maior que o valor dos itens.';
    case 'CASHBACK_CUSTOMER_REQUIRED':
      return 'Escolha um cliente cadastrado para usar cashback.';
    case 'CASHBACK_ENTRY_ALREADY_REVERSED':
      return 'Esta movimentação já foi estornada.';
    case 'CASHBACK_ENTRY_NOT_REVERSIBLE':
      return fallback;
    case 'ORDER_HAS_CASHBACK':
      return 'Este pedido já movimentou cashback do cliente e não pode trocar de cliente.';
    default:
      return fallback;
  }
}
