import { computeCashTotals, computeDifferenceCents, computeExpectedBalanceCents } from './cash-calculations';

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

  it('handles an empty session', () => {
    const totals = computeCashTotals([]);
    expect(computeExpectedBalanceCents(0, totals)).toBe(0);
  });
});
