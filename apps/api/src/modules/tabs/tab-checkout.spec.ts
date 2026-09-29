import { buildPricedItemsFromTab, classifyExistingCheckout } from './tab-checkout';
import { computeTabTotals } from './tab-calculations';

describe('buildPricedItemsFromTab', () => {
  it('prices every line from the TabItem snapshot, one OrderItem per TabItem', () => {
    const items = [
      { productId: 'p1', productNameSnapshot: 'X-Burger', unitPriceCentsSnapshot: 2990, quantity: 2 },
      { productId: 'p1', productNameSnapshot: 'X-Burger', unitPriceCentsSnapshot: 2990, quantity: 1 },
      { productId: 'p2', productNameSnapshot: 'Suco', unitPriceCentsSnapshot: 850, quantity: 1 },
    ];
    expect(buildPricedItemsFromTab(items)).toEqual([
      { productId: 'p1', productNameSnapshot: 'X-Burger', unitPriceCents: 2990, quantity: 2 },
      { productId: 'p1', productNameSnapshot: 'X-Burger', unitPriceCents: 2990, quantity: 1 },
      { productId: 'p2', productNameSnapshot: 'Suco', unitPriceCents: 850, quantity: 1 },
    ]);
  });

  it('keeps the sale total equal to the tab total', () => {
    const items = [
      { productId: 'p1', productNameSnapshot: 'A', unitPriceCentsSnapshot: 1250, quantity: 3 },
      { productId: 'p2', productNameSnapshot: 'B', unitPriceCentsSnapshot: 725, quantity: 2 },
    ];
    const saleTotal = buildPricedItemsFromTab(items).reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
    expect(saleTotal).toBe(computeTabTotals(items).totalCents);
    expect(saleTotal).toBe(5200);
  });
});

describe('classifyExistingCheckout', () => {
  const request = { tabId: 'tab-1', idempotencyKey: 'key-1' };

  it('same tab + same key is a replay', () => {
    expect(classifyExistingCheckout({ tabId: 'tab-1', idempotencyKey: 'key-1' }, request)).toBe('REPLAY');
  });

  it('same tab + different key means the tab was already sold', () => {
    expect(classifyExistingCheckout({ tabId: 'tab-1', idempotencyKey: 'key-2' }, request)).toBe(
      'TAB_ALREADY_CHECKED_OUT',
    );
  });

  it('key already bound to another tab is a reused key', () => {
    expect(classifyExistingCheckout({ tabId: 'tab-2', idempotencyKey: 'key-1' }, request)).toBe(
      'IDEMPOTENCY_KEY_REUSED',
    );
  });
});
