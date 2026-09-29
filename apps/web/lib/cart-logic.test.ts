import {
  CART_STORAGE_KEY,
  addItem,
  clearCart,
  decrementItem,
  emptyCart,
  getSubtotalCents,
  getTotalQuantity,
  incrementItem,
  loadCart,
  needsRestaurantSwitchConfirm,
  removeItem,
  saveCart,
} from './cart-logic';
import { CartState } from './cart-types';

const restaurantA = { slug: 'restaurante-a', name: 'Restaurante A' };
const restaurantB = { slug: 'restaurante-b', name: 'Restaurante B' };

const burger = { productId: 'p1', name: 'X-Burger', priceCents: 2490, imageUrl: null };
const fries = { productId: 'p2', name: 'Batata Frita', priceCents: 1200, imageUrl: null };

describe('cart-logic', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('adds a new product with quantity 1 and sets the restaurant', () => {
    const state = addItem(emptyCart, burger, restaurantA);
    expect(state.restaurantSlug).toBe(restaurantA.slug);
    expect(state.restaurantName).toBe(restaurantA.name);
    expect(state.items).toEqual([{ ...burger, quantity: 1 }]);
  });

  it('increments quantity when adding the same product again', () => {
    let state = addItem(emptyCart, burger, restaurantA);
    state = addItem(state, burger, restaurantA);
    expect(state.items).toHaveLength(1);
    expect(state.items[0].quantity).toBe(2);
  });

  it('increments quantity via incrementItem', () => {
    const state = incrementItem(addItem(emptyCart, burger, restaurantA), burger.productId);
    expect(state.items[0].quantity).toBe(2);
  });

  it('decrements quantity via decrementItem without removing above 1', () => {
    let state = addItem(emptyCart, burger, restaurantA);
    state = incrementItem(state, burger.productId); // quantity 2
    state = decrementItem(state, burger.productId); // quantity 1
    expect(state.items[0].quantity).toBe(1);
  });

  it('removes the item when decrementing from quantity 1', () => {
    let state = addItem(emptyCart, burger, restaurantA);
    state = decrementItem(state, burger.productId);
    expect(state.items).toHaveLength(0);
  });

  it('removes an item explicitly via removeItem', () => {
    let state = addItem(emptyCart, burger, restaurantA);
    state = addItem(state, fries, restaurantA);
    state = removeItem(state, burger.productId);
    expect(state.items.map((i) => i.productId)).toEqual([fries.productId]);
  });

  it('clears the cart entirely', () => {
    let state = addItem(emptyCart, burger, restaurantA);
    state = clearCart();
    expect(state).toEqual(emptyCart);
  });

  it('computes total quantity across distinct items', () => {
    let state = addItem(emptyCart, burger, restaurantA);
    state = addItem(state, burger, restaurantA); // qty 2
    state = addItem(state, fries, restaurantA); // qty 1
    expect(getTotalQuantity(state)).toBe(3);
  });

  it('computes subtotal in cents (no floating point)', () => {
    let state = addItem(emptyCart, burger, restaurantA); // 2490
    state = addItem(state, burger, restaurantA); // 2490 * 2 = 4980
    state = addItem(state, fries, restaurantA); // + 1200 = 6180
    expect(getSubtotalCents(state)).toBe(6180);
  });

  it('persists and restores the cart via localStorage', () => {
    const state = addItem(emptyCart, burger, restaurantA);
    saveCart(state);
    const restored = loadCart();
    expect(restored).toEqual(state);
    expect(window.localStorage.getItem(CART_STORAGE_KEY)).not.toBeNull();
  });

  it('returns null from loadCart when storage is empty or corrupted', () => {
    expect(loadCart()).toBeNull();
    window.localStorage.setItem(CART_STORAGE_KEY, '{not valid json');
    expect(loadCart()).toBeNull();
    window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ foo: 'bar' }));
    expect(loadCart()).toBeNull();
  });

  describe('restaurant separation', () => {
    it('does NOT require confirmation for an empty cart or the same restaurant', () => {
      expect(needsRestaurantSwitchConfirm(emptyCart, restaurantA.slug)).toBe(false);
      const state = addItem(emptyCart, burger, restaurantA);
      expect(needsRestaurantSwitchConfirm(state, restaurantA.slug)).toBe(false);
    });

    it('requires confirmation when the cart has items from a different restaurant', () => {
      const state = addItem(emptyCart, burger, restaurantA);
      expect(needsRestaurantSwitchConfirm(state, restaurantB.slug)).toBe(true);
    });

    it('addItem without force leaves a cross-restaurant cart unchanged', () => {
      const state = addItem(emptyCart, burger, restaurantA);
      const unchanged = addItem(state, fries, restaurantB);
      expect(unchanged).toEqual(state);
      expect(unchanged.restaurantSlug).toBe(restaurantA.slug);
    });

    it('addItem with force=true replaces the cart with the new restaurant only', () => {
      const state = addItem(emptyCart, burger, restaurantA);
      const switched = addItem(state, fries, restaurantB, true);
      expect(switched.restaurantSlug).toBe(restaurantB.slug);
      expect(switched.items).toEqual([{ ...fries, quantity: 1 }]);
      // Restaurant A's item must not leak into B's cart.
      expect(switched.items.some((i) => i.productId === burger.productId)).toBe(false);
    });

    it('restaurant A cart is never equal to restaurant B cart for the same product set otherwise', () => {
      const cartA: CartState = addItem(emptyCart, burger, restaurantA);
      const cartB: CartState = addItem(emptyCart, burger, restaurantB);
      expect(cartA.restaurantSlug).not.toBe(cartB.restaurantSlug);
    });
  });
});
