import {
  allocatePayment,
  InstallmentState,
  isInstallmentOverdue,
  summarizeInstallments,
} from './receivable-calculations';

const installment = (number: number, dueDate: string, amountCents: number, paidCents = 0): InstallmentState => ({
  id: `i${number}`,
  number,
  dueDate,
  amountCents,
  paidCents,
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
