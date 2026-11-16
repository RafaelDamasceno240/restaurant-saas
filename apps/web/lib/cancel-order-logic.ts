// B5 (piloto 2026-10-23): cancelling an order is asked for twice and always with a reason. The
// API enforces the same limits (UpdateOrderStatusDto) and is the one that counts; this only
// keeps the button off until the reason is acceptable and tells what the cancellation will undo.

export const CANCEL_REASON_MIN = 3;
export const CANCEL_REASON_MAX = 300;

// null when the reason can be sent; otherwise what is missing. Spaces alone are no reason.
export function cancelReasonProblem(reason: string): string | null {
  const text = reason.trim();
  if (text.length < CANCEL_REASON_MIN) {
    return `Informe o motivo do cancelamento (pelo menos ${CANCEL_REASON_MIN} caracteres).`;
  }
  if (text.length > CANCEL_REASON_MAX) return `O motivo pode ter no máximo ${CANCEL_REASON_MAX} caracteres.`;
  return null;
}

export interface CancellableOrder {
  status: string;
  source?: string;
  paymentMethod: string;
  cashbackUsed?: number;
  couponCode?: string | null;
}

// What this cancellation may undo, in the words of the screen. "May": the API decides on the
// locked rows (e.g. a cash refund needs a sale in the drawer and an open drawer).
export function cancellationEffects(order: CancellableOrder): string[] {
  const effects: string[] = [];
  // A cash sale made at the counter put the money in the drawer when it was made; an online cash
  // order only does it when concluded, and a concluded order cannot be cancelled.
  if (order.paymentMethod === 'CASH' && order.source !== 'ONLINE') {
    effects.push('Estornar no caixa o valor recebido em dinheiro (o caixa precisa estar aberto).');
  }
  if (order.status !== 'PENDING') effects.push('Devolver ao estoque os insumos já baixados por este pedido.');
  if ((order.cashbackUsed ?? 0) > 0) effects.push('Devolver ao cliente o cashback usado neste pedido.');
  if (order.paymentMethod === 'ON_ACCOUNT') effects.push('Cancelar a dívida de fiado deste pedido.');
  if (order.couponCode) effects.push(`O uso do cupom ${order.couponCode} não é devolvido.`);
  effects.push('O cancelamento não pode ser desfeito.');
  return effects;
}
