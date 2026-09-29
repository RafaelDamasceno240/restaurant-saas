'use client';

import Link from 'next/link';
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
    <Link
      href={`/menu/${restaurantSlug}/carrinho`}
      className="fixed inset-x-4 bottom-4 z-20 flex items-center justify-between rounded-xl bg-primary px-4 py-3 text-primary-foreground shadow-lg sm:inset-x-auto sm:right-6 sm:w-80"
    >
      <span className="text-sm font-medium">
        🛒 {totalQuantity} {totalQuantity === 1 ? 'item' : 'itens'}
      </span>
      <span className="text-sm font-semibold">{formatCentsAsBRL(subtotalCents)}</span>
    </Link>
  );
}
