import {
  addToCart,
  decrementItem,
  filterPosProducts,
  getSubtotalCents,
  getTotalQuantity,
  incrementItem,
  removeItem,
  replaceLine,
  roomFor,
} from './pos-logic';

const burger = { productId: 'p1', name: 'X-Burger', priceCents: 2490 };
const fries = { productId: 'p2', name: 'Batata Frita', priceCents: 1200 };

describe('pos-logic: cart', () => {
  it('adds a new product with quantity 1', () => {
    const cart = addToCart([], burger);
    expect(cart).toEqual([{ ...burger, key: burger.productId, quantity: 1, options: [], notes: null }]);
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

describe('PDV: 50 units of one product at most (B7)', () => {
  it('tapping the product or "+" stops at 50', () => {
    let items = addToCart([], burger);
    for (let i = 0; i < 60; i++) items = addToCart(items, burger);
    expect(items[0].quantity).toBe(50);
    expect(incrementItem(items, burger.productId)[0].quantity).toBe(50);
    expect(decrementItem(items, burger.productId)[0].quantity).toBe(49);
    expect(addToCart(items, fries).map((i) => i.quantity)).toEqual([50, 1]);
  });
});

describe('PDV: personalized lines (adicionais)', () => {
  const bacon = { optionId: 'o-bacon', groupName: 'Adicionais', name: 'Bacon', priceCents: 500, quantity: 2 };
  const ponto = { optionId: 'o-ponto', groupName: 'Ponto', name: 'Ao ponto', priceCents: 0, quantity: 1 };
  const custom = { ...burger, priceCents: 3490, options: [ponto, bacon], notes: 'sem cebola' };

  it('the same product with other add-ons or another note is another line', () => {
    let cart = addToCart([], burger);
    cart = addToCart(cart, custom);
    cart = addToCart(cart, { ...custom, notes: 'bem passado' });
    expect(cart).toHaveLength(3);
    expect(cart[0].key).toBe('p1');
    expect(cart[1].key).not.toBe(cart[2].key);
    expect(getSubtotalCents(cart)).toBe(2490 + 3490 + 3490);
  });

  it('the same personalization adds up on one line, add-ons in any order', () => {
    let cart = addToCart([], { ...custom, quantity: 2 });
    cart = addToCart(cart, { ...custom, options: [bacon, ponto] });
    expect(cart).toHaveLength(1);
    expect(cart[0].quantity).toBe(3);
  });

  it('editing a line replaces it in place; removing one line leaves the others', () => {
    let cart = addToCart([], fries);
    cart = addToCart(cart, custom);
    cart = addToCart(cart, burger);
    const key = cart[1].key;
    cart = replaceLine(cart, key, { ...custom, options: [ponto], priceCents: 2490, notes: null, quantity: 4 });
    expect(cart.map((i) => i.name)).toEqual(['Batata Frita', 'X-Burger', 'X-Burger']);
    expect(cart[1]).toMatchObject({ quantity: 4, options: [ponto], notes: null });
    cart = removeItem(cart, cart[1].key);
    expect(cart.map((i) => i.key)).toEqual(['p2', 'p1']);
  });

  it('an edit that becomes identical to another line merges the two', () => {
    let cart = addToCart([], burger); // plain, key p1
    cart = addToCart(cart, custom);
    cart = replaceLine(cart, cart[1].key, { ...burger, quantity: 2 });
    expect(cart).toEqual([expect.objectContaining({ key: 'p1', quantity: 3 })]);
  });

  it('the 50 units of a product count over all its lines (B7)', () => {
    let cart = addToCart([], { ...custom, quantity: 45 });
    expect(roomFor(cart, 'p1')).toBe(5);
    cart = addToCart(cart, { ...burger, quantity: 10 });
    expect(cart[1].quantity).toBe(5);
    expect(incrementItem(cart, cart[0].key)[0].quantity).toBe(45);
    expect(roomFor(cart, 'p1')).toBe(0);
  });
});
