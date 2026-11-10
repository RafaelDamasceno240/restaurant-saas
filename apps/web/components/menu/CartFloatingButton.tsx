'use client';

import Link from 'next/link';
import { ShoppingBag } from 'lucide-react';
import { useCart } from '@/lib/cart-context';
import { formatCentsAsBRL } from '@/lib/money';

// Only shown when the persisted cart actually belongs to THIS restaurant —
// if the customer is browsing restaurant B while their cart still holds
// restaurant A's items (untouched), showing "3 itens" here would wrongly
// suggest those items are for B. The cross-restaurant confirmation only
// happens at the moment of actually adding a product (see cart-context.tsx).
export function CartFloatingButton({ restaurantSlug }: { restaurantSlug: string }) {
  const { restaurantSlug: cartSlug, totalQuantity, subtotalCents } = useCart();

  if (cartSlug !== restaurantSlug || totalQuantity === 0) {
    return null;
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-30 px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 sm:pb-5">
      <Link
        href={`/menu/${restaurantSlug}/carrinho`}
        className="mx-auto flex max-w-2xl items-center gap-3 rounded-2xl bg-primary px-4 py-3.5 text-primary-foreground shadow-lg shadow-black/20 transition hover:bg-primary-hover"
      >
        <span className="relative">
          <ShoppingBag className="h-5 w-5" aria-hidden />
          <span className="absolute -right-2 -top-2 flex h-5 min-w-5 items-center justify-center rounded-full bg-primary-foreground px-1 text-2xs font-bold text-primary">
            {totalQuantity}
          </span>
        </span>
        <span className="flex-1 text-center text-sm font-semibold">Ver carrinho</span>
        <span className="text-sm font-semibold tabular-nums">
          {formatCentsAsBRL(subtotalCents)}
        </span>
        <span className="sr-only">
          {totalQuantity} {totalQuantity === 1 ? 'item' : 'itens'}
        </span>
      </Link>
    </div>
  );
}
