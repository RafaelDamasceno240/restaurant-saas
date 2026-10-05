import {
  allocatePayment,
  availableCreditCents,
  buildInstallmentPlan,
  InstallmentState,
  isInstallmentOverdue,
  splitAmount,
  summarizeInstallments,
  validateTerms,
} from './receivable-calculations';

const installment = (number: number, dueDate: string, amountCents: number, paidCents = 0): InstallmentState => ({
  id: `i${number}`,
  number,
  dueDate,
  amountCents,
  paidCents,
});

describe('splitAmount', () => {
  it('splits in equal whole cents and gives the leftover cents to the first installments', () => {
    expect(splitAmount(1000, 1)).toEqual([1000]);
    expect(splitAmount(1000, 3)).toEqual([334, 333, 333]);
    expect(splitAmount(1001, 3)).toEqual([334, 334, 333]);
    expect(splitAmount(12_000, 12)).toEqual(Array(12).fill(1000));
  });

  it('always adds up to the total, to the cent', () => {
    for (const total of [1, 7, 99, 100, 101, 2599, 100_000, 1_999_999]) {
      for (let count = 1; count <= 12; count++) {
        if (total < count) continue;
        const parts = splitAmount(total, count);
        expect(parts.reduce((sum, part) => sum + part, 0)).toBe(total);
        expect(Math.max(...parts) - Math.min(...parts)).toBeLessThanOrEqual(1);
        expect(parts.every((part) => Number.isInteger(part) && part >= 1)).toBe(true);
      }
    }
  });

  it('refuses a split that would leave an installment without a cent, and broken input', () => {
    expect(() => splitAmount(2, 3)).toThrow(RangeError);
    expect(() => splitAmount(100, 0)).toThrow(RangeError);
    expect(() => splitAmount(100.5, 2)).toThrow(RangeError);
  });
});

describe('buildInstallmentPlan', () => {
  it('schedules one installment per month from the first due date', () => {
    expect(buildInstallmentPlan(1000, 3, '2026-10-10')).toEqual([
      { number: 1, dueDate: '2026-10-10', amountCents: 334 },
      { number: 2, dueDate: '2026-11-10', amountCents: 333 },
      { number: 3, dueDate: '2026-12-10', amountCents: 333 },
    ]);
  });

  it('clamps to the end of shorter months without drifting', () => {
    const plan = buildInstallmentPlan(4000, 4, '2026-12-31');
    expect(plan.map((item) => item.dueDate)).toEqual(['2026-12-31', '2027-01-31', '2027-02-28', '2027-03-31']);
  });
});

describe('validateTerms', () => {
  const today = '2026-10-04';
  const terms = (extra: Partial<Parameters<typeof validateTerms>[0]> = {}) =>
    validateTerms({ totalCents: 10_000, installments: 2, firstDueDate: '2026-11-04', today, ...extra });

  it('accepts sensible terms, including due today and due in exactly one year', () => {
    expect(terms()).toBeNull();
    expect(terms({ firstDueDate: today })).toBeNull();
    expect(terms({ firstDueDate: '2027-10-04' })).toBeNull();
    expect(terms({ installments: 12 })).toBeNull();
  });

  it('names what is wrong', () => {
    expect(terms({ installments: 0 })).toBe('INSTALLMENTS_RANGE');
    expect(terms({ installments: 13 })).toBe('INSTALLMENTS_RANGE');
    expect(terms({ installments: 1.5 })).toBe('INSTALLMENTS_RANGE');
    expect(terms({ firstDueDate: '2026-02-30' })).toBe('DUE_DATE_INVALID');
    expect(terms({ firstDueDate: '2026-10-03' })).toBe('DUE_DATE_PAST');
    expect(terms({ firstDueDate: '2027-10-05' })).toBe('DUE_DATE_TOO_FAR');
    expect(terms({ totalCents: 5, installments: 6 })).toBe('AMOUNT_TOO_SMALL');
  });
});

