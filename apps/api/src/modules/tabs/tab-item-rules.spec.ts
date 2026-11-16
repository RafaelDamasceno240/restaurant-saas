import { decideCancellation, isValidTabItemTransition } from './tab-item-rules';

describe('isValidTabItemTransition', () => {
  it('lets the kitchen move forward and the waiter deliver from any production state', () => {
    expect(isValidTabItemTransition('SENT', 'PREPARING')).toBe(true);
    expect(isValidTabItemTransition('PREPARING', 'READY')).toBe(true);
    expect(isValidTabItemTransition('READY', 'SERVED')).toBe(true);
    expect(isValidTabItemTransition('SENT', 'SERVED')).toBe(true);
    expect(isValidTabItemTransition('SENT', 'READY')).toBe(true);
  });

  it('never moves backwards nor out of SERVED/CANCELLED, and never cancels (that is a cancellation)', () => {
    expect(isValidTabItemTransition('READY', 'PREPARING')).toBe(false);
    expect(isValidTabItemTransition('PREPARING', 'SENT')).toBe(false);
    expect(isValidTabItemTransition('SERVED', 'READY')).toBe(false);
    expect(isValidTabItemTransition('CANCELLED', 'SENT')).toBe(false);
    expect(isValidTabItemTransition('SENT', 'CANCELLED')).toBe(false);
  });
});

describe('decideCancellation', () => {
  const decide = (status: Parameters<typeof decideCancellation>[0]['status'], returnToStock?: boolean, consumedStock = true) =>
    decideCancellation({ status, consumedStock, returnToStock });

  it('SENT: any waiter, the ingredients always go back', () => {
    expect(decide('SENT')).toEqual({ ok: true, needsManager: false, stockOutcome: 'RETURNED' });
    expect(decide('SENT', false)).toEqual({ ok: true, needsManager: false, stockOutcome: 'RETURNED' });
  });

  it('PREPARING and READY: manager only, lost by default, back to the stock when asked', () => {
    for (const status of ['PREPARING', 'READY'] as const) {
      expect(decide(status)).toEqual({ ok: true, needsManager: true, stockOutcome: 'WASTED' });
      expect(decide(status, false)).toEqual({ ok: true, needsManager: true, stockOutcome: 'WASTED' });
      expect(decide(status, true)).toEqual({ ok: true, needsManager: true, stockOutcome: 'RETURNED' });
    }
  });

  it('SERVED: manager only, lost, and asking to return it is refused', () => {
    expect(decide('SERVED')).toEqual({ ok: true, needsManager: true, stockOutcome: 'WASTED' });
    expect(decide('SERVED', true)).toEqual({ ok: false, code: 'SERVED_ITEM_CANNOT_RETURN' });
  });

  it('nothing consumed (no recipe, legacy item): NONE, with the same permission rule', () => {
    expect(decide('SENT', undefined, false)).toEqual({ ok: true, needsManager: false, stockOutcome: 'NONE' });
    expect(decide('READY', true, false)).toEqual({ ok: true, needsManager: true, stockOutcome: 'NONE' });
    expect(decide('SERVED', undefined, false)).toEqual({ ok: true, needsManager: true, stockOutcome: 'NONE' });
  });

  it('an item with every unit cancelled cannot be cancelled again', () => {
    expect(decide('CANCELLED')).toEqual({ ok: false, code: 'TAB_ITEM_ALREADY_CANCELLED' });
  });
});
