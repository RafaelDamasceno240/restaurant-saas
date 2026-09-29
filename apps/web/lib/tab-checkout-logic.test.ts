import { checkoutBlockReason } from './tab-checkout-logic';

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
