import {
  cashbackAdjustCents,
  cashbackErrorMessage,
  describeCashbackEntry,
  describeProgram,
  draftToProgram,
  EMPTY_CASHBACK_ADJUST,
  formatRate,
  formatSignedCents,
  isCashbackReversible,
  isProgramDirty,
  maxUsableCashbackCents,
  parseCashbackToUse,
  parseExpireDays,
  parseRateToBps,
  rateToInput,
  toProgramDraft,
  validateCashbackAdjust,
  validateCashbackToUse,
  validateProgramDraft,
} from './cashback-logic';

const nbsp = (text: string) => text.replace(/ /g, ' ');

describe('formatting', () => {
  it('shows the sign of a movement in reais', () => {
    expect(nbsp(formatSignedCents(800))).toBe('+R$ 8,00');
    expect(nbsp(formatSignedCents(-1250))).toBe('−R$ 12,50');
  });

  it('writes the rate as a percentage', () => {
    expect(formatRate(500)).toBe('5%');
    expect(formatRate(250)).toBe('2,5%');
    expect(formatRate(333)).toBe('3,33%');
    expect(formatRate(1)).toBe('0,01%');
  });

  it('describes the program in one line', () => {
    expect(describeProgram({ enabled: true, earnRateBps: 500, expireAfterDays: null })).toBe('5% do valor pago nos itens; o saldo não expira');
    expect(describeProgram({ enabled: true, earnRateBps: 250, expireAfterDays: 90 })).toMatch(/2,5%.*expira após 90 dia/);
  });
});

describe('rate and expiration fields', () => {
  it('reads a percentage with up to two decimals as basis points', () => {
    expect(parseRateToBps('5')).toBe(500);
    expect(parseRateToBps('2,5')).toBe(250);
    expect(parseRateToBps('3.33')).toBe(333);
    expect(parseRateToBps(' 10% ')).toBe(1000);
    expect(parseRateToBps('0,01')).toBe(1);
    expect(parseRateToBps('50')).toBe(5000);
  });

  it('rejects zero, more than 50%, three decimals and text', () => {
    for (const bad of ['', '0', '0,00', '50,01', '51', '100', '2,555', '-5', 'cinco', '1e2']) {
      expect(parseRateToBps(bad)).toBeNull();
    }
  });

  it('round-trips what is shown in the field', () => {
    for (const bps of [1, 50, 250, 333, 500, 1000, 5000]) expect(parseRateToBps(rateToInput(bps))).toBe(bps);
  });

  it('an empty expiration means "never"; otherwise a whole number of days', () => {
    expect(parseExpireDays('')).toBeNull();
    expect(parseExpireDays(' 90 ')).toBe(90);
    for (const bad of ['0', '3651', '1,5', 'abc', '-3']) expect(parseExpireDays(bad)).toBeUndefined();
  });

  it('validates and converts the whole form', () => {
    expect(validateProgramDraft({ enabled: true, rate: '', expireDays: '' })).toMatch(/percentual/);
    expect(validateProgramDraft({ enabled: true, rate: '5', expireDays: 'x' })).toMatch(/dias/);
    expect(validateProgramDraft({ enabled: true, rate: '5', expireDays: '' })).toBeNull();
    expect(draftToProgram({ enabled: true, rate: '2,5', expireDays: '60' })).toEqual({ enabled: true, earnRateBps: 250, expireAfterDays: 60 });
  });

  it('knows when the form differs from what is stored', () => {
    const stored = { enabled: true, earnRateBps: 500, expireAfterDays: null };
    expect(isProgramDirty(toProgramDraft(stored), stored)).toBe(false);
    expect(isProgramDirty({ enabled: true, rate: '5,0', expireDays: '' }, stored)).toBe(false);
    expect(isProgramDirty({ enabled: false, rate: '5', expireDays: '' }, stored)).toBe(true);
    expect(isProgramDirty({ enabled: true, rate: '6', expireDays: '' }, stored)).toBe(true);
    expect(isProgramDirty({ enabled: true, rate: '5', expireDays: '30' }, stored)).toBe(true);
  });
});

