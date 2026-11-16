import { CashMovementType } from '@prisma/client';

export interface CashTotals {
  salesCents: number;
  suppliesCents: number;
  withdrawalsCents: number;
  // Fiado paid in cash (money in) and cash payments of fiado that were reversed (money out).
  receivablePaymentsCents: number;
  receivableRefundsCents: number;
  // Cash sales that were cancelled and given back (money out). salesCents stays gross.
  saleRefundsCents: number;
}

// Pure, integer-cents-only. amountCents is always positive in storage; the
// sign is decided HERE by type, in exactly one place.
export function computeCashTotals(
  movements: { type: CashMovementType; amountCents: number }[],
): CashTotals {
  const totals: CashTotals = {
    salesCents: 0,
    suppliesCents: 0,
    withdrawalsCents: 0,
    receivablePaymentsCents: 0,
    receivableRefundsCents: 0,
    saleRefundsCents: 0,
  };
  for (const m of movements) {
    if (m.type === 'SALE') totals.salesCents += m.amountCents;
    else if (m.type === 'SUPPLY') totals.suppliesCents += m.amountCents;
    else if (m.type === 'WITHDRAWAL') totals.withdrawalsCents += m.amountCents;
    else if (m.type === 'RECEIVABLE_PAYMENT') totals.receivablePaymentsCents += m.amountCents;
    else if (m.type === 'RECEIVABLE_REFUND') totals.receivableRefundsCents += m.amountCents;
    else if (m.type === 'SALE_REFUND') totals.saleRefundsCents += m.amountCents;
  }
  return totals;
}

// expected = opening + SUPPLY + SALE + RECEIVABLE_PAYMENT - WITHDRAWAL - RECEIVABLE_REFUND - SALE_REFUND
export function computeExpectedBalanceCents(openingBalanceCents: number, totals: CashTotals): number {
  return (
    openingBalanceCents +
    totals.suppliesCents +
    totals.salesCents +
    totals.receivablePaymentsCents -
    totals.withdrawalsCents -
    totals.receivableRefundsCents -
    totals.saleRefundsCents
  );
}

// B4 (piloto 2026-10-23): a sangria takes out money that must be in the drawer. Up to the
// expected balance is allowed (emptying the drawer is a legitimate move); a cent more is not.
// A drawer whose expected balance is already zero or negative accepts no sangria at all.
export function withdrawalExceedsBalance(amountCents: number, expectedBalanceCents: number): boolean {
  return amountCents > Math.max(0, expectedBalanceCents);
}

// difference = counted - expected (positive = sobra, negative = falta)
export function computeDifferenceCents(countedCents: number, expectedCents: number): number {
  return countedCents - expectedCents;
}
