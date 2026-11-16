import {
  adjustPoints,
  canAfford,
  describeEntry,
  describeRate,
  EMPTY_ADJUST,
  EMPTY_REWARD,
  formatPoints,
  formatSignedPoints,
  isReversible,
  loyaltyErrorMessage,
  parsePositiveInt,
  toRewardDraft,
  validateAdjust,
  validateProgram,
  validateReason,
  validateReward,
} from './loyalty-logic';

describe('formatting', () => {
  it('writes points in the singular and the plural, with thousands separators', () => {
    expect(formatPoints(1)).toBe('1 ponto');
    expect(formatPoints(0)).toBe('0 pontos');
    expect(formatPoints(1500)).toBe('1.500 pontos');
    expect(formatPoints(-40)).toBe('40 pontos');
  });

  it('shows the sign of a movement', () => {
    expect(formatSignedPoints(25)).toBe('+25');
    expect(formatSignedPoints(-40)).toBe('−40');
  });

  it('describes the earning rate', () => {
    expect(describeRate(1)).toBe('R$ 1,00 = 1 ponto');
    expect(describeRate(3)).toBe('R$ 1,00 = 3 pontos');
  });

  it('describes each kind of movement by what it refers to', () => {
    expect(describeEntry({ type: 'EARN', orderNumber: 'ABC-123', reward: null, reason: null })).toBe('Pedido ABC-123');
    expect(describeEntry({ type: 'REDEEM', orderNumber: null, reward: { id: 'r', name: 'Sobremesa' }, reason: null })).toBe('Sobremesa');
    expect(describeEntry({ type: 'ADJUSTMENT', orderNumber: null, reward: null, reason: 'Cortesia' })).toBe('Cortesia');
    expect(describeEntry({ type: 'REVERSAL', orderNumber: null, reward: null, reason: 'Cliente errado' })).toBe('Cliente errado');
    expect(describeEntry({ type: 'REDEEM', orderNumber: null, reward: null, reason: null })).toBe('Recompensa');
  });
});

describe('parsePositiveInt', () => {
  it('accepts only whole positive numbers', () => {
    expect(parsePositiveInt(' 25 ')).toBe(25);
    for (const bad of ['', '0', '-5', '2.5', '2,5', '1e3', 'abc', '10 pontos', '99999999999999999999']) {
      expect(parsePositiveInt(bad)).toBeNull();
    }
  });
});

describe('program and reward forms', () => {
  it('validates the points per real', () => {
    expect(validateProgram('1')).toBeNull();
    expect(validateProgram('1000')).toBeNull();
    expect(validateProgram('0')).toMatch(/1 a 1000/);
    expect(validateProgram('1001')).toMatch(/1 a 1000/);
    expect(validateProgram('1.5')).toMatch(/1 a 1000/);
  });

  it('reports the first problem of a reward in form order', () => {
    expect(validateReward(EMPTY_REWARD)).toMatch(/nome/);
    expect(validateReward({ name: 'Sobremesa', description: '', pointsCost: '' })).toMatch(/custo/);
    expect(validateReward({ name: 'Sobremesa', description: '', pointsCost: '0' })).toMatch(/custo/);
    expect(validateReward({ name: 'Sobremesa', description: 'x'.repeat(201), pointsCost: '10' })).toMatch(/descrição/);
    expect(validateReward({ name: 'Sobremesa', description: 'da casa', pointsCost: '100' })).toBeNull();
  });

  it('fills the edit form from the stored reward', () => {
    expect(
      toRewardDraft({ id: 'r', name: 'Sobremesa', description: null, pointsCost: 100, active: true, createdAt: '', updatedAt: '' }),
    ).toEqual({ name: 'Sobremesa', description: '', pointsCost: '100' });
  });
});

describe('manual adjustment', () => {
  it('needs a quantity and a reason', () => {
    expect(validateAdjust(EMPTY_ADJUST, 100)).toMatch(/quantidade/);
    expect(validateAdjust({ direction: 'credit', points: '10', reason: '' }, 100)).toMatch(/motivo/);
    expect(validateAdjust({ direction: 'credit', points: '10', reason: 'ab' }, 100)).toMatch(/motivo/);
    expect(validateAdjust({ direction: 'credit', points: '10', reason: 'Cortesia' }, 0)).toBeNull();
  });

  it('refuses a debit larger than the balance, but not a credit', () => {
    expect(validateAdjust({ direction: 'debit', points: '101', reason: 'Correção' }, 100)).toMatch(/apenas 100 pontos/);
    expect(validateAdjust({ direction: 'debit', points: '100', reason: 'Correção' }, 100)).toBeNull();
    expect(validateAdjust({ direction: 'credit', points: '101', reason: 'Correção' }, 100)).toBeNull();
  });

  it('sends a debit as a negative number', () => {
    expect(adjustPoints({ direction: 'credit', points: '15', reason: 'x' })).toBe(15);
    expect(adjustPoints({ direction: 'debit', points: '15', reason: 'x' })).toBe(-15);
  });

  it('validates a reversal reason alone', () => {
    expect(validateReason('  ')).toMatch(/motivo/);
    expect(validateReason('x'.repeat(201))).toMatch(/200/);
    expect(validateReason('Cliente errado')).toBeNull();
  });
});

describe('rules shown on screen', () => {
  it('knows which rewards the balance covers', () => {
    expect(canAfford({ pointsCost: 100 }, 100)).toBe(true);
    expect(canAfford({ pointsCost: 101 }, 100)).toBe(false);
  });

  it('offers a reversal only for a movement that is not a reversal and was not reversed yet', () => {
    expect(isReversible({ type: 'REDEEM', reversed: false })).toBe(true);
    expect(isReversible({ type: 'REDEEM', reversed: true })).toBe(false);
    expect(isReversible({ type: 'REVERSAL', reversed: false })).toBe(false);
  });

  it('maps API error codes to readable text and keeps unknown messages', () => {
    expect(loyaltyErrorMessage('LOYALTY_INSUFFICIENT_POINTS', 'x')).toMatch(/insuficiente/);
    expect(loyaltyErrorMessage('LOYALTY_DISABLED', 'x')).toMatch(/desativado/);
    expect(loyaltyErrorMessage('SOMETHING_ELSE', 'mensagem da API')).toBe('mensagem da API');
  });
});
