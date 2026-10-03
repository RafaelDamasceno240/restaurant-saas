import type { BadgeTone } from '@/components/ds/Badge';
import type {
  Coupon,
  CouponAvailability,
  CouponCreateInput,
  CouponDiscountType,
  CouponStatusFilter,
  CouponUpdateInput,
} from './coupons-api';

// Presentation and form rules for the coupons screen. The API is the authority (it normalizes and
// validates again, and decides everything about a discount); these only give fast feedback.

export const COUPON_TABS: CouponStatusFilter[] = ['active', 'inactive', 'all'];

export const COUPON_TAB_LABEL: Record<CouponStatusFilter, string> = {
  active: 'Ativos',
  inactive: 'Inativos',
  all: 'Todos',
};

export const MAX_DESCRIPTION = 200;
export const MAX_AMOUNT_CENTS = 2_147_483_647;

export const AVAILABILITY_LABEL: Record<CouponAvailability, string> = {
  AVAILABLE: 'Disponível',
  SCHEDULED: 'Agendado',
  EXPIRED: 'Expirado',
  EXHAUSTED: 'Esgotado',
  INACTIVE: 'Inativo',
};

export const AVAILABILITY_TONE: Record<CouponAvailability, BadgeTone> = {
  AVAILABLE: 'success',
  SCHEDULED: 'info',
  EXPIRED: 'neutral',
  EXHAUSTED: 'warning',
  INACTIVE: 'neutral',
};

// Same canonical form as the API: trim + upper case. The API refuses anything outside A-Z 0-9 - _.
export const COUPON_CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;

export function normalizeCode(raw: string): string {
  return raw.trim().toUpperCase();
}

// "12,50" / "12.50" / "12" -> 1250. Only plain decimal money with at most 2 decimals; anything
// else (letters, negatives, "1,2,3", 3 decimals) is null so it can be reported, never guessed.
export function parseMoneyToCents(raw: string): number | null {
  const text = raw.trim().replace(/\s/g, '');
  if (!/^\d{1,9}([.,]\d{1,2})?$/.test(text)) return null;
  const [whole, fraction = ''] = text.replace(',', '.').split('.');
  const cents = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  return cents <= MAX_AMOUNT_CENTS ? cents : null;
}

