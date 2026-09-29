import { isValidOrderStatusTransition } from './order-status.util';

describe('isValidOrderStatusTransition', () => {
  it.each([
    ['PENDING', 'CONFIRMED'],
    ['PENDING', 'CANCELLED'],
    ['CONFIRMED', 'PREPARING'],
    ['CONFIRMED', 'CANCELLED'],
    ['PREPARING', 'READY'],
    ['PREPARING', 'CANCELLED'],
    ['READY', 'COMPLETED'],
  ] as const)('allows %s -> %s', (from, to) => {
    expect(isValidOrderStatusTransition(from, to)).toBe(true);
  });

  it.each([
    ['PENDING', 'COMPLETED'],
    ['PENDING', 'PREPARING'],
    ['PENDING', 'READY'],
    ['CONFIRMED', 'READY'],
    ['CONFIRMED', 'COMPLETED'],
    ['PREPARING', 'CONFIRMED'],
    ['READY', 'PREPARING'],
    ['COMPLETED', 'PREPARING'],
    ['CANCELLED', 'PENDING'],
    ['CANCELLED', 'CONFIRMED'],
  ] as const)('rejects the invalid jump %s -> %s', (from, to) => {
    expect(isValidOrderStatusTransition(from, to)).toBe(false);
  });

  it('rejects any transition into or out of the not-yet-implemented delivery statuses', () => {
    expect(isValidOrderStatusTransition('READY', 'OUT_FOR_DELIVERY')).toBe(false);
    expect(isValidOrderStatusTransition('OUT_FOR_DELIVERY', 'DELIVERED')).toBe(false);
    expect(isValidOrderStatusTransition('DELIVERED', 'COMPLETED')).toBe(false);
  });

  it('never allows a terminal status to transition anywhere', () => {
    (['CANCELLED', 'COMPLETED'] as const).forEach((terminal) => {
      (['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'CANCELLED', 'COMPLETED'] as const).forEach(
        (target) => {
          expect(isValidOrderStatusTransition(terminal, target)).toBe(false);
        },
      );
    });
  });
});
