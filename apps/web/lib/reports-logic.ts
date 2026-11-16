import { addDaysToDateOnly, isDateOnly } from './receivables-logic';

// Presentation rules of the reports screen: period presets, labels and formatting. The API is
// the authority on every number and on what the period means (the restaurant's time zone).

export const MAX_PERIOD_DAYS = 366;

export type ReportTab = 'sales' | 'products' | 'customers' | 'inventory' | 'delivery' | 'cash';
export const REPORT_TABS: { key: ReportTab; label: string }[] = [
  { key: 'sales', label: 'Vendas' },
  { key: 'products', label: 'Produtos' },
  { key: 'customers', label: 'Clientes' },
  { key: 'inventory', label: 'Estoque' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'cash', label: 'Caixa' },
];

export type PeriodPreset = 'today' | 'yesterday' | '7d' | '30d' | 'month' | 'lastMonth' | 'custom';
export const PERIOD_PRESETS: PeriodPreset[] = ['today', 'yesterday', '7d', '30d', 'month', 'lastMonth', 'custom'];
export const PERIOD_PRESET_LABEL: Record<PeriodPreset, string> = {
  today: 'Hoje',
  yesterday: 'Ontem',
  '7d': 'Últimos 7 dias',
  '30d': 'Últimos 30 dias',
  month: 'Este mês',
  lastMonth: 'Mês passado',
  custom: 'Período personalizado',
};

export interface DateRange {
  from: string;
  to: string;
}

// The calendar days a preset stands for, counted from `today` ('YYYY-MM-DD'). "custom" has no
// days of its own: the caller keeps whatever was typed.
export function presetRange(preset: Exclude<PeriodPreset, 'custom'>, today: string): DateRange {
  const [year, month] = today.split('-').map(Number);
  const firstOfMonth = `${today.slice(0, 8)}01`;
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'yesterday': {
      const day = addDaysToDateOnly(today, -1);
      return { from: day, to: day };
    }
    case '7d':
      return { from: addDaysToDateOnly(today, -6), to: today };
    case '30d':
      return { from: addDaysToDateOnly(today, -29), to: today };
    case 'month':
      return { from: firstOfMonth, to: today };
    case 'lastMonth': {
      const lastDay = addDaysToDateOnly(firstOfMonth, -1);
      const previous = month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
      return { from: `${previous}-01`, to: lastDay };
    }
  }
}

// Which preset, if any, the two dates correspond to (so the selector shows the truth after the
// dates are edited by hand).
export function presetOf(range: DateRange, today: string): PeriodPreset {
  for (const preset of PERIOD_PRESETS) {
    if (preset === 'custom') continue;
    const candidate = presetRange(preset, today);
    if (candidate.from === range.from && candidate.to === range.to) return preset;
  }
  return 'custom';
}

export function daysInRange(range: DateRange): number {
  const from = Date.parse(`${range.from}T00:00:00.000Z`);
  const to = Date.parse(`${range.to}T00:00:00.000Z`);
  return Math.round((to - from) / 86_400_000) + 1;
}

// Why the period cannot be sent (null = it can). The API applies the same rules.
export function validateRange(range: DateRange): string | null {
  if (!isDateOnly(range.from) || !isDateOnly(range.to)) return 'Informe as duas datas do período.';
  if (range.from > range.to) return 'A data inicial não pode ser depois da final.';
  if (daysInRange(range) > MAX_PERIOD_DAYS) return 'O período máximo é de 366 dias.';
  return null;
}

// ---- labels ---------------------------------------------------------------------------------

export const PAYMENT_METHOD_LABEL: Record<string, string> = { CASH: 'Dinheiro', PIX: 'Pix', CARD: 'Cartão', ON_ACCOUNT: 'Fiado' };
export const SOURCE_LABEL: Record<string, string> = { ONLINE: 'Cardápio online', COUNTER: 'Balcão (PDV)', TABLE: 'Mesa' };
export const FULFILLMENT_LABEL: Record<string, string> = { DELIVERY: 'Entrega', PICKUP: 'Retirada', DINE_IN: 'No local' };
export const UNIT_LABEL: Record<string, string> = { UNIT: 'un', KG: 'kg', G: 'g', L: 'L', ML: 'mL' };

export const labelOf = (labels: Record<string, string>, key: string) => labels[key] ?? key;

// ---- formatting -----------------------------------------------------------------------------

export function formatMoney(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

// Basis points as a percentage: 7742 -> "77,4%"; null -> "—".
export function formatBps(bps: number | null): string {
  if (bps === null) return '—';
  return `${(bps / 100).toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

// 45 -> "45 min"; 65 -> "1 h 05 min"; null -> "—".
export function formatMinutes(minutes: number | null): string {
  if (minutes === null) return '—';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  return `${hours} h ${String(minutes % 60).padStart(2, '0')} min`;
}

// '2026-10-05' -> "05/10" (the year is in the period shown above the chart).
export function formatDayShort(day: string): string {
  return isDateOnly(day) ? `${day.slice(8, 10)}/${day.slice(5, 7)}` : day;
}

export const formatHour = (hour: number) => `${String(hour).padStart(2, '0')}h`;

// Stock quantities: up to three decimals, without trailing zeros, with the unit.
export function formatQuantity(value: number, unit: string): string {
  return `${value.toLocaleString('pt-BR', { maximumFractionDigits: 3 })} ${labelOf(UNIT_LABEL, unit)}`;
}

// Width of a bar relative to the largest value, as a whole percentage. Anything above zero is
// at least 2% wide so it can be seen; zero (and a chart with no data) is no bar at all.
export function barPercent(value: number, max: number): number {
  if (value <= 0 || max <= 0) return 0;
  return Math.max(2, Math.min(100, Math.round((value / max) * 100)));
}

export function maxOf<T>(rows: T[], pick: (row: T) => number): number {
  return rows.reduce((max, row) => Math.max(max, pick(row)), 0);
}

// The busiest hour of the day in the period, or null when nothing was sold.
export function peakHour(byHour: { hour: number; ordersCount: number; totalCents: number }[]): { hour: number; ordersCount: number; totalCents: number } | null {
  const best = byHour.reduce<{ hour: number; ordersCount: number; totalCents: number } | null>(
    (top, row) => (row.ordersCount > 0 && (top === null || row.totalCents > top.totalCents) ? row : top),
    null,
  );
  return best;
}

// The hours worth showing: from the first to the last hour with a sale (a restaurant that opens
// at 18h does not need eighteen empty bars), or nothing when there were no sales.
export function activeHours<T extends { hour: number; ordersCount: number }>(byHour: T[]): T[] {
  const first = byHour.findIndex((row) => row.ordersCount > 0);
  if (first < 0) return [];
  let last = first;
  byHour.forEach((row, index) => {
    if (row.ordersCount > 0) last = index;
  });
  return byHour.slice(first, last + 1);
}

// "01/10/2026 a 05/10/2026 · 5 dias", or a single day.
export function describePeriod(period: { from: string; to: string; days: number }): string {
  const full = (day: string) => `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
  return period.from === period.to ? full(period.from) : `${full(period.from)} a ${full(period.to)} · ${period.days} dias`;
}