export function centsToInput(cents: number | null): string {
  if (cents === null) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

export function parseWholeNumber(raw: string): number | null {
  const text = raw.trim();
  if (!/^\d{1,10}$/.test(text)) return null;
  const n = Number(text);
  return n <= MAX_AMOUNT_CENTS ? n : null;
}

// "R$ 5,00 de desconto" / "10% de desconto" (+ cap).
export function describeDiscount(coupon: Pick<Coupon, 'discountType' | 'value' | 'maxDiscountCents'>): string {
  if (coupon.discountType === 'FIXED') return `R$ ${centsToInput(coupon.value)}`;
  const cap = coupon.maxDiscountCents !== null ? ` (até R$ ${centsToInput(coupon.maxDiscountCents)})` : '';
  return `${coupon.value}%${cap}`;
}

export function describeUsage(coupon: Pick<Coupon, 'usageCount' | 'usageLimit'>): string {
  return coupon.usageLimit === null ? `${coupon.usageCount}` : `${coupon.usageCount} / ${coupon.usageLimit}`;
}

// ISO <-> <input type="datetime-local"> (local time, no seconds). Empty means "no date".
export function isoToLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localInputToIso(local: string): string | null {
  if (!local.trim()) return null;
  const d = new Date(local);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function formatWindow(coupon: Pick<Coupon, 'startsAt' | 'endsAt'>): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
  if (coupon.startsAt && coupon.endsAt) return `${fmt(coupon.startsAt)} até ${fmt(coupon.endsAt)}`;
  if (coupon.startsAt) return `A partir de ${fmt(coupon.startsAt)}`;
  if (coupon.endsAt) return `Até ${fmt(coupon.endsAt)}`;
  return 'Sem prazo';
}

export interface CouponDraft {
  code: string;
  description: string;
  discountType: CouponDiscountType;
  // Percentage: whole percent. Fixed: reais, e.g. "5,00".
  value: string;
  minOrder: string;
  maxDiscount: string;
  startsAt: string;
  endsAt: string;
  usageLimit: string;
  perCustomerLimit: string;
  branchId: string;
}

export const EMPTY_DRAFT: CouponDraft = {
  code: '',
  description: '',
  discountType: 'PERCENTAGE',
  value: '',
  minOrder: '',
  maxDiscount: '',
  startsAt: '',
  endsAt: '',
  usageLimit: '',
  perCustomerLimit: '',
  branchId: '',
};

export function toDraft(coupon: Coupon): CouponDraft {
  return {
    code: coupon.code,
    description: coupon.description ?? '',
    discountType: coupon.discountType,
    value: coupon.discountType === 'FIXED' ? centsToInput(coupon.value) : String(coupon.value),
    minOrder: coupon.minOrderCents > 0 ? centsToInput(coupon.minOrderCents) : '',
    maxDiscount: coupon.maxDiscountCents !== null ? centsToInput(coupon.maxDiscountCents) : '',
    startsAt: isoToLocalInput(coupon.startsAt),
    endsAt: isoToLocalInput(coupon.endsAt),
    usageLimit: coupon.usageLimit !== null ? String(coupon.usageLimit) : '',
    perCustomerLimit: coupon.perCustomerLimit !== null ? String(coupon.perCustomerLimit) : '',
    branchId: coupon.branch?.id ?? '',
  };
}

// First problem found, in form order; null when the draft can be submitted. `creating` also checks
// the code; `branchRequired` is for branch-limited users, who cannot create tenant-wide coupons.
export function validateDraft(draft: CouponDraft, opts: { creating: boolean; branchRequired?: boolean }): string | null {
  if (opts.creating) {
    const code = normalizeCode(draft.code);
    if (!COUPON_CODE_PATTERN.test(code)) return 'Código inválido: use de 3 a 32 caracteres entre letras, números, "-" e "_".';
  }
  if (draft.description.length > MAX_DESCRIPTION) return `A descrição aceita até ${MAX_DESCRIPTION} caracteres.`;

  if (draft.discountType === 'PERCENTAGE') {
    const pct = parseWholeNumber(draft.value);
    if (pct === null || pct < 1 || pct > 100) return 'O percentual deve ser um número inteiro entre 1 e 100.';
    if (draft.maxDiscount.trim() !== '') {
      const cap = parseMoneyToCents(draft.maxDiscount);
      if (cap === null || cap < 1) return 'Informe um teto de desconto válido (ex.: 20,00).';
    }
  } else {
    const cents = parseMoneyToCents(draft.value);
    if (cents === null || cents < 1) return 'Informe um valor de desconto válido, maior que zero (ex.: 5,00).';
  }

  if (draft.minOrder.trim() !== '' && parseMoneyToCents(draft.minOrder) === null) return 'Informe um valor mínimo válido (ex.: 30,00).';

  const start = draft.startsAt.trim() ? localInputToIso(draft.startsAt) : null;
  const end = draft.endsAt.trim() ? localInputToIso(draft.endsAt) : null;
  if (draft.startsAt.trim() && start === null) return 'Data de início inválida.';
  if (draft.endsAt.trim() && end === null) return 'Data de término inválida.';
  if (start && end && new Date(end) <= new Date(start)) return 'O término deve ser depois do início.';

  for (const [label, raw] of [
    ['limite de utilizações', draft.usageLimit],
    ['limite por cliente', draft.perCustomerLimit],
  ] as const) {
    if (raw.trim() !== '') {
      const n = parseWholeNumber(raw);
      if (n === null || n < 1) return `O ${label} deve ser um número inteiro de pelo menos 1.`;
    }
  }
  if (opts.branchRequired && draft.branchId === '') return 'Escolha a unidade do cupom.';
  return null;
}

function rulesOf(draft: CouponDraft): CouponUpdateInput {
  const percentage = draft.discountType === 'PERCENTAGE';
  return {
    description: draft.description.trim() || null,
    discountType: draft.discountType,
    value: percentage ? (parseWholeNumber(draft.value) as number) : (parseMoneyToCents(draft.value) as number),
    minOrderCents: draft.minOrder.trim() ? (parseMoneyToCents(draft.minOrder) as number) : 0,
    maxDiscountCents: percentage && draft.maxDiscount.trim() ? (parseMoneyToCents(draft.maxDiscount) as number) : null,
    startsAt: localInputToIso(draft.startsAt),
    endsAt: localInputToIso(draft.endsAt),
    usageLimit: draft.usageLimit.trim() ? (parseWholeNumber(draft.usageLimit) as number) : null,
    perCustomerLimit: draft.perCustomerLimit.trim() ? (parseWholeNumber(draft.perCustomerLimit) as number) : null,
  };
}

export function draftToCreateInput(draft: CouponDraft): CouponCreateInput {
  return {
    code: normalizeCode(draft.code),
    ...rulesOf(draft),
    discountType: draft.discountType,
    value: rulesOf(draft).value as number,
    branchId: draft.branchId || null,
  };
}

// Editing sends ONLY the fields whose value changed (an untouched coupon is an empty patch).
export function draftToPatch(draft: CouponDraft, original: Coupon): CouponUpdateInput {
  const next = rulesOf(draft);
  const before: CouponUpdateInput = {
    description: original.description,
    discountType: original.discountType,
    value: original.value,
    minOrderCents: original.minOrderCents,
    maxDiscountCents: original.maxDiscountCents,
    startsAt: original.startsAt,
    endsAt: original.endsAt,
    usageLimit: original.usageLimit,
    perCustomerLimit: original.perCustomerLimit,
  };
  // Only the two date fields are compared as instants; every other value (including strings such
  // as the description or the discount type) is compared as is.
  const DATE_KEYS: (keyof CouponUpdateInput)[] = ['startsAt', 'endsAt'];
  const same = (key: keyof CouponUpdateInput) => {
    const a = next[key];
    const b = before[key];
    if (DATE_KEYS.includes(key) && typeof a === 'string' && typeof b === 'string') {
      return new Date(a).getTime() === new Date(b).getTime();
    }
    return a === b;
  };
  const patch: Record<string, unknown> = {};
  for (const key of Object.keys(next) as (keyof CouponUpdateInput)[]) {
    if (!same(key)) patch[key] = next[key] ?? null;
  }
  return patch as CouponUpdateInput;
}

export function isEmptyPatch(patch: CouponUpdateInput): boolean {
  return Object.keys(patch).length === 0;
}

// Friendly text for the API error codes of this screen; unknown codes keep the API message.
export function couponErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'COUPON_CODE_TAKEN':
      return 'Já existe um cupom ativo com este código. Desative-o antes de criar outro igual.';
    case 'COUPON_NOT_FOUND':
      return 'Cupom não encontrado. Atualize a lista.';
    case 'COUPON_USAGE_LIMIT_BELOW_USED':
      return fallback;
    case 'COUPON_BRANCH_FORBIDDEN':
      return 'Você só pode gerenciar cupons das unidades às quais tem acesso.';
    default:
      return fallback;
  }
}

