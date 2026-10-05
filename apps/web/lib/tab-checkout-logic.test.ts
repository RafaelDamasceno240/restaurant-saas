import { checkoutBlockReason, tabPaymentOptions } from './tab-checkout-logic';

describe('checkoutBlockReason', () => {
  it('blocks an empty tab', () => {
    expect(checkoutBlockReason({ itemCount: 0, paymentMethod: 'PIX', cashRegisterOpen: true })).toMatch(/item/);
  });

  it('blocks until a payment method is chosen', () => {
    expect(checkoutBlockReason({ itemCount: 2, paymentMethod: null, cashRegisterOpen: true })).toMatch(/forma de pagamento/);
  });

  it('blocks CASH when the branch has no open cash register', () => {
    expect(checkoutBlockReason({ itemCount: 2, paymentMethod: 'CASH', cashRegisterOpen: false })).toMatch(/caixa aberto/);
  });

  it('allows CASH with an open cash register', () => {
    expect(checkoutBlockReason({ itemCount: 2, paymentMethod: 'CASH', cashRegisterOpen: true })).toBeNull();
  });

  it('allows PIX/CARD regardless of the cash register', () => {
    expect(checkoutBlockReason({ itemCount: 1, paymentMethod: 'PIX', cashRegisterOpen: false })).toBeNull();
    expect(checkoutBlockReason({ itemCount: 1, paymentMethod: 'CARD', cashRegisterOpen: false })).toBeNull();
  });
});

describe('fiado (ON_ACCOUNT) at the table checkout', () => {
  const base = { itemCount: 2, paymentMethod: 'ON_ACCOUNT' as const, cashRegisterOpen: false };

  it('needs a registered customer', () => {
    expect(checkoutBlockReason(base)).toMatch(/cliente cadastrado/);
    expect(checkoutBlockReason({ ...base, customerPicked: false })).toMatch(/cliente cadastrado/);
  });

  it('is blocked by the reason the credit check gives, and free without one', () => {
    expect(checkoutBlockReason({ ...base, customerPicked: true, creditBlock: 'Limite insuficiente.' })).toBe('Limite insuficiente.');
    expect(checkoutBlockReason({ ...base, customerPicked: true, creditBlock: null })).toBeNull();
  });

  it('never needs the cash register: nothing is received', () => {
    expect(checkoutBlockReason({ ...base, customerPicked: true })).toBeNull();
  });

  it('the credit check does not block the other ways of paying', () => {
    expect(checkoutBlockReason({ ...base, paymentMethod: 'PIX', creditBlock: 'Limite insuficiente.' })).toBeNull();
  });

  it('is offered only to who may sell on account', () => {
    expect(tabPaymentOptions(true).map((option) => option.value)).toEqual(['CASH', 'PIX', 'CARD', 'ON_ACCOUNT']);
    expect(tabPaymentOptions(false).map((option) => option.value)).toEqual(['CASH', 'PIX', 'CARD']);
  });
});
