'use client';

import Link from 'next/link';
import { ArrowLeft, Minus, Plus, ShoppingBag, Trash2 } from 'lucide-react';
import { useCart } from '@/lib/cart-context';
import { formatCentsAsBRL } from '@/lib/money';
import { MAX_UNITS_HINT, atUnitLimit, unitsOfProduct } from '@/lib/cart-logic';
import { ProductImage } from '@/components/menu/ProductImage';
import { CartLineDetails } from '@/components/menu/CartLineDetails';

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
    <main className="mx-auto min-h-screen max-w-2xl pb-32">
      <header className="sticky top-0 z-20 flex items-center gap-3 border-b border-line bg-surface/95 px-4 py-3 backdrop-blur">
        <Link
          href={`/menu/${params.slug}`}
          aria-label="Voltar ao cardápio"
          className="flex h-9 w-9 items-center justify-center rounded-full hover:bg-surface-hover"
        >
          <ArrowLeft className="h-5 w-5" />
        </Link>
        <div className="min-w-0">
          <h1 className="text-base font-bold leading-tight">Carrinho</h1>
          {belongsToThisRestaurant && restaurantName && (
            <p className="truncate text-xs text-muted-foreground">{restaurantName}</p>
          )}
        </div>
        {visibleItems.length > 0 && (
          <button
            type="button"
            onClick={clearCart}
            className="ml-auto text-sm font-medium text-muted-foreground hover:text-danger"
          >
            Limpar
          </button>
        )}
      </header>

      {visibleItems.length === 0 ? (
        <div className="mx-4 mt-8 flex flex-col items-center gap-3 rounded-3xl border border-dashed border-line-strong bg-surface p-10 text-center">
          <ShoppingBag className="h-8 w-8 text-subtle" aria-hidden />
          <p className="font-semibold">Seu carrinho está vazio</p>
          <Link
            href={`/menu/${params.slug}`}
            className="mt-2 rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
          >
            Ver o cardápio
          </Link>
        </div>
      ) : (
        <>
          <ul className="divide-y divide-line bg-surface sm:mx-4 sm:mt-4 sm:rounded-3xl sm:border sm:border-line">
            {visibleItems.map((item) => {
              const full = atUnitLimit(unitsOfProduct(visibleItems, item.productId));
              return (
                <li key={item.lineId} className="flex gap-3 px-4 py-4">
                  <ProductImage
                    src={item.imageUrl}
                    alt=""
                    className="h-16 w-16 shrink-0 rounded-xl"
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <p className="font-semibold leading-snug">{item.name}</p>
                      <button
                        type="button"
                        onClick={() => removeItem(item.lineId)}
                        aria-label={`Remover ${item.name} do carrinho`}
                        className="rounded-full p-1 text-subtle hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                    <CartLineDetails options={item.options} notes={item.notes} />
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-1 rounded-full border border-line">
                        <button
                          type="button"
                          onClick={() => decrement(item.lineId)}
                          aria-label={`Diminuir quantidade de ${item.name}`}
                          className="flex h-8 w-8 items-center justify-center rounded-full text-primary"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="min-w-5 text-center text-sm font-semibold tabular-nums">
                          {item.quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => increment(item.lineId)}
                          disabled={full}
                          title={full ? MAX_UNITS_HINT : undefined}
                          aria-label={`Aumentar quantidade de ${item.name}`}
                          className="flex h-8 w-8 items-center justify-center rounded-full text-primary disabled:cursor-not-allowed disabled:text-subtle"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                      <span className="font-semibold tabular-nums">
                        {formatCentsAsBRL(item.priceCents * item.quantity)}
                      </span>
                    </div>
                    {full && <p className="mt-1 text-xs text-muted-foreground">{MAX_UNITS_HINT}</p>}
                  </div>
                </li>
              );
            })}
          </ul>

          <div className="px-4 pt-4">
            <Link
              href={`/menu/${params.slug}`}
              className="text-sm font-semibold text-primary hover:underline"
            >
              + Adicionar mais itens
            </Link>
          </div>

          <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-surface/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 backdrop-blur">
            <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
              <div>
                <p className="text-xs text-muted-foreground">Subtotal</p>
                <p className="text-lg font-bold tabular-nums">{formatCentsAsBRL(subtotalCents)}</p>
              </div>
              <Link
                href={`/menu/${params.slug}/checkout`}
                className="rounded-2xl bg-primary px-6 py-3.5 text-sm font-semibold text-primary-foreground hover:bg-primary-hover"
              >
                Continuar
              </Link>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
