import { Decimal, lineCostCents } from '../inventory/inventory-calculations';
import { purchaseAmountTooLarge } from './purchase-errors';

// Money columns are 32-bit INTEGER cents; anything above this cannot be stored.
export const MAX_AMOUNT_CENTS = 2_147_483_647;

export interface PurchaseLineInput {
  quantity: Decimal;
  unitCostCents: number;
}

export interface PurchaseAdjustments {
  discountCents: number;
  freightCents: number;
  otherCostsCents: number;
}

export interface PurchaseTotals {
  lineTotals: number[];
  subtotalCents: number;
  totalCents: number;
}

export function computePurchaseTotals(lines: PurchaseLineInput[], adjustments: PurchaseAdjustments): PurchaseTotals {
  const lineTotals = lines.map((line) => lineCostCents(line.quantity, line.unitCostCents));
  const subtotalCents = lineTotals.reduce((sum, value) => sum + value, 0);
  const totalCents = subtotalCents - adjustments.discountCents + adjustments.freightCents + adjustments.otherCostsCents;
  return { lineTotals, subtotalCents, totalCents };
}

// Domain guard run before anything is persisted, so an out-of-range amount is a
// clean 400 instead of a database/driver error (and never consumes a number).
export function assertTotalsWithinLimit(totals: PurchaseTotals): void {
  if (totals.lineTotals.some((value) => value > MAX_AMOUNT_CENTS)) throw purchaseAmountTooLarge('line');
  if (totals.subtotalCents > MAX_AMOUNT_CENTS) throw purchaseAmountTooLarge('subtotal');
  if (totals.totalCents > MAX_AMOUNT_CENTS) throw purchaseAmountTooLarge('total');
}