// What the PDV/checkout show when applying a coupon fails. The public checkout only ever gets the
// generic COUPON_INVALID; the PDV (staff) also gets the specific reasons from the API message.
export function couponApplyMessage(code: string | undefined, fallback: string): string {
  if (code === 'COUPON_INVALID') return 'Cupom inválido ou não aplicável a este pedido.';
  return fallback;
}

// When the list must tell "no coupons yet" from "nothing matches the filters".
export function isFiltering(search: string, status: CouponStatusFilter): boolean {
  return search.trim() !== '' || status !== 'active';
}

// Display only: the amount the screen shows next to the subtotal. The ORDER recalculates it.
export function totalAfterCouponCents(subtotalCents: number, discountCents: number, deliveryFeeCents = 0): number {
  return Math.max(0, subtotalCents - discountCents) + deliveryFeeCents;
}

// Identity of the basket a preview was asked for: branch + canonical code + the items. A preview is
// only shown while the screen still holds exactly this basket; any change makes it stale and the
// cashier has to apply again (the order itself always re-validates on the server).
export function couponPreviewKey(
  branchId: string,
  code: string,
  items: { productId: string; quantity: number }[],
): string {
  const basket = [...items]
    .sort((a, b) => a.productId.localeCompare(b.productId))
    .map((item) => `${item.productId}:${item.quantity}`)
    .join(',');
  return `${branchId}|${normalizeCode(code)}|${basket}`;
}
