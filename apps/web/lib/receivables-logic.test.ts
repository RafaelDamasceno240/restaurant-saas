import {
  addDaysToDateOnly,
  addMonthsToDateOnly,
  creditBlockReason,
  defaultTerms,
  describeReceivableEntry,
  formatDateOnly,
  formatSignedMoney,
  isDateOnly,
  isPaymentReversible,
  localDateOnly,
  parseLimit,
  previewInstallments,
  receivableBadge,
  receivableErrorMessage,
  validateCharge,
  validatePayment,
  validateReason,
  validateTerms,
} from './receivables-logic';

const TODAY = '2026-10-05';
// Non-breaking space that pt-BR puts between "R$" and the number.
const brl = (text: string) => text.replace(/ /g, ' ');

describe('calendar days', () => {
  it('recognises real days only', () => {
    expect(isDateOnly('2026-10-05')).toBe(true);
    expect(isDateOnly('2028-02-29')).toBe(true);
    expect(isDateOnly('2026-02-30')).toBe(false);
    expect(isDateOnly('2026-13-01')).toBe(false);
    expect(isDateOnly('05/10/2026')).toBe(false);
    expect(isDateOnly('')).toBe(false);
  });

  it('formats as text, never through a time zone', () => {
    expect(formatDateOnly('2026-11-05')).toBe('05/11/2026');
    expect(formatDateOnly('2026-01-01')).toBe('01/01/2026');
    expect(formatDateOnly(null)).toBe('—');
    expect(formatDateOnly('garbage')).toBe('—');
  });

  it('the device day is built from local fields', () => {
    expect(localDateOnly(new Date(2026, 0, 9, 23, 59))).toBe('2026-01-09');
    expect(localDateOnly(new Date(2026, 11, 31, 0, 0))).toBe('2026-12-31');
  });

  it('adds days across months and years', () => {
    expect(addDaysToDateOnly('2026-10-05', 30)).toBe('2026-11-04');
    expect(addDaysToDateOnly('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDaysToDateOnly('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('adds months clamping to the last day of the month', () => {
    expect(addMonthsToDateOnly('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonthsToDateOnly('2026-01-31', 2)).toBe('2026-03-31');
    expect(addMonthsToDateOnly('2026-11-15', 2)).toBe('2027-01-15');
    expect(addMonthsToDateOnly('2028-01-30', 1)).toBe('2028-02-29');
  });
});

describe('receivableBadge', () => {
  it('says what state the receivable is in, overdue first', () => {
    expect(receivableBadge({ status: 'OPEN', overdue: false, daysOverdue: 0 })).toEqual({ label: 'Em aberto', tone: 'warning' });
    expect(receivableBadge({ status: 'OPEN', overdue: true, daysOverdue: 1 })).toEqual({ label: 'Vencida há 1 dia', tone: 'danger' });
    expect(receivableBadge({ status: 'OPEN', overdue: true, daysOverdue: 12 })).toEqual({ label: 'Vencida há 12 dias', tone: 'danger' });
    expect(receivableBadge({ status: 'PAID', overdue: false, daysOverdue: 0 })).toEqual({ label: 'Quitada', tone: 'success' });
    expect(receivableBadge({ status: 'CANCELLED', overdue: false, daysOverdue: 0 })).toEqual({ label: 'Cancelada', tone: 'neutral' });
  });
});

describe('terms of a sale on account', () => {
  it('defaults to one installment in 30 days', () => {
    expect(defaultTerms(TODAY)).toEqual({ installments: 1, firstDueDate: '2026-11-04' });
  });

  it('accepts sane terms and explains the others', () => {
    expect(validateTerms({ installments: 1, firstDueDate: TODAY }, 4000, TODAY)).toBeNull();
    expect(validateTerms({ installments: 12, firstDueDate: '2027-10-05' }, 4000, TODAY)).toBeNull();
    expect(validateTerms({ installments: 0, firstDueDate: TODAY }, 4000, TODAY)).toMatch(/1 a 12/);
    expect(validateTerms({ installments: 13, firstDueDate: TODAY }, 4000, TODAY)).toMatch(/1 a 12/);
    expect(validateTerms({ installments: 1.5, firstDueDate: TODAY }, 4000, TODAY)).toMatch(/1 a 12/);
    expect(validateTerms({ installments: 1, firstDueDate: '' }, 4000, TODAY)).toMatch(/primeiro vencimento/);
    expect(validateTerms({ installments: 1, firstDueDate: '2026-10-04' }, 4000, TODAY)).toMatch(/passado/);
    expect(validateTerms({ installments: 1, firstDueDate: '2027-10-06' }, 4000, TODAY)).toMatch(/1 ano/);
    expect(validateTerms({ installments: 6, firstDueDate: TODAY }, 5, TODAY)).toMatch(/pequeno/);
  });

  it('previews equal installments, leftover cents first, monthly', () => {
    expect(previewInstallments(10_000, { installments: 3, firstDueDate: '2026-01-31' })).toEqual([
      { number: 1, dueDate: '2026-01-31', amountCents: 3334 },
      { number: 2, dueDate: '2026-02-28', amountCents: 3333 },
      { number: 3, dueDate: '2026-03-31', amountCents: 3333 },
    ]);
    const plan = previewInstallments(20_000, { installments: 3, firstDueDate: TODAY });
    expect(plan.map((item) => item.amountCents)).toEqual([6667, 6667, 6666]);
    expect(plan.reduce((total, item) => total + item.amountCents, 0)).toBe(20_000);
    expect(previewInstallments(0, { installments: 3, firstDueDate: TODAY })).toEqual([]);
    expect(previewInstallments(1000, { installments: 2, firstDueDate: 'x' })).toEqual([]);
  });

  it('explains why a customer cannot buy on account', () => {
    const account = { customerId: 'c', creditLimitCents: 10_000, balanceCents: 4_000, availableCents: 6_000, overdueCents: 0, canBuyOnAccount: true };
    expect(creditBlockReason(account, 6_000)).toBeNull();
    expect(brl(creditBlockReason(account, 6_001) as string)).toBe('Limite insuficiente: disponível R$ 60,00 de R$ 100,00.');
    expect(creditBlockReason({ ...account, creditLimitCents: 0, availableCents: 0 }, 100)).toMatch(/não tem limite/);
    expect(brl(creditBlockReason({ ...account, overdueCents: 1_500 }, 100) as string)).toMatch(/R\$ 15,00 em atraso/);
  });
});

describe('forms', () => {
  it('a reason has 3 to 200 characters', () => {
    expect(validateReason('  ab ')).toMatch(/mínimo 3/);
    expect(validateReason('abc')).toBeNull();
    expect(validateReason('x'.repeat(201))).toMatch(/até 200/);
  });

  it('parses the credit limit, empty meaning none', () => {
    expect(parseLimit('')).toBe(0);
    expect(parseLimit('0')).toBe(0);
    expect(parseLimit('150,50')).toBe(15_050);
    expect(parseLimit('-1')).toBeNull();
    expect(parseLimit('abc')).toBeNull();
    expect(parseLimit('20000000,00')).toBe(2_000_000_000);
    expect(parseLimit('20000000,01')).toBeNull();
  });

  it('a payment is positive and never above what is open', () => {
    expect(validatePayment('10,00', 1000)).toBeNull();
    expect(validatePayment('0,01', 1000)).toBeNull();
    expect(validatePayment('', 1000)).toMatch(/valor recebido/);
    expect(validatePayment('0', 1000)).toMatch(/valor recebido/);
    expect(brl(validatePayment('10,01', 1000) as string)).toBe('O valor é maior que o que está em aberto (R$ 10,00).');
  });

  it('validates a manual charge', () => {
    const draft = { description: 'Saldo do caderno', amount: '120,00', installments: 2, firstDueDate: '2026-11-05' };
    expect(validateCharge(draft, true, TODAY)).toBeNull();
    expect(validateCharge(draft, false, TODAY)).toMatch(/cliente/);
    expect(validateCharge({ ...draft, description: ' x ' }, true, TODAY)).toMatch(/Descreva/);
    expect(validateCharge({ ...draft, amount: '0' }, true, TODAY)).toMatch(/valor da dívida/);
    expect(validateCharge({ ...draft, firstDueDate: '2026-10-01' }, true, TODAY)).toMatch(/passado/);
  });
});

describe('history', () => {
  it('describes each movement', () => {
    expect(describeReceivableEntry({ type: 'CHARGE', paymentMethod: null, reason: null, allocations: [] })).toBe('Dívida lançada');
    expect(
      describeReceivableEntry({ type: 'PAYMENT', paymentMethod: 'PIX', reason: null, allocations: [{ installmentNumber: 1, amountCents: 100 }] }),
    ).toBe('Pix · parcela 1');
    expect(
      describeReceivableEntry({
        type: 'PAYMENT',
        paymentMethod: 'CASH',
        reason: null,
        allocations: [
          { installmentNumber: 1, amountCents: 100 },
          { installmentNumber: 2, amountCents: 50 },
        ],
      }),
    ).toBe('Dinheiro · parcelas 1, 2');
    expect(describeReceivableEntry({ type: 'REVERSAL', paymentMethod: null, reason: 'Pix devolvido', allocations: [] })).toBe('Pix devolvido');
  });

  it('only a live payment can be reversed', () => {
    expect(isPaymentReversible({ type: 'PAYMENT', reversed: false })).toBe(true);
    expect(isPaymentReversible({ type: 'PAYMENT', reversed: true })).toBe(false);
    expect(isPaymentReversible({ type: 'CHARGE', reversed: false })).toBe(false);
    expect(isPaymentReversible({ type: 'REVERSAL', reversed: false })).toBe(false);
  });

  it('signs money from the debt point of view', () => {
    expect(brl(formatSignedMoney(3000))).toBe('+R$ 30,00');
    expect(brl(formatSignedMoney(-3000))).toBe('−R$ 30,00');
  });
});

describe('receivableErrorMessage', () => {
  it('translates known codes and keeps the API message otherwise', () => {
    expect(receivableErrorMessage('RECEIVABLE_LIMIT_EXCEEDED', 'x')).toMatch(/limite/);
    expect(receivableErrorMessage('RECEIVABLE_CUSTOMER_OVERDUE', 'x')).toMatch(/vencida/);
    expect(receivableErrorMessage('RECEIVABLE_HAS_PAYMENTS', 'x')).toMatch(/estorne/);
    expect(receivableErrorMessage('CASH_REGISTER_NOT_OPEN', 'Caixa fechado.')).toBe('Caixa fechado. (Menu: Caixa → Abrir caixa)');
    expect(receivableErrorMessage('SOMETHING_ELSE', 'Mensagem da API')).toBe('Mensagem da API');
    expect(receivableErrorMessage(undefined, 'Falhou')).toBe('Falhou');
  });
});
