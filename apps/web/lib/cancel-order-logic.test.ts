import { CANCEL_REASON_MAX, cancelReasonProblem, cancellationEffects } from './cancel-order-logic';

describe('cancelReasonProblem (B5)', () => {
  it('refuses an empty reason, spaces alone and fewer than 3 characters', () => {
    expect(cancelReasonProblem('')).toMatch(/motivo/);
    expect(cancelReasonProblem('      ')).toMatch(/motivo/);
    expect(cancelReasonProblem(' ab ')).toMatch(/motivo/);
  });

  it('accepts a real reason, trimmed, up to the maximum', () => {
    expect(cancelReasonProblem('  Cliente desistiu  ')).toBeNull();
    expect(cancelReasonProblem('x'.repeat(CANCEL_REASON_MAX))).toBeNull();
    expect(cancelReasonProblem('x'.repeat(CANCEL_REASON_MAX + 1))).toMatch(/no máximo 300/);
  });
});

describe('cancellationEffects (B5)', () => {
  it('a counter cash sale, already confirmed, with cashback and coupon lists everything it undoes', () => {
    const effects = cancellationEffects({ status: 'PREPARING', source: 'COUNTER', paymentMethod: 'CASH', cashbackUsed: 5, couponCode: 'DOCE5' });
    expect(effects.join(' | ')).toMatch(/caixa/);
    expect(effects.join(' | ')).toMatch(/estoque/);
    expect(effects.join(' | ')).toMatch(/cashback/);
    expect(effects.join(' | ')).toMatch(/cupom DOCE5 não é devolvido/);
    expect(effects.at(-1)).toMatch(/não pode ser desfeito/);
  });

  it('a pending online Pix order only warns that it cannot be undone', () => {
    expect(cancellationEffects({ status: 'PENDING', source: 'ONLINE', paymentMethod: 'PIX' })).toEqual([
      'O cancelamento não pode ser desfeito.',
    ]);
  });

  it('an online cash order has not entered the drawer, so no refund is announced; fiado is', () => {
    expect(cancellationEffects({ status: 'PENDING', source: 'ONLINE', paymentMethod: 'CASH' }).join(' ')).not.toMatch(/caixa/);
    expect(cancellationEffects({ status: 'PENDING', source: 'COUNTER', paymentMethod: 'ON_ACCOUNT' }).join(' ')).toMatch(/fiado/);
  });
});
