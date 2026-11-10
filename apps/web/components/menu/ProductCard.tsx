'use client';

import { useState } from 'react';
import { PublicMenuProduct } from '@/lib/public-menu-api';
import { useCart } from '@/lib/cart-context';
import { toCents, formatCentsAsBRL } from '@/lib/money';
import { MAX_UNITS_HINT, atUnitLimit } from '@/lib/cart-logic';

interface Props {
  product: PublicMenuProduct;
  restaurant: { slug: string; name: string };
}

export function ProductCard({ product, restaurant }: Props) {
  const { addItem, items } = useCart();
  const [justAdded, setJustAdded] = useState(false);
  // B7: 50 units of this product already in the cart, so "Adicionar" stops.
  const full = atUnitLimit(items.find((i) => i.productId === product.id)?.quantity ?? 0);

  function handleAdd() {
    if (full) return;
    addItem(
      {
        productId: product.id,
        name: product.name,
        priceCents: toCents(product.price),
        imageUrl: product.imageUrl,
      },
      restaurant,
    );
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1200);
  }

  return (
    <div className="flex gap-3 rounded-xl border border-line bg-surface p-3">
      {product.imageUrl ? (
        // Arbitrary external domains (restaurant-supplied imageUrl) — a
        // plain <img> avoids configuring next/image remotePatterns per
        // domain, which would be unbounded for user-supplied URLs.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={product.imageUrl}
          alt={product.name}
          className="h-20 w-20 flex-shrink-0 rounded-lg object-cover"
        />
      ) : (
        <div
          aria-hidden
          className="flex h-20 w-20 flex-shrink-0 items-center justify-center rounded-lg bg-surface-hover text-2xl"
        >
          🍽️
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col justify-between">
        <div>
          <p className="truncate font-medium">{product.name}</p>
          {product.description && (
            <p className="line-clamp-2 text-sm text-muted-foreground">{product.description}</p>
          )}
        </div>
        <div className="mt-2 flex items-center justify-between gap-2">
          <span className="font-semibold">{formatCentsAsBRL(toCents(product.price))}</span>
          <button
            type="button"
            onClick={handleAdd}
            disabled={full}
            title={full ? MAX_UNITS_HINT : undefined}
            aria-label={`Adicionar ${product.name} ao carrinho`}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition touch:min-h-11 touch:px-4 touch:text-sm ${
              full
                ? 'cursor-not-allowed bg-surface-hover text-muted-foreground'
                : justAdded
                  ? 'bg-success text-background'
                  : 'bg-primary text-primary-foreground hover:bg-primary-hover'
            }`}
          >
            {full ? 'Limite: 50' : justAdded ? 'Adicionado ✓' : 'Adicionar'}
          </button>
        </div>
      </div>
    </div>
  );
}
