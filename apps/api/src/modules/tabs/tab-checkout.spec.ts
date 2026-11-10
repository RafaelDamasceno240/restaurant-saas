import { buildPricedItemsFromTab, classifyExistingCheckout } from './tab-checkout';
import { computeTabTotals } from './tab-calculations';

describe('buildPricedItemsFromTab', () => {
  it('prices every line from the TabItem snapshot, one OrderItem per TabItem, naming the tab item it bills', () => {
    const items = [
      { id: 't1', productId: 'p1', productNameSnapshot: 'X-Burger', unitPriceCentsSnapshot: 2990, quantity: 2, cancelledQuantity: 0 },
      { id: 't2', productId: 'p1', productNameSnapshot: 'X-Burger', unitPriceCentsSnapshot: 2990, quantity: 1, cancelledQuantity: 0 },
      { id: 't3', productId: 'p2', productNameSnapshot: 'Suco', unitPriceCentsSnapshot: 850, quantity: 1, cancelledQuantity: 0 },
    ];
    expect(buildPricedItemsFromTab(items)).toEqual([
      { productId: 'p1', productNameSnapshot: 'X-Burger', unitPriceCents: 2990, quantity: 2, tabItemId: 't1' },
      { productId: 'p1', productNameSnapshot: 'X-Burger', unitPriceCents: 2990, quantity: 1, tabItemId: 't2' },
      { productId: 'p2', productNameSnapshot: 'Suco', unitPriceCents: 850, quantity: 1, tabItemId: 't3' },
    ]);
  });

  it('B9: bills only the units still due and leaves out lines with every unit cancelled', () => {
    const items = [
      { id: 't1', productId: 'p1', productNameSnapshot: 'X-Burger', unitPriceCentsSnapshot: 2500, quantity: 3, cancelledQuantity: 1 },
      { id: 't2', productId: 'p2', productNameSnapshot: 'Batata', unitPriceCentsSnapshot: 1200, quantity: 2, cancelledQuantity: 2 },
    ];
    expect(buildPricedItemsFromTab(items)).toEqual([
      { productId: 'p1', productNameSnapshot: 'X-Burger', unitPriceCents: 2500, quantity: 2, tabItemId: 't1' },
    ]);
  });

  it('keeps the sale total equal to the tab total', () => {
    const items = [
      { id: 't1', productId: 'p1', productNameSnapshot: 'A', unitPriceCentsSnapshot: 1250, quantity: 3, cancelledQuantity: 0 },
      { id: 't2', productId: 'p2', productNameSnapshot: 'B', unitPriceCentsSnapshot: 725, quantity: 2, cancelledQuantity: 1 },
    ];
    const saleTotal = buildPricedItemsFromTab(items).reduce((s, i) => s + i.unitPriceCents * i.quantity, 0);
    expect(saleTotal).toBe(computeTabTotals(items).totalCents);
    expect(saleTotal).toBe(4475);
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
