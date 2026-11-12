import { PaymentMethod, StaffPaymentMethod } from './checkout-api';

// How a bill is paid: money received now. Fiado (sell now, charge later) is not offered: the owner
// turned it off (remocao-fiado) and the API refuses it whatever a screen sends.
export const TAB_PAYMENT_OPTIONS: { value: PaymentMethod; label: string }[] = [
  { value: 'CASH', label: 'Dinheiro' },
  { value: 'PIX', label: 'PIX' },
  { value: 'CARD', label: 'Cartão' },
];

// The label of how a sale was paid, old fiado sales included (they keep their history).
export function paidWithLabel(method: StaffPaymentMethod): string {
  if (method === 'ON_ACCOUNT') return 'Fiado (venda anterior)';
  return TAB_PAYMENT_OPTIONS.find((o) => o.value === method)?.label ?? method;
}

// UX guard only — the backend re-checks every one of these (TAB_EMPTY, CASH_REGISTER_NOT_OPEN)
// inside the checkout transaction. Returns why the "confirm" button must stay disabled, or null
// when it can be pressed.
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
