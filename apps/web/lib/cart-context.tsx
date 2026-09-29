'use client';

import { createContext, ReactNode, useContext, useEffect, useState } from 'react';
import { CartItem, CartState } from './cart-types';
import {
  AddItemInput,
  RestaurantRef,
  addItem as addItemPure,
  clearCart as clearCartPure,
  decrementItem,
  emptyCart,
  getSubtotalCents,
  getTotalQuantity,
  incrementItem,
  loadCart,
  needsRestaurantSwitchConfirm,
  removeItem as removeItemPure,
  saveCart,
} from './cart-logic';

interface CartContextValue {
  restaurantSlug: string | null;
  restaurantName: string | null;
  items: CartItem[];
  totalQuantity: number;
  subtotalCents: number;
  addItem: (item: AddItemInput, restaurant: RestaurantRef) => void;
  increment: (productId: string) => void;
  decrement: (productId: string) => void;
  removeItem: (productId: string) => void;
  clearCart: () => void;
}

const CartContext = createContext<CartContextValue | undefined>(undefined);

export function CartProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<CartState>(emptyCart);
  const [hasHydrated, setHasHydrated] = useState(false);

  // Reads localStorage exactly once, client-side only, after mount. Server
  // render and the very first client render both use `emptyCart`, so there
  // is no hydration mismatch — the real cart "pops in" a moment later,
  // which is the standard, safe pattern for browser-storage-backed state
  // in Next.js.
  useEffect(() => {
    const stored = loadCart();
    if (stored) setState(stored);
    setHasHydrated(true);
  }, []);

  // Guarded by hasHydrated so we never overwrite a real, saved cart with
  // the default empty one before it has actually finished loading.
  useEffect(() => {
    if (!hasHydrated) return;
    saveCart(state);
  }, [state, hasHydrated]);

  // Reads `state` directly (not via setState's functional-updater form)
  // because it needs to decide, as a one-time side effect, whether to show
  // a confirm() dialog *before* committing to a new state — something a
  // pure updater function must never do.
  function handleAddItem(item: AddItemInput, restaurant: RestaurantRef) {
    if (needsRestaurantSwitchConfirm(state, restaurant.slug)) {
      const confirmed = window.confirm(
        `Seu carrinho tem itens de "${state.restaurantName ?? 'outro restaurante'}". ` +
          `Deseja limpar o carrinho e adicionar produtos de "${restaurant.name}"?`,
      );
      if (!confirmed) return;
      setState(addItemPure(state, item, restaurant, true));
      return;
    }
    setState(addItemPure(state, item, restaurant));
  }

  const value: CartContextValue = {
    restaurantSlug: state.restaurantSlug,
    restaurantName: state.restaurantName,
    items: state.items,
    totalQuantity: getTotalQuantity(state),
    subtotalCents: getSubtotalCents(state),
    addItem: handleAddItem,
    increment: (productId) => setState((prev) => incrementItem(prev, productId)),
    decrement: (productId) => setState((prev) => decrementItem(prev, productId)),
    removeItem: (productId) => setState((prev) => removeItemPure(prev, productId)),
    clearCart: () => setState(clearCartPure()),
  };

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used within a CartProvider');
  }
  return ctx;
}
