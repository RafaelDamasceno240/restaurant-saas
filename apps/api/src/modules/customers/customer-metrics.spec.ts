import { buildMetrics, isBillableOrderStatus } from './customer-metrics';

const d = (day: number) => new Date(2026, 8, day);

describe('isBillableOrderStatus', () => {
  it('counts every status except CANCELLED (same rule as the dashboard)', () => {
    for (const status of ['PENDING', 'CONFIRMED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED', 'COMPLETED'] as const) {
      expect(isBillableOrderStatus(status)).toBe(true);
    }
    expect(isBillableOrderStatus('CANCELLED')).toBe(false);
  });
});

describe('buildMetrics', () => {
  it('is all zero (and no last order) for a customer without orders', () => {
    expect(buildMetrics([])).toEqual({
      ordersCount: 0,
      cancelledCount: 0,
      totalSpentCents: 0,
      averageTicketCents: 0,
      lastOrderAt: null,
    });
  });

  it('sums billable groups and keeps cancelled orders out of the money', () => {
    const m = buildMetrics([
      { status: 'COMPLETED', count: 2, totalCents: 5000, lastOrderAt: d(10) },
      { status: 'PENDING', count: 1, totalCents: 2500, lastOrderAt: d(12) },
      { status: 'CANCELLED', count: 3, totalCents: 99999, lastOrderAt: d(20) },
    ]);
    expect(m).toEqual({
      ordersCount: 3,
      cancelledCount: 3,
      totalSpentCents: 7500,
      averageTicketCents: 2500,
      lastOrderAt: d(12), // the cancelled order of day 20 is not a purchase
    });
  });

  it('rounds the average ticket to whole cents, half up', () => {
    const m = buildMetrics([{ status: 'COMPLETED', count: 3, totalCents: 1000, lastOrderAt: d(1) }]);
    expect(m.averageTicketCents).toBe(333);
    expect(buildMetrics([{ status: 'COMPLETED', count: 2, totalCents: 1001, lastOrderAt: d(1) }]).averageTicketCents).toBe(501);
  });

  it('a customer with only cancelled orders has no spend and no last purchase', () => {
    const m = buildMetrics([{ status: 'CANCELLED', count: 2, totalCents: 4000, lastOrderAt: d(5) }]);
    expect(m).toMatchObject({ ordersCount: 0, cancelledCount: 2, totalSpentCents: 0, averageTicketCents: 0, lastOrderAt: null });
  });
});
