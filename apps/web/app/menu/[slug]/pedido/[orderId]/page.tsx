import { notFound } from 'next/navigation';
import Link from 'next/link';
import { getOrder } from '@/lib/checkout-api';
import { ApiError } from '@/lib/api-client';

interface PageProps {
  params: { slug: string; orderId: string };
}

const FULFILLMENT_LABEL: Record<string, string> = {
  DELIVERY: 'Entrega',
  PICKUP: 'Retirada',
};

const PAYMENT_LABEL: Record<string, string> = {
  CASH: 'Dinheiro',
  PIX: 'Pix',
  CARD: 'Cartão',
};

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'Recebido',
  CONFIRMED: 'Confirmado',
  PREPARING: 'Em preparo',
  READY: 'Pronto',
  OUT_FOR_DELIVERY: 'Saiu para entrega',
  DELIVERED: 'Entregue',
  COMPLETED: 'Concluído',
  CANCELLED: 'Cancelado',
};

function formatBRL(value: number): string {
  return `R$ ${value.toFixed(2).replace('.', ',')}`;
}

// Server Component, same pattern as the public menu page: fetch happens on
// the server, loading.tsx covers the round trip, notFound() covers a
// missing/foreign order. No cart/session state needed here at all — this
// page reads its data solely from the order id in the URL.
export default async function OrderConfirmationPage({ params }: PageProps) {
  let order;
  try {
    order = await getOrder(params.slug, params.orderId);
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) {
      notFound();
    }
    return (
      <main className="flex min-h-screen items-center justify-center p-8 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">
          Não foi possível carregar o pedido agora. Tente novamente em instantes.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto min-h-screen max-w-2xl space-y-6 bg-background px-4 py-10">
      <div className="rounded-xl border border-line bg-surface p-6 text-center">
        <p className="text-3xl" aria-hidden>
          ✅
        </p>
        <h1 className="mt-2 text-xl font-semibold">Pedido recebido!</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Pedido <span className="font-medium text-foreground">#{order.orderNumber}</span> ·{' '}
          {STATUS_LABEL[order.status] ?? order.status}
        </p>
      </div>

      <section className="rounded-xl border border-line bg-surface p-4">
        <h2 className="mb-2 text-sm font-medium text-muted-foreground">Itens</h2>
        <ul className="divide-y divide-line">
          {order.items.map((item) => (
            <li key={item.productId} className="flex items-center justify-between py-2 text-sm">
              <span>
                {item.quantity}× {item.name}
              </span>
              <span className="font-medium">{formatBRL(item.subtotal)}</span>
            </li>
          ))}
        </ul>
        {order.discount > 0 && (
          <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-sm text-success">
            <span>Desconto{order.couponCode ? ` (${order.couponCode})` : ''}</span>
            <span>− {formatBRL(order.discount)}</span>
          </div>
        )}
        {order.deliveryFee > 0 && (
          <div className="mt-2 flex items-center justify-between border-t border-line pt-2 text-sm text-muted-foreground">
            <span>Taxa de entrega</span>
            <span>{formatBRL(order.deliveryFee)}</span>
          </div>
        )}
        <div className="mt-2 flex items-center justify-between border-t border-line pt-2 font-semibold">
          <span>Total</span>
          <span>{formatBRL(order.total)}</span>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-xs text-muted-foreground">Atendimento</p>
          <p className="font-medium">{FULFILLMENT_LABEL[order.fulfillmentType] ?? order.fulfillmentType}</p>
          {order.address && (
            <p className="mt-1 text-sm text-muted-foreground">
              {order.address.street}, {order.address.number}
              {order.address.complement ? ` - ${order.address.complement}` : ''}
              <br />
              {order.address.neighborhood} — {order.address.city}/{order.address.state}
              <br />
              CEP {order.address.zipCode}
            </p>
          )}
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <p className="text-xs text-muted-foreground">Pagamento</p>
          <p className="font-medium">{PAYMENT_LABEL[order.paymentMethod] ?? order.paymentMethod}</p>
        </div>
      </section>

      {order.notes && (
        <section className="rounded-xl border border-line bg-surface p-4">
          <p className="text-xs text-muted-foreground">Observações</p>
          <p className="text-sm">{order.notes}</p>
        </section>
      )}

      <div className="text-center">
        <Link href={`/menu/${params.slug}`} className="text-sm text-muted-foreground underline">
          Voltar ao cardápio
        </Link>
      </div>
    </main>
  );
}