describe('allocatePayment', () => {
  const plan = [installment(1, '2026-10-10', 400), installment(2, '2026-11-10', 300), installment(3, '2026-12-10', 300)];

  it('pays the installment that is due first, then the next ones', () => {
    expect(allocatePayment(plan, 400)).toEqual([{ installmentId: 'i1', amountCents: 400 }]);
    expect(allocatePayment(plan, 550)).toEqual([
      { installmentId: 'i1', amountCents: 400 },
      { installmentId: 'i2', amountCents: 150 },
    ]);
    expect(allocatePayment(plan, 1000)?.map((a) => a.amountCents)).toEqual([400, 300, 300]);
  });

  it('accepts a partial payment and continues from what is already paid', () => {
    expect(allocatePayment(plan, 1)).toEqual([{ installmentId: 'i1', amountCents: 1 }]);
    const partlyPaid = [installment(1, '2026-10-10', 400, 250), installment(2, '2026-11-10', 300)];
    expect(allocatePayment(partlyPaid, 200)).toEqual([
      { installmentId: 'i1', amountCents: 150 },
      { installmentId: 'i2', amountCents: 50 },
    ]);
  });

  it('never accepts more than what is open', () => {
    expect(allocatePayment(plan, 1001)).toBeNull();
    expect(allocatePayment([installment(1, '2026-10-10', 400, 400)], 1)).toBeNull();
  });

  it('can target one installment, limited to what that installment owes', () => {
    expect(allocatePayment(plan, 300, 'i3')).toEqual([{ installmentId: 'i3', amountCents: 300 }]);
    expect(allocatePayment(plan, 301, 'i3')).toBeNull();
    expect(allocatePayment(plan, 100, 'unknown')).toBeNull();
  });

  it('orders by due date, not by number, and rejects zero or fractional amounts', () => {
    const outOfOrder = [installment(1, '2026-12-10', 100), installment(2, '2026-10-10', 100)];
    expect(allocatePayment(outOfOrder, 100)).toEqual([{ installmentId: 'i2', amountCents: 100 }]);
    expect(allocatePayment(plan, 0)).toBeNull();
    expect(allocatePayment(plan, 10.5)).toBeNull();
  });
});

describe('overdue', () => {
  it('is late only after the due date, and only while something is owed', () => {
    expect(isInstallmentOverdue(installment(1, '2026-10-04', 100), '2026-10-04')).toBe(false);
    expect(isInstallmentOverdue(installment(1, '2026-10-04', 100), '2026-10-05')).toBe(true);
    expect(isInstallmentOverdue(installment(1, '2026-10-04', 100, 100), '2026-12-01')).toBe(false);
    expect(isInstallmentOverdue(installment(1, '2026-10-04', 100, 99), '2026-12-01')).toBe(true);
  });

  it('summarizes what is open, what is late and since when', () => {
    const plan = [installment(1, '2026-09-10', 400, 400), installment(2, '2026-09-20', 300, 100), installment(3, '2026-11-10', 300)];
    expect(summarizeInstallments(plan, '2026-10-04')).toEqual({ openCents: 500, overdueCents: 200, nextDueDate: '2026-09-20', daysOverdue: 14 });
    expect(summarizeInstallments(plan, '2026-09-20')).toEqual({ openCents: 500, overdueCents: 0, nextDueDate: '2026-09-20', daysOverdue: 0 });
    expect(summarizeInstallments([installment(1, '2026-09-10', 400, 400)], '2026-10-04')).toEqual({ openCents: 0, overdueCents: 0, nextDueDate: null, daysOverdue: 0 });
  });
});

describe('availableCreditCents', () => {
  it('is the limit minus the debt, never negative', () => {
    expect(availableCreditCents(50_000, 12_000)).toBe(38_000);
    expect(availableCreditCents(50_000, 50_000)).toBe(0);
    expect(availableCreditCents(10_000, 12_000)).toBe(0);
    expect(availableCreditCents(0, 0)).toBe(0);
  });
});
