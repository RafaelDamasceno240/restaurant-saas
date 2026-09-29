import { PaymentMethod } from './checkout-api';

export const TAB_PAYMENT_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Dinheiro' },
  { value: 'PIX', label: 'PIX' },
  { value: 'CARD', label: 'Cartão' },
];

// UX guard only — the backend re-checks every one of these (TAB_EMPTY,
// CASH_REGISTER_NOT_OPEN) inside the checkout transaction. Returns why the
// "confirm" button must stay disabled, or null when it can be pressed.
export function checkoutBlockReason(input: {
  itemCount: number;
  paymentMethod: PaymentMethod | null;
  cashRegisterOpen: boolean;
}): string | null {
  if (input.itemCount === 0) return 'Adicione ao menos um item antes de fechar a conta.';
  if (!input.paymentMethod) return 'Escolha a forma de pagamento.';
  if (input.paymentMethod === 'CASH' && !input.cashRegisterOpen) {
    return 'Não há caixa aberto nesta unidade — abra o caixa (Menu: Caixa) ou escolha PIX/Cartão.';
  }
  return null;
}
