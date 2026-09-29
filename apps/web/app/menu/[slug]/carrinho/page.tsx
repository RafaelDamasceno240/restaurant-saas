'use client';

import Link from 'next/link';
import { useCart } from '@/lib/cart-context';
import { formatCentsAsBRL } from '@/lib/money';

interface PageProps {
  params: { slug: string };
}

export default function CartPage({ params }: PageProps) {
  const {
    restaurantSlug,
    restaurantName,
    items,
    subtotalCents,
    increment,
    decrement,
    removeItem,
    clearCart,
  } = useCart();

  // The cart is a single global slot (one restaurant at a time). If the
  // customer navigates here for a restaurant that isn't the one the cart
  // actually belongs to (e.g. an old tab, or they never added anything from
  // this one), treat it exactly like an empty cart for THIS restaurant —
  // never show another restaurant's items under this URL.
  const belongsToThisRestaurant = restaurantSlug === params.slug;
  const visibleItems = belongsToThisRestaurant ? items : [];

  return (
    <main className="mx-auto min-h-screen max-w-2xl bg-background px-4 pb-24 pt-6">
      <div className="mb-4">
        <Link href={`/menu/${params.slug}`} className="text-sm text-muted-foreground underline">
          ← Voltar ao cardápio
        </Link>
        <h1 className="mt-2 text-lg font-semibold">
          Carrinho{belongsToThisRestaurant && restaurantName ? ` · ${restaurantName}` : ''}
        </h1>
      </div>

      {visibleItems.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-line-strong bg-surface p-10 text-center">
          <p className="text-2xl" aria-hidden>
            🛒
          </p>
          <p className="font-medium">Seu carrinho está vazio</p>
          <Link
            href={`/menu/${params.slug}`}
            className="mt-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
          >
            Voltar ao cardápio
          </Link>
        </div>
      ) : (
        <>
          <ul className="space-y-3">
            {visibleItems.map((item) => (
              <li
                key={item.productId}
                className="flex gap-3 rounded-xl border border-line bg-surface p-3"
              >
                {item.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="h-16 w-16 flex-shrink-0 rounded-lg object-cover"
                  />
                ) : (
                  <div
                    aria-hidden
                    className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-lg bg-surface-hover text-xl"
                  >
                    🍽️
                  </div>
                )}

                <div className="flex min-w-0 flex-1 flex-col justify-between">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{item.name}</p>
                      <p className="text-sm text-muted-foreground">
                        {formatCentsAsBRL(item.priceCents)} / un.
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeItem(item.productId)}
                      aria-label={`Remover ${item.name} do carrinho`}
                      className="text-xs text-danger underline"
                    >
                      Remover
                    </button>
                  </div>

                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => decrement(item.productId)}
                        aria-label={`Diminuir quantidade de ${item.name}`}
                        className="h-7 w-7 rounded-full border border-line-strong text-sm font-medium"
                      >
                        −
                      </button>
                      <span className="w-6 text-center text-sm font-medium">
                        {item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() => increment(item.productId)}
                        aria-label={`Aumentar quantidade de ${item.name}`}
                        className="h-7 w-7 rounded-full border border-line-strong text-sm font-medium"
                      >
                        +
                      </button>
                    </div>
                    <span className="font-semibold">
                      {formatCentsAsBRL(item.priceCents * item.quantity)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={clearCart}
            className="mt-4 text-sm text-muted-foreground underline"
          >
            Limpar carrinho
          </button>

          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface p-4">
            <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Subtotal</p>
                <p className="text-lg font-semibold">{formatCentsAsBRL(subtotalCents)}</p>
              </div>
              <div className="flex gap-2">
                <Link
                  href={`/menu/${params.slug}`}
                  className="rounded-lg border border-line-strong px-4 py-2 text-sm font-medium text-foreground"
                >
                  Continuar comprando
                </Link>
                <Link
                  href={`/menu/${params.slug}/checkout`}
                  className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
                >
                  Continuar para checkout
                </Link>
              </div>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
