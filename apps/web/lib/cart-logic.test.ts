import {
  CART_STORAGE_KEY,
  MAX_UNITS_HINT,
  MAX_UNITS_PER_PRODUCT,
  addItem,
  atUnitLimit,
  clearCart,
  decrementItem,
  emptyCart,
  getSubtotalCents,
  getTotalQuantity,
  incrementItem,
  lineKey,
  loadCart,
  needsRestaurantSwitchConfirm,
  removeItem,
  saveCart,
  toOrderItems,
  unitsOfProduct,
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
    // A line without add-ons and note keeps the productId as its id.
    expect(state.items).toEqual([{ ...burger, lineId: burger.productId, options: [], notes: null, quantity: 1 }]);
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
      expect(switched.items).toEqual([{ ...fries, lineId: fries.productId, options: [], notes: null, quantity: 1 }]);
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

describe('50 units of one product at most (B7)', () => {
  const full = (): CartState => ({
    restaurantSlug: restaurantA.slug,
    restaurantName: restaurantA.name,
    items: [{ ...burger, lineId: burger.productId, options: [], notes: null, quantity: MAX_UNITS_PER_PRODUCT }],
  });

  it('adding or "+" stops at 50; other products are still free', () => {
    expect(MAX_UNITS_PER_PRODUCT).toBe(50);
    expect(addItem(full(), burger, restaurantA).items[0].quantity).toBe(50);
    expect(incrementItem(full(), burger.productId).items[0].quantity).toBe(50);
    const withFries = addItem(full(), fries, restaurantA);
    expect(withFries.items.map((i) => i.quantity)).toEqual([50, 1]);
    let state: CartState = emptyCart;
    for (let i = 0; i < 60; i++) state = addItem(state, burger, restaurantA);
    expect(state.items[0].quantity).toBe(50);
  });

  it('"−" still works at the limit and the limit is reported for the screens', () => {
    expect(decrementItem(full(), burger.productId).items[0].quantity).toBe(49);
    expect(atUnitLimit(49)).toBe(false);
    expect(atUnitLimit(50)).toBe(true);
    expect(MAX_UNITS_HINT).toBe('Máximo de 50 unidades por produto.');
  });

  it('a saved cart with more than 50 comes back with 50', () => {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({ restaurantSlug: 'a', restaurantName: 'A', items: [{ ...burger, quantity: 56 }, { ...fries, quantity: 3 }] }),
    );
    expect(loadCart()?.items.map((i) => i.quantity)).toEqual([50, 3]);
  });

  it('adds up every line of a product (tab lines)', () => {
    const lines = [
      { productId: 'p1', quantity: 25 },
      { productId: 'p2', quantity: 40 },
      { productId: 'p1', quantity: 25 },
    ];
    expect(unitsOfProduct(lines, 'p1')).toBe(50);
    expect(unitsOfProduct(lines, 'p3')).toBe(0);
  });
});

describe('lines with add-ons and notes', () => {
  const bacon = { optionId: 'o-bacon', groupName: 'Turbine', name: 'Bacon', priceCents: 400, quantity: 1 };
  const egg = { optionId: 'o-ovo', groupName: 'Turbine', name: 'Ovo', priceCents: 200, quantity: 2 };

  beforeEach(() => window.localStorage.clear());

  it('keeps the productId as lineId without add-ons or note', () => {
    expect(lineKey('p1')).toBe('p1');
    expect(lineKey('p1', [], '  ')).toBe('p1');
  });

  it('the same product with other add-ons or another note is another line', () => {
    let state = addItem(emptyCart, burger, restaurantA);
    state = addItem(state, { ...burger, priceCents: 2890, options: [bacon] }, restaurantA);
    state = addItem(state, { ...burger, notes: 'sem cebola' }, restaurantA);
    expect(state.items).toHaveLength(3);
    expect(new Set(state.items.map((i) => i.lineId)).size).toBe(3);
  });

  it('the same add-ons in another order and the same note add up on one line', () => {
    let state = addItem(emptyCart, { ...burger, options: [bacon, egg], notes: 'bem passado' }, restaurantA);
    state = addItem(state, { ...burger, options: [egg, bacon], notes: ' bem passado ' }, restaurantA);
    expect(state.items).toHaveLength(1);
    expect(state.items[0].quantity).toBe(2);
  });

  it('adds several units at once, never over 50 of the product over all its lines', () => {
    let state = addItem(emptyCart, { ...burger, quantity: 30 }, restaurantA);
    state = addItem(state, { ...burger, options: [bacon], quantity: 30 }, restaurantA);
    expect(state.items.map((i) => i.quantity)).toEqual([30, 20]);
    expect(incrementItem(state, state.items[0].lineId)).toBe(state);
  });

  it('increments, decrements and removes by line', () => {
    let state = addItem(emptyCart, burger, restaurantA);
    state = addItem(state, { ...burger, options: [bacon] }, restaurantA);
    const withBacon = state.items[1].lineId;
    state = incrementItem(state, withBacon);
    expect(state.items.map((i) => i.quantity)).toEqual([1, 2]);
    state = decrementItem(state, withBacon);
    state = removeItem(state, burger.productId);
    expect(state.items.map((i) => i.lineId)).toEqual([withBacon]);
  });

  it('sends only ids and quantities to the order', () => {
    const state = addItem(emptyCart, { ...burger, priceCents: 3290, options: [bacon, egg], notes: 'sem cebola' }, restaurantA);
    expect(toOrderItems(state.items)).toEqual([
      {
        productId: 'p1',
        quantity: 1,
        options: [
          { optionId: 'o-bacon', quantity: 1 },
          { optionId: 'o-ovo', quantity: 2 },
        ],
        notes: 'sem cebola',
      },
    ]);
    expect(toOrderItems(addItem(emptyCart, fries, restaurantA).items)).toEqual([{ productId: 'p2', quantity: 1 }]);
  });

  it('reads a cart saved before add-ons existed', () => {
    window.localStorage.setItem(
      CART_STORAGE_KEY,
      JSON.stringify({ restaurantSlug: 'a', restaurantName: 'A', items: [{ productId: 'p1', name: 'X', priceCents: 100, imageUrl: null, quantity: 2 }] }),
    );
    expect(loadCart()?.items).toEqual([
      { productId: 'p1', name: 'X', priceCents: 100, imageUrl: null, quantity: 2, lineId: 'p1', options: [], notes: null },
    ]);
  });
});
