import { InventoryUnit, Prisma } from '@prisma/client';

export type Decimal = Prisma.Decimal;
export const Decimal = Prisma.Decimal;

export const QUANTITY_SCALE = 3;
export const EXPIRY_WARNING_DAYS = 7;

const ZERO = new Decimal(0);
const DAY_MS = 24 * 60 * 60 * 1000;

export function toQuantity(value: number | string | Decimal): Decimal {
  return new Decimal(typeof value === 'number' ? String(value) : value);
}

export function toDisplay(value: Decimal): number {
  return Number(value.toFixed(QUANTITY_SCALE));
}

export function hasValidScale(value: Decimal): boolean {
  return value.decimalPlaces() <= QUANTITY_SCALE;
}

export function roundCents(value: Decimal): number {
  return value.toDecimalPlaces(0, Decimal.ROUND_HALF_UP).toNumber();
}

type UnitFamily = 'COUNT' | 'MASS' | 'VOLUME';

const UNIT_FAMILY: Record<InventoryUnit, UnitFamily> = {
  UNIT: 'COUNT',
  KG: 'MASS',
  G: 'MASS',
  L: 'VOLUME',
  ML: 'VOLUME',
};

const BASE_FACTOR: Record<InventoryUnit, number> = { UNIT: 1, KG: 1000, G: 1, L: 1000, ML: 1 };

export function areUnitsCompatible(a: InventoryUnit, b: InventoryUnit): boolean {
  return UNIT_FAMILY[a] === UNIT_FAMILY[b];
}

export class UnitConversionError extends Error {
  constructor(public readonly code: 'INCOMPATIBLE_UNIT' | 'INVALID_PRECISION') {
    super(code);
  }
}

export function convertQuantity(quantity: Decimal, from: InventoryUnit, to: InventoryUnit): Decimal {
  if (!areUnitsCompatible(from, to)) throw new UnitConversionError('INCOMPATIBLE_UNIT');
  const converted = quantity.mul(BASE_FACTOR[from]).div(BASE_FACTOR[to]);
  if (!hasValidScale(converted)) throw new UnitConversionError('INVALID_PRECISION');
  return converted;
}

export function displayQuantityIn(quantity: Decimal, from: InventoryUnit, to: InventoryUnit): Decimal {
  return quantity.mul(BASE_FACTOR[from]).div(BASE_FACTOR[to]);
}

export function computeAverageCostCents(
  currentQuantity: Decimal,
  currentAverageCents: number,
  incomingQuantity: Decimal,
  incomingUnitCostCents: number,
): number {
  const existing = Decimal.max(currentQuantity, ZERO);
  const totalQuantity = existing.add(incomingQuantity);
  if (totalQuantity.lte(ZERO)) return incomingUnitCostCents;
  const totalValue = existing.mul(currentAverageCents).add(incomingQuantity.mul(incomingUnitCostCents));
  return roundCents(totalValue.div(totalQuantity));
}

export function stockValueCents(quantity: Decimal, averageCostCents: number): number {
  return roundCents(Decimal.max(quantity, ZERO).mul(averageCostCents));
}

export function lineCostCents(quantity: Decimal, unitCostCents: number): number {
  return roundCents(quantity.abs().mul(unitCostCents));
}

export interface Margin {
  marginCents: number;
  marginPercent: number | null;
}

export function computeMargin(priceCents: number, costCents: number): Margin {
  const marginCents = priceCents - costCents;
  if (priceCents <= 0) return { marginCents, marginPercent: null };
  const percent = new Decimal(marginCents).mul(100).div(priceCents).toDecimalPlaces(1, Decimal.ROUND_HALF_UP);
  return { marginCents, marginPercent: percent.toNumber() };
}

export type StockStatus = 'OK' | 'LOW_STOCK' | 'OUT_OF_STOCK';

export function stockStatus(quantity: Decimal, minStock: Decimal): StockStatus {
  if (quantity.lte(ZERO)) return 'OUT_OF_STOCK';
  if (quantity.lte(minStock)) return 'LOW_STOCK';
  return 'OK';
}

export function wouldGoNegative(current: Decimal, delta: Decimal, allowNegative: boolean): boolean {
  return !allowNegative && delta.isNegative() && current.add(delta).isNegative();
}

export interface RecipeLine {
  inventoryItemId: string;
  quantity: Decimal;
}

export interface SoldLine {
  productId: string;
  quantity: number;
}

export interface ConsumptionLine {
  inventoryItemId: string;
  quantity: Decimal;
}

export function computeConsumption(sold: SoldLine[], recipes: Map<string, RecipeLine[]>): ConsumptionLine[] {
  const totals = new Map<string, Decimal>();
  for (const line of sold) {
    for (const ingredient of recipes.get(line.productId) ?? []) {
      const consumed = ingredient.quantity.mul(line.quantity);
      totals.set(ingredient.inventoryItemId, (totals.get(ingredient.inventoryItemId) ?? ZERO).add(consumed));
    }
  }
  return [...totals.entries()]
    .filter(([, quantity]) => quantity.gt(ZERO))
    .sort(([a], [b]) => compareIds(a, b))
    .map(([inventoryItemId, quantity]) => ({ inventoryItemId, quantity }));
}

export function compareIds(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function producibleUnits(recipe: RecipeLine[], balances: Map<string, Decimal>): number | null {
  if (recipe.length === 0) return null;
  let min: Decimal | null = null;
  for (const ingredient of recipe) {
    if (ingredient.quantity.lte(ZERO)) continue;
    const available = Decimal.max(balances.get(ingredient.inventoryItemId) ?? ZERO, ZERO);
    const units = available.div(ingredient.quantity).floor();
    min = min === null ? units : Decimal.min(min, units);
  }
  return min === null ? null : min.toNumber();
}

export function statusConsumesStock(status: string): boolean {
  return status !== 'PENDING' && status !== 'CANCELLED';
}

export type ExpiryStatus = 'EXPIRED' | 'EXPIRING_SOON' | 'OK';

export function daysUntil(date: Date, now: Date): number {
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const target = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.round((target - today) / DAY_MS);
}

export function expiryStatus(expiresAt: Date, now: Date, warningDays = EXPIRY_WARNING_DAYS): ExpiryStatus {
  const days = daysUntil(expiresAt, now);
  if (days < 0) return 'EXPIRED';
  if (days <= warningDays) return 'EXPIRING_SOON';
  return 'OK';
}

export interface StockEntry {
  id: string;
  quantity: Decimal;
  expiresAt: Date | null;
  lotCode: string | null;
}

export interface EntryOnHand extends StockEntry {
  onHand: Decimal;
}

export function estimateEntriesOnHand(balance: Decimal, entriesNewestFirst: StockEntry[]): EntryOnHand[] {
  let remaining = Decimal.max(balance, ZERO);
  const result: EntryOnHand[] = [];
  for (const entry of entriesNewestFirst) {
    if (remaining.lte(ZERO)) break;
    const onHand = Decimal.min(entry.quantity, remaining);
    remaining = remaining.sub(onHand);
    result.push({ ...entry, onHand });
  }
  return result;
}
