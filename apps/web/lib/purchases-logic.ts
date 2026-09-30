export interface PreviewLine {
  quantity: string;
  unitCost: string;
}

export interface PreviewAdjustments {
  discountCents: number;
  freightCents: number;
  otherCostsCents: number;
}

export interface PreviewTotals {
  lineTotals: (number | null)[];
  subtotalCents: number;
  totalCents: number;
}

export function quantityToMilli(input: string): number | null {
  const normalized = input.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(normalized)) return null;
  const [intPart, decPart = ''] = normalized.split('.');
  return Number(intPart) * 1000 + Number(decPart.padEnd(3, '0'));
}

export function costToCents(input: string): number | null {
  const normalized = input.trim().replace(/\s/g, '').replace(/^R\$/i, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return null;
  const [intPart, decPart = ''] = normalized.split('.');
  return Number(intPart) * 100 + Number(decPart.padEnd(2, '0'));
}

export function lineTotalCents(quantityMilli: number, unitCostCents: number): number {
  return Number((BigInt(quantityMilli) * BigInt(unitCostCents) + BigInt(500)) / BigInt(1000));
}

export function previewTotals(lines: PreviewLine[], adjustments: PreviewAdjustments): PreviewTotals {
  const lineTotals = lines.map((line) => {
    const milli = quantityToMilli(line.quantity);
    const cost = costToCents(line.unitCost);
    return milli === null || cost === null ? null : lineTotalCents(milli, cost);
  });
  const subtotalCents = lineTotals.reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const totalCents = subtotalCents - adjustments.discountCents + adjustments.freightCents + adjustments.otherCostsCents;
  return { lineTotals, subtotalCents, totalCents };
}

export function todayIso(): string {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

export function monthRange(reference: Date = new Date()): { from: string; to: string } {
  const year = reference.getFullYear();
  const month = reference.getMonth();
  const pad = (value: number) => String(value).padStart(2, '0');
  const lastDay = new Date(year, month + 1, 0).getDate();
  return { from: `${year}-${pad(month + 1)}-01`, to: `${year}-${pad(month + 1)}-${pad(lastDay)}` };
}
