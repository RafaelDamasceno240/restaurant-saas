import {
  addDaysToDateOnly,
  describeReceivableEntry,
  formatDateOnly,
  formatSignedMoney,
  isDateOnly,
  isPaymentReversible,
  localDateOnly,
  receivableBadge,
  receivableErrorMessage,
  validatePayment,
  validateReason,
} from './receivables-logic';

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

describe('forms', () => {
  it('a reason has 3 to 200 characters', () => {
    expect(validateReason('  ab ')).toMatch(/mínimo 3/);
    expect(validateReason('abc')).toBeNull();
    expect(validateReason('x'.repeat(201))).toMatch(/até 200/);
  });

  it('a payment is positive and never above what is open', () => {
    expect(validatePayment('10,00', 1000)).toBeNull();
    expect(validatePayment('0,01', 1000)).toBeNull();
    expect(validatePayment('', 1000)).toMatch(/valor recebido/);
    expect(validatePayment('0', 1000)).toMatch(/valor recebido/);
    expect(brl(validatePayment('10,01', 1000) as string)).toBe('O valor é maior que o que está em aberto (R$ 10,00).');
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
    expect(receivableErrorMessage('ON_ACCOUNT_DISABLED', 'x')).toMatch(/fiado não é mais aceita/);
    expect(receivableErrorMessage('RECEIVABLE_HAS_PAYMENTS', 'x')).toMatch(/estorne/);
    expect(receivableErrorMessage('CASH_REGISTER_NOT_OPEN', 'Caixa fechado.')).toBe('Caixa fechado. (Menu: Caixa → Abrir caixa)');
    expect(receivableErrorMessage('SOMETHING_ELSE', 'Mensagem da API')).toBe('Mensagem da API');
    expect(receivableErrorMessage(undefined, 'Falhou')).toBe('Falhou');
  });
});
