import { MAX_UNITS_PER_PRODUCT, productOverUnitLimit } from './item-quantity.util';

describe('productOverUnitLimit (B7)', () => {
  it('is 50 units per product', () => {
    expect(MAX_UNITS_PER_PRODUCT).toBe(50);
  });

  it('accepts up to 50 units of each product, however many products', () => {
    expect(productOverUnitLimit([])).toBeNull();
    expect(productOverUnitLimit([{ productId: 'a', quantity: 50 }, { productId: 'b', quantity: 50 }])).toBeNull();
    expect(productOverUnitLimit([{ productId: 'a', quantity: 20 }, { productId: 'a', quantity: 30 }])).toBeNull();
  });

  it('adds up repeated lines of the same product and names the first one over the limit', () => {
    expect(productOverUnitLimit([{ productId: 'a', quantity: 51 }])).toBe('a');
    expect(
      productOverUnitLimit([
        { productId: 'b', quantity: 10 },
        { productId: 'a', quantity: 30 },
        { productId: 'a', quantity: 21 },
      ]),
    ).toBe('a');
  });
});
