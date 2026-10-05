import { CashMovementType } from '@prisma/client';

export interface CashTotals {
  salesCents: number;
  suppliesCents: number;
  withdrawalsCents: number;
  // Fiado paid in cash (money in) and cash payments of fiado that were reversed (money out).
  receivablePaymentsCents: number;
  receivableRefundsCents: number;
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
  };
  for (const m of movements) {
    if (m.type === 'SALE') totals.salesCents += m.amountCents;
    else if (m.type === 'SUPPLY') totals.suppliesCents += m.amountCents;
    else if (m.type === 'WITHDRAWAL') totals.withdrawalsCents += m.amountCents;
    else if (m.type === 'RECEIVABLE_PAYMENT') totals.receivablePaymentsCents += m.amountCents;
    else if (m.type === 'RECEIVABLE_REFUND') totals.receivableRefundsCents += m.amountCents;
  }
  return totals;
}

// expected = opening + SUPPLY + SALE + RECEIVABLE_PAYMENT - WITHDRAWAL - RECEIVABLE_REFUND
export function computeExpectedBalanceCents(openingBalanceCents: number, totals: CashTotals): number {
  return (
    openingBalanceCents +
    totals.suppliesCents +
    totals.salesCents +
    totals.receivablePaymentsCents -
    totals.withdrawalsCents -
    totals.receivableRefundsCents
  );
}

// difference = counted - expected (positive = sobra, negative = falta)
export function computeDifferenceCents(countedCents: number, expectedCents: number): number {
  return countedCents - expectedCents;
}
