import {
  computeCashTotals,
  computeDifferenceCents,
  computeExpectedBalanceCents,
  withdrawalExceedsBalance,
} from './cash-calculations';

describe('cash-calculations', () => {
  const movements = [
    { type: 'SALE' as const, amountCents: 2490 },
    { type: 'SALE' as const, amountCents: 1200 },
    { type: 'SUPPLY' as const, amountCents: 5000 },
    { type: 'WITHDRAWAL' as const, amountCents: 3000 },
  ];

  it('sums each movement type separately', () => {
    expect(computeCashTotals(movements)).toEqual({
      salesCents: 3690,
      suppliesCents: 5000,
      withdrawalsCents: 3000,
      receivablePaymentsCents: 0,
      receivableRefundsCents: 0,
      saleRefundsCents: 0,
    });
  });

  it('computes expected = opening + supply + sale - withdrawal', () => {
    const totals = computeCashTotals(movements);
    expect(computeExpectedBalanceCents(10000, totals)).toBe(10000 + 5000 + 3690 - 3000);
  });

  it('computes positive, negative and zero differences', () => {
    expect(computeDifferenceCents(15700, 15690)).toBe(10);
    expect(computeDifferenceCents(15600, 15690)).toBe(-90);
    expect(computeDifferenceCents(15690, 15690)).toBe(0);
  });

  it('counts fiado received in cash as money in and its reversal as money out', () => {
    const withFiado = [
      ...movements,
      { type: 'RECEIVABLE_PAYMENT' as const, amountCents: 4000 },
      { type: 'RECEIVABLE_PAYMENT' as const, amountCents: 1500 },
      { type: 'RECEIVABLE_REFUND' as const, amountCents: 1500 },
    ];
    const totals = computeCashTotals(withFiado);
    expect(totals).toMatchObject({ salesCents: 3690, receivablePaymentsCents: 5500, receivableRefundsCents: 1500 });
    expect(computeExpectedBalanceCents(10000, totals)).toBe(10000 + 5000 + 3690 - 3000 + 5500 - 1500);
  });

  it('keeps cash sales gross and takes a cancelled sale out of the expected balance', () => {
    const withRefund = [...movements, { type: 'SALE_REFUND' as const, amountCents: 1200 }];
    const totals = computeCashTotals(withRefund);
    expect(totals).toMatchObject({ salesCents: 3690, saleRefundsCents: 1200, withdrawalsCents: 3000 });
    expect(computeExpectedBalanceCents(10000, totals)).toBe(10000 + 5000 + 3690 - 3000 - 1200);
  });

  it('a sale and its refund cancel out', () => {
    const totals = computeCashTotals([
      { type: 'SALE' as const, amountCents: 4000 },
      { type: 'SALE_REFUND' as const, amountCents: 4000 },
    ]);
    expect(computeExpectedBalanceCents(10000, totals)).toBe(10000);
  });

  it('handles an empty session', () => {
    const totals = computeCashTotals([]);
    expect(computeExpectedBalanceCents(0, totals)).toBe(0);
  });
});

describe('withdrawalExceedsBalance (B4)', () => {
  it('allows a sangria smaller than or equal to the money in the drawer', () => {
    expect(withdrawalExceedsBalance(5000, 17270)).toBe(false);
    expect(withdrawalExceedsBalance(17270, 17270)).toBe(false);
  });

  it('refuses one cent above the balance, and the R$ 10.000 of the pilot', () => {
    expect(withdrawalExceedsBalance(17271, 17270)).toBe(true);
    expect(withdrawalExceedsBalance(1000000, 17270)).toBe(true);
  });

  it('refuses any sangria from an empty drawer or one already in the negative', () => {
    expect(withdrawalExceedsBalance(1, 0)).toBe(true);
    expect(withdrawalExceedsBalance(1, -500)).toBe(true);
  });
});
