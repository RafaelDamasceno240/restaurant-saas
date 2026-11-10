// Pure helpers of the public menu (storefront): brand color, price labels, the "open now" line
// and the add-on selection of a product. No React, no fetch: all of it is unit-tested.
import type { PublicMenuOptionGroup, PublicMenuProduct } from './public-menu-api';
import { toCents } from './money';

// ---------------------------------------------------------------------------------------------
// Brand color -> the theme tokens the menu uses ("R G B" triplets, see app/globals.css).
// ---------------------------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

// WCAG relative luminance.
function luminance([r, g, b]: [number, number, number]): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

// Text on the brand color: white or near-black, whichever reads better.
export function brandCssVars(brandColor: string | null | undefined): Record<string, string> {
  const rgb = brandColor ? hexToRgb(brandColor) : null;
  if (!rgb) return {};
  const contrastWhite = 1.05 / (luminance(rgb) + 0.05);
  const contrastDark = (luminance(rgb) + 0.05) / 0.05;
  const darker = rgb.map((c) => Math.round(c * 0.86)) as [number, number, number];
  return {
    '--primary': rgb.join(' '),
    '--primary-hover': darker.join(' '),
    '--primary-foreground': contrastWhite >= contrastDark ? '255 255 255' : '17 17 17',
  };
}

// ---------------------------------------------------------------------------------------------
// Prices
// ---------------------------------------------------------------------------------------------

export interface PriceLabel {
  priceCents: number;
  // "De R$ 35,00 por R$ 32,00".
  compareAtCents: number | null;
  // "A partir de": a paid add-on can raise the price.
  startingAt: boolean;
}

export function priceLabel(product: PublicMenuProduct): PriceLabel {
  const compareAt = product.compareAtPrice != null ? toCents(product.compareAtPrice) : null;
  const priceCents = toCents(product.price);
  const promo = compareAt !== null && compareAt > priceCents;
  const paidAddOn = (product.optionGroups ?? []).some((g) => g.options.some((o) => o.price > 0));
  return { priceCents, compareAtCents: promo ? compareAt : null, startingAt: !promo && paidAddOn };
}

// ---------------------------------------------------------------------------------------------
// Opening hours: "Aberto agora · fecha às 23:00" / "Fechado · abre quinta às 19:00"
// ---------------------------------------------------------------------------------------------

export interface OpeningInterval {
  weekday: number;
  opens: string;
  closes: string;
}

const WEEK_MINUTES = 7 * 1440;
const WEEKDAY_NAMES = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const SHORT_DAYS: Record<string, number> = {
  Sun: 0,
  Mon: 1,
  Tue: 2,
  Wed: 3,
  Thu: 4,
  Fri: 5,
  Sat: 6,
};

const toMinutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

