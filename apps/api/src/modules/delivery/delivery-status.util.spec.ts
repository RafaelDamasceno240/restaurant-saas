import { DeliveryStatus } from '@prisma/client';
import { canEditDeliveryNotes, isValidDeliveryTransition } from './delivery-status.util';

const ALL: DeliveryStatus[] = ['PENDING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'FAILED'];

describe('isValidDeliveryTransition', () => {
  it.each([
    ['PENDING', 'OUT_FOR_DELIVERY'],
    ['PENDING', 'CANCELLED'],
    ['OUT_FOR_DELIVERY', 'DELIVERED'],
    ['OUT_FOR_DELIVERY', 'FAILED'],
    ['FAILED', 'PENDING'],
    ['FAILED', 'CANCELLED'],
  ] as [DeliveryStatus, DeliveryStatus][])('allows %s -> %s', (from, to) => {
    expect(isValidDeliveryTransition(from, to)).toBe(true);
  });

  it('allows nothing else: every other pair is rejected', () => {
    const allowed = new Set([
      'PENDING>OUT_FOR_DELIVERY',
      'PENDING>CANCELLED',
      'OUT_FOR_DELIVERY>DELIVERED',
      'OUT_FOR_DELIVERY>FAILED',
      'FAILED>PENDING',
      'FAILED>CANCELLED',
    ]);
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
    expect(isValidDeliveryTransition('PENDING', 'FAILED')).toBe(false);
    expect(isValidDeliveryTransition('OUT_FOR_DELIVERY', 'PENDING')).toBe(false);
    expect(isValidDeliveryTransition('OUT_FOR_DELIVERY', 'CANCELLED')).toBe(false);
  });

  it('never lets a failed delivery jump straight to delivered or out for delivery', () => {
    expect(isValidDeliveryTransition('FAILED', 'DELIVERED')).toBe(false);
    expect(isValidDeliveryTransition('FAILED', 'OUT_FOR_DELIVERY')).toBe(false);
  });
});

describe('canEditDeliveryNotes', () => {
  it('allows editing while the delivery is alive, including after a failure', () => {
    for (const status of ['PENDING', 'OUT_FOR_DELIVERY', 'FAILED'] as DeliveryStatus[]) {
      expect(canEditDeliveryNotes(status)).toBe(true);
    }
  });

  it('locks the observation of a delivered or cancelled delivery', () => {
    expect(canEditDeliveryNotes('DELIVERED')).toBe(false);
    expect(canEditDeliveryNotes('CANCELLED')).toBe(false);
  });
});
