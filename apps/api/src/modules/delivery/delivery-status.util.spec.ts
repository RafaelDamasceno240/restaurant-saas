import { DeliveryStatus } from '@prisma/client';
import { isValidDeliveryTransition } from './delivery-status.util';

const ALL: DeliveryStatus[] = ['PENDING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED'];

describe('isValidDeliveryTransition', () => {
  it.each([
    ['PENDING', 'OUT_FOR_DELIVERY'],
    ['PENDING', 'CANCELLED'],
    ['OUT_FOR_DELIVERY', 'DELIVERED'],
  ] as [DeliveryStatus, DeliveryStatus][])('allows %s -> %s', (from, to) => {
    expect(isValidDeliveryTransition(from, to)).toBe(true);
  });

  it('allows nothing else: every other pair is rejected', () => {
    const allowed = new Set(['PENDING>OUT_FOR_DELIVERY', 'PENDING>CANCELLED', 'OUT_FOR_DELIVERY>DELIVERED']);
    for (const from of ALL) {
      for (const to of ALL) {
        expect(isValidDeliveryTransition(from, to)).toBe(allowed.has(`${from}>${to}`));
      }
    }
  });

  it('treats DELIVERED and CANCELLED as final', () => {
    for (const to of ALL) {
      expect(isValidDeliveryTransition('DELIVERED', to)).toBe(false);
      expect(isValidDeliveryTransition('CANCELLED', to)).toBe(false);
    }
  });

  it('does not allow skipping the dispatch or going backwards', () => {
    expect(isValidDeliveryTransition('PENDING', 'DELIVERED')).toBe(false);
    expect(isValidDeliveryTransition('OUT_FOR_DELIVERY', 'PENDING')).toBe(false);
    expect(isValidDeliveryTransition('OUT_FOR_DELIVERY', 'CANCELLED')).toBe(false);
  });
});
