import { StaffPaymentMethod } from './checkout-api';

// ON_ACCOUNT (fiado) is offered only to who may sell on account; see tabPaymentOptions().
export const TAB_PAYMENT_OPTIONS: { value: StaffPaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Dinheiro' },
  { value: 'PIX', label: 'PIX' },
  { value: 'CARD', label: 'Cartão' },
  { value: 'ON_ACCOUNT', label: 'Fiado' },
];

export function tabPaymentOptions(canSellOnAccount: boolean) {
  return TAB_PAYMENT_OPTIONS.filter((option) => option.value !== 'ON_ACCOUNT' || canSellOnAccount);
}

// UX guard only — the backend re-checks every one of these (TAB_EMPTY,
// CASH_REGISTER_NOT_OPEN, the customer's credit) inside the checkout transaction. Returns why the
// "confirm" button must stay disabled, or null when it can be pressed.
export function checkoutBlockReason(input: {
  itemCount: number;
  paymentMethod: StaffPaymentMethod | null;
  cashRegisterOpen: boolean;
  // Fiado: a registered customer is required, and creditBlock says why that customer cannot
  // take this bill on account right now (null = may).
  customerPicked?: boolean;
  creditBlock?: string | null;
}): string | null {
  if (input.itemCount === 0) return 'Adicione ao menos um item antes de fechar a conta.';
  if (!input.paymentMethod) return 'Escolha a forma de pagamento.';
  if (input.paymentMethod === 'CASH' && !input.cashRegisterOpen) {
    return 'Não há caixa aberto nesta unidade — abra o caixa (Menu: Caixa) ou escolha PIX/Cartão.';
  }
  if (input.paymentMethod === 'ON_ACCOUNT') {
    if (!input.customerPicked) return 'Escolha um cliente cadastrado para lançar a conta no fiado.';
    if (input.creditBlock) return input.creditBlock;
  }
  return null;
}