describe('using cashback on a sale', () => {
  it('is limited by the balance and by the items after the coupon', () => {
    expect(maxUsableCashbackCents(5000, 1200)).toBe(1200);
    expect(maxUsableCashbackCents(5000, 9000)).toBe(5000);
    expect(maxUsableCashbackCents(0, 9000)).toBe(0);
    expect(maxUsableCashbackCents(5000, 0)).toBe(0);
  });

  it('reads what the cashier typed', () => {
    expect(parseCashbackToUse('')).toBe(0);
    expect(parseCashbackToUse('12,50')).toBe(1250);
    expect(parseCashbackToUse('abc')).toBeNull();
  });

  it('refuses more than the maximum of the sale', () => {
    expect(validateCashbackToUse('', 1000)).toBeNull();
    expect(validateCashbackToUse('10,00', 1000)).toBeNull();
    expect(nbsp(validateCashbackToUse('10,01', 1000) as string)).toBe('O máximo que pode ser usado nesta venda é R$ 10,00.');
    expect(validateCashbackToUse('x', 1000)).toMatch(/válido/);
  });
});

describe('manual adjustment', () => {
  it('needs an amount and a reason, and refuses a debit above the balance', () => {
    expect(validateCashbackAdjust(EMPTY_CASHBACK_ADJUST, 1000)).toMatch(/valor/);
    expect(validateCashbackAdjust({ direction: 'credit', amount: '5,00', reason: '' }, 1000)).toMatch(/motivo/);
    expect(validateCashbackAdjust({ direction: 'debit', amount: '10,01', reason: 'Correção' }, 1000)).toMatch(/maior que o saldo/);
    expect(validateCashbackAdjust({ direction: 'debit', amount: '10,00', reason: 'Correção' }, 1000)).toBeNull();
    expect(validateCashbackAdjust({ direction: 'credit', amount: '999,00', reason: 'Cortesia' }, 0)).toBeNull();
  });

  it('sends a debit as negative cents', () => {
    expect(cashbackAdjustCents({ direction: 'credit', amount: '5,50', reason: 'x' })).toBe(550);
    expect(cashbackAdjustCents({ direction: 'debit', amount: '5,50', reason: 'x' })).toBe(-550);
  });
});

describe('statement', () => {
  it('describes each movement by what it refers to', () => {
    expect(describeCashbackEntry({ type: 'EARN', orderNumber: 'ABC-1', reason: null })).toBe('Pedido ABC-1');
    expect(describeCashbackEntry({ type: 'USE', orderNumber: 'ABC-2', reason: null })).toBe('Pedido ABC-2');
    expect(describeCashbackEntry({ type: 'ADJUSTMENT', orderNumber: null, reason: 'Cortesia' })).toBe('Cortesia');
    expect(describeCashbackEntry({ type: 'REVERSAL', orderNumber: 'ABC-2', reason: 'Pedido cancelado' })).toBe('Pedido cancelado (ABC-2)');
    expect(describeCashbackEntry({ type: 'EXPIRATION', orderNumber: null, reason: null })).toBe('Saldo sem movimentação');
  });

  it('offers a reversal only for a credit by purchase or an adjustment not yet reversed', () => {
    expect(isCashbackReversible({ type: 'EARN', reversed: false })).toBe(true);
    expect(isCashbackReversible({ type: 'ADJUSTMENT', reversed: false })).toBe(true);
    expect(isCashbackReversible({ type: 'ADJUSTMENT', reversed: true })).toBe(false);
    for (const type of ['USE', 'REVERSAL', 'EXPIRATION'] as const) expect(isCashbackReversible({ type, reversed: false })).toBe(false);
  });

  it('maps API error codes to readable text and keeps unknown messages', () => {
    expect(cashbackErrorMessage('CASHBACK_INSUFFICIENT_BALANCE', 'x')).toMatch(/insuficiente/);
    expect(cashbackErrorMessage('CASHBACK_ENTRY_NOT_REVERSIBLE', 'mensagem da API')).toBe('mensagem da API');
    expect(cashbackErrorMessage('OUTRO', 'mensagem da API')).toBe('mensagem da API');
  });
});
