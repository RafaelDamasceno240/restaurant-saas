// B18 (piloto 2026-10-23): the customer's order page kept saying "Pedido recebido!" after the
// order was delivered. The heading now follows the order's status; the status line under it
// stays as it was.

export interface TrackingHeading {
  icon: string;
  title: string;
}

const HEADINGS: Record<string, TrackingHeading> = {
  PENDING: { icon: '✅', title: 'Pedido recebido!' },
  CONFIRMED: { icon: '👍', title: 'Pedido confirmado!' },
  PREPARING: { icon: '👨‍🍳', title: 'Seu pedido está em preparo' },
  READY: { icon: '🛎️', title: 'Seu pedido está pronto!' },
  OUT_FOR_DELIVERY: { icon: '🛵', title: 'Seu pedido saiu para entrega' },
  DELIVERED: { icon: '🎉', title: 'Pedido entregue!' },
  COMPLETED: { icon: '🎉', title: 'Pedido concluído!' },
  CANCELLED: { icon: '❌', title: 'Pedido cancelado' },
};

// A status this page does not know yet reads as the first one: the order exists.
export function trackingHeading(status: string): TrackingHeading {
  return HEADINGS[status] ?? HEADINGS.PENDING;
}
