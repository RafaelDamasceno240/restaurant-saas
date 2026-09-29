import {
  addToCart,
  decrementItem,
  filterPosProducts,
  getSubtotalCents,
  getTotalQuantity,
  incrementItem,
  removeItem,
} from './pos-logic';

const burger = { productId: 'p1', name: 'X-Burger', priceCents: 2490 };
const fries = { productId: 'p2', name: 'Batata Frita', priceCents: 1200 };

describe('pos-logic: cart', () => {
  it('adds a new product with quantity 1', () => {
    const cart = addToCart([], burger);
    expect(cart).toEqual([{ ...burger, quantity: 1 }]);
  });

  it('increments quantity when adding the same product again', () => {
    let cart = addToCart([], burger);
    cart = addToCart(cart, burger);
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(2);
  });

  it('increments quantity via incrementItem', () => {
    const cart = incrementItem(addToCart([], burger), burger.productId);
    expect(cart[0].quantity).toBe(2);
  });

  it('decrements without removing above quantity 1', () => {
    let cart = addToCart([], burger);
    cart = incrementItem(cart, burger.productId); // 2
    cart = decrementItem(cart, burger.productId); // 1
    expect(cart[0].quantity).toBe(1);
  });

  it('removes the item when decrementing from quantity 1', () => {
    const cart = decrementItem(addToCart([], burger), burger.productId);
    expect(cart).toHaveLength(0);
  });

  it('removes an item explicitly', () => {
    let cart = addToCart([], burger);
    cart = addToCart(cart, fries);
    cart = removeItem(cart, burger.productId);
    expect(cart.map((i) => i.productId)).toEqual([fries.productId]);
  });

  it('computes subtotal in cents and total quantity across items', () => {
    let cart = addToCart([], burger);
    cart = addToCart(cart, burger); // qty 2 -> 4980
    cart = addToCart(cart, fries); // qty 1 -> +1200 = 6180
    expect(getSubtotalCents(cart)).toBe(6180);
    expect(getTotalQuantity(cart)).toBe(3);
  });
});

describe('pos-logic: filterPosProducts', () => {
  const products = [
    { id: '1', name: 'X-Burger', categoryId: 'burgers', active: true },
    { id: '2', name: 'X-Bacon', categoryId: 'burgers', active: true },
    { id: '3', name: 'Refrigerante', categoryId: 'drinks', active: true },
    { id: '4', name: 'Combo Antigo', categoryId: 'burgers', active: false },
  ];

  it('excludes inactive products even with no filters applied', () => {
    const result = filterPosProducts(products, '', null);
    expect(result.map((p) => p.id)).toEqual(['1', '2', '3']);
  });

  it('filters by category', () => {
    const result = filterPosProducts(products, '', 'drinks');
    expect(result.map((p) => p.id)).toEqual(['3']);
  });

  it('filters by name search, case-insensitive', () => {
    const result = filterPosProducts(products, 'bacon', null);
    expect(result.map((p) => p.id)).toEqual(['2']);
  });

  it('combines category and search filters', () => {
    const result = filterPosProducts(products, 'x-', 'burgers');
    expect(result.map((p) => p.id).sort()).toEqual(['1', '2']);
  });

  it('never returns an inactive product even if it matches search/category', () => {
    const result = filterPosProducts(products, 'combo', 'burgers');
    expect(result).toEqual([]);
  });
});
