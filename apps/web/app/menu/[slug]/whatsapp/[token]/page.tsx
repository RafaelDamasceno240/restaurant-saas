'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, MessageCircle, ShoppingBag } from 'lucide-react';
import { ApiError } from '@/lib/api-client';
import { useCart } from '@/lib/cart-context';
import { formatCentsAsBRL } from '@/lib/money';
import { whatsappApi } from '@/lib/whatsapp-api';
import { cartFromShared } from '@/lib/whatsapp-logic';
import { CartLineDetails } from '@/components/menu/CartLineDetails';

interface PageProps {
  params: { slug: string; token: string };
}

// The link the WhatsApp assistant sends. It shows the cart put together in the conversation,
// priced by the API right now, and hands it to the EXISTING cart and checkout: nothing is ordered
// here. The customer reviews, chooses delivery and payment and confirms in the checkout.
export default function WhatsappCartPage({ params }: PageProps) {
  const router = useRouter();
  const { items: currentItems, restaurantSlug, replaceCart } = useCart();
  const query = useQuery({
    queryKey: ['whatsapp-cart', params.slug, params.token],
    queryFn: () => whatsappApi.sharedCart(params.slug, params.token),
    retry: false,
    staleTime: 0,
  });

  const shared = query.data;
  const available = shared?.items.filter((i) => i.available) ?? [];
  const unavailable = shared?.items.filter((i) => !i.available) ?? [];
  const replacesOtherCart = currentItems.length > 0;

  function continueToCart() {
    if (!shared) return;
    replaceCart(cartFromShared(shared));
    router.push(`/menu/${params.slug}/carrinho`);
  }

  const status = query.error instanceof ApiError ? query.error.statusCode : null;

  return (
    <main className="mx-auto min-h-screen max-w-2xl pb-32">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-full bg-success/10 text-success"
          aria-hidden
        >
          <MessageCircle className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <h1 className="text-base font-bold leading-tight">Seu pedido do WhatsApp</h1>
          {shared && (
            <p className="truncate text-xs text-muted-foreground">{shared.restaurant.name}</p>
          )}
        </div>
      </header>

      {query.isLoading && (
        <p className="px-4 py-10 text-center text-sm text-muted-foreground">
          Carregando seu pedido...
        </p>
      )}

      {query.isError && (
        <div className="mx-4 mt-8 flex flex-col items-center gap-3 rounded-3xl border border-dashed border-line-strong bg-surface p-10 text-center">
          <AlertTriangle className="h-8 w-8 text-warning" aria-hidden />
          <p className="font-semibold">
            {status === 410
              ? 'Este link expirou.'
              : status === 404
                ? 'Link não encontrado.'
                : 'Não foi possível abrir o pedido.'}
          </p>
          <p className="text-sm text-muted-foreground">
            {status === 410
              ? 'Peça um novo link pelo WhatsApp do restaurante.'
              : 'Confira o link recebido ou monte o pedido pelo cardápio.'}
          </p>
          <Link
            href={`/menu/${params.slug}`}
            className="mt-2 rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
          >
            Ver o cardápio
          </Link>
        </div>
      )}

      {shared && (
        <>
          {available.length === 0 ? (
            <div className="mx-4 mt-8 flex flex-col items-center gap-3 rounded-3xl border border-dashed border-line-strong bg-surface p-10 text-center">
              <ShoppingBag className="h-8 w-8 text-subtle" aria-hidden />
              <p className="font-semibold">Os itens deste pedido não estão mais disponíveis.</p>
              <Link
                href={`/menu/${params.slug}`}
                className="mt-2 rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
              >
                Ver o cardápio
              </Link>
            </div>
          ) : (
            <ul className="divide-y divide-line bg-surface sm:mx-4 sm:mt-4 sm:rounded-3xl sm:border sm:border-line">
              {available.map((item, index) => (
                <li key={`${item.productId}-${index}`} className="flex gap-3 px-4 py-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold leading-snug">
                        {item.quantity}× {item.name}
                      </p>
                      <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums">
                        {formatCentsAsBRL(item.unitPriceCents * item.quantity)}
                      </span>
                    </div>
                    <CartLineDetails
                      options={item.options.map((o) => ({ ...o }))}
                      notes={item.notes}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}

          {unavailable.length > 0 && (
            <div
              role="status"
              className="mx-4 mt-4 rounded-2xl border border-warning/30 bg-warning/10 p-4 text-sm text-warning"
            >
              <p className="font-semibold">Ficaram de fora por não estarem disponíveis agora:</p>
              <ul className="mt-1 list-disc pl-5">
                {unavailable.map((item, index) => (
                  <li key={`${item.productId}-u-${index}`}>
                    {item.quantity}× {item.name}
                    {item.problem ? ` — ${item.problem}` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {available.length > 0 && (
            <div className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
              <div className="mx-auto max-w-2xl space-y-2">
                <div className="flex items-baseline justify-between text-sm">
                  <span className="text-muted-foreground">Subtotal (valores de agora)</span>
                  <span className="text-lg font-bold tabular-nums">
                    {formatCentsAsBRL(shared.subtotalCents)}
                  </span>
                </div>
                {replacesOtherCart && (
                  <p className="text-xs text-muted-foreground">
                    {restaurantSlug === params.slug
                      ? 'Isto substitui o carrinho que você já tinha aqui.'
                      : 'Isto substitui o carrinho de outro restaurante.'}
                  </p>
                )}
                <button
                  type="button"
                  onClick={continueToCart}
                  className="h-12 w-full rounded-2xl bg-primary text-base font-semibold text-primary-foreground hover:bg-primary-hover"
                >
                  Revisar e finalizar
                </button>
                <p className="text-center text-xs text-muted-foreground">
                  Entrega, pagamento e confirmação são escolhidos no próximo passo. O pedido só é
                  feito quando você confirmar.
                </p>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