// Weekday and minute of the day of `now` in the restaurant's zone (never the visitor's).
export function localWeekMinute(now: Date, timeZone: string): number {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    parts = new Intl.DateTimeFormat('en-US', {
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0';
  return (
    SHORT_DAYS[get('weekday')] * 1440 + (Number(get('hour')) % 24) * 60 + Number(get('minute'))
  );
}

export interface OpeningStatus {
  open: boolean | null;
  text: string;
}

export function describeOpening(
  hours: OpeningInterval[] | null | undefined,
  now: Date,
  timeZone = 'America/Sao_Paulo',
): OpeningStatus {
  if (!hours) return { open: null, text: '' };
  if (hours.length === 0) return { open: false, text: 'Fechado no momento' };
  const current = localWeekMinute(now, timeZone);
  const spans = hours.map((h) => {
    const start = h.weekday * 1440 + toMinutes(h.opens);
    const opens = toMinutes(h.opens);
    const closes = toMinutes(h.closes);
    const length = closes > opens ? closes - opens : closes + 1440 - opens;
    return { start, end: start + length, closes: h.closes, opens: h.opens };
  });
  for (const s of spans) {
    for (const t of [current, current + WEEK_MINUTES]) {
      if (t >= s.start && t < s.end)
        return { open: true, text: `Aberto agora · fecha às ${s.closes}` };
    }
  }
  const next = spans
    .map((s) => ({
      ...s,
      wait: (((s.start - current) % WEEK_MINUTES) + WEEK_MINUTES) % WEEK_MINUTES,
    }))
    .sort((a, b) => a.wait - b.wait)[0];
  const today = Math.floor(current / 1440);
  const day = Math.floor(((current + next.wait) % WEEK_MINUTES) / 1440);
  const offset = (day - today + 7) % 7;
  const when = offset === 0 ? 'hoje' : offset === 1 ? 'amanhã' : WEEKDAY_NAMES[day];
  return { open: false, text: `Fechado · abre ${when} às ${next.opens}` };
}

// ---------------------------------------------------------------------------------------------
// Add-on selection of one product (the product page). The server re-checks all of it.
// ---------------------------------------------------------------------------------------------

export type Selection = Record<string, number>;

export function groupUnits(group: PublicMenuOptionGroup, selection: Selection): number {
  return group.options.reduce((sum, o) => sum + (selection[o.id] ?? 0), 0);
}

// One choice only (radio): picking another option replaces the previous one.
export const isSingleChoice = (group: PublicMenuOptionGroup) => group.maxSelect === 1;

export function canIncrement(
  group: PublicMenuOptionGroup,
  optionId: string,
  selection: Selection,
): boolean {
  const option = group.options.find((o) => o.id === optionId);
  if (!option) return false;
  if ((selection[optionId] ?? 0) >= option.maxQuantity) return false;
  return isSingleChoice(group) || groupUnits(group, selection) < group.maxSelect;
}

export function increment(
  group: PublicMenuOptionGroup,
  optionId: string,
  selection: Selection,
): Selection {
  if (isSingleChoice(group)) {
    const next = { ...selection };
    for (const o of group.options) delete next[o.id];
    next[optionId] = 1;
    return next;
  }
  if (!canIncrement(group, optionId, selection)) return selection;
  return { ...selection, [optionId]: (selection[optionId] ?? 0) + 1 };
}

export function decrement(optionId: string, selection: Selection): Selection {
  const next = { ...selection };
  if ((next[optionId] ?? 0) <= 1) delete next[optionId];
  else next[optionId] -= 1;
  return next;
}

// The first required group still short of its minimum (the page scrolls to it), or null.
export function firstMissingGroup(
  groups: PublicMenuOptionGroup[],
  selection: Selection,
): PublicMenuOptionGroup | null {
  return groups.find((g) => groupUnits(g, selection) < g.minSelect) ?? null;
}

export function groupRuleText(group: PublicMenuOptionGroup): string {
  if (group.minSelect === 0)
    return group.maxSelect === 1 ? 'Escolha até 1 opção' : `Escolha até ${group.maxSelect} opções`;
  if (group.minSelect === group.maxSelect)
    return group.minSelect === 1 ? 'Escolha 1 opção' : `Escolha ${group.minSelect} opções`;
  return `Escolha de ${group.minSelect} a ${group.maxSelect}`;
}

export interface ChosenOptionLine {
  optionId: string;
  groupName: string;
  name: string;
  priceCents: number;
  quantity: number;
}

// In the product's order (groups, then options), as the kitchen will read them.
export function chosenOptions(
  groups: PublicMenuOptionGroup[],
  selection: Selection,
): ChosenOptionLine[] {
  return groups.flatMap((g) =>
    g.options
      .filter((o) => (selection[o.id] ?? 0) > 0)
      .map((o) => ({
        optionId: o.id,
        groupName: g.name,
        name: o.name,
        priceCents: toCents(o.price),
        quantity: selection[o.id],
      })),
  );
}

export function unitPriceCents(product: PublicMenuProduct, selection: Selection): number {
  const extra = chosenOptions(product.optionGroups ?? [], selection).reduce(
    (s, o) => s + o.priceCents * o.quantity,
    0,
  );
  return toCents(product.price) + extra;
}
