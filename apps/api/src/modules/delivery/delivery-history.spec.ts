import { buildHistory, HistoryAuditRow } from './delivery-history';

let n = 0;
const row = (action: string, sec: number, afterData: unknown = {}, beforeData: unknown = {}): HistoryAuditRow => ({
  id: `r${++n}`,
  action,
  createdAt: new Date(2026, 0, 1, 0, 0, sec),
  actor: { id: 'u1', name: 'Ana' },
  beforeData,
  afterData,
});

describe('buildHistory', () => {
  const created = new Date(2026, 0, 1);

  it('starts with a synthetic CREATED event', () => {
    const h = buildHistory(created, []);
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ kind: 'CREATED', attempt: null, actor: null });
  });

  it('derives attempt numbers by counting dispatches', () => {
    const h = buildHistory(created, [
      row('DELIVERY_DISPATCHED', 1),
      row('DELIVERY_FAILED', 2, { reason: 'Cliente ausente' }),
      row('DELIVERY_REDELIVERY_REQUESTED', 3),
      row('DELIVERY_DISPATCHED', 4),
      row('DELIVERY_COMPLETED', 5),
    ]);
    expect(h.slice(1).map((e) => [e.kind, e.attempt])).toEqual([
      ['DISPATCHED', 1],
      ['FAILED', 1],
      ['REDELIVERY_REQUESTED', 1],
      ['DISPATCHED', 2],
      ['COMPLETED', 2],
    ]);
    expect(h[2].reason).toBe('Cliente ausente');
  });

  it('keeps assignment events outside attempts and tracks couriers', () => {
    const h = buildHistory(created, [
      row('DELIVERY_ASSIGNED', 1, { courierUserId: 'c1' }, { courierUserId: null }),
      row('DELIVERY_REASSIGNED', 2, { courierUserId: 'c2', previousCourierUserId: 'c1' }, { courierUserId: 'c1' }),
      row('DELIVERY_UNASSIGNED', 3, { courierUserId: null }, { courierUserId: 'c2' }),
    ]);
    expect(h.slice(1).map((e) => [e.kind, e.attempt, e.courierUserId, e.previousCourierUserId])).toEqual([
      ['ASSIGNED', null, 'c1', null],
      ['REASSIGNED', null, 'c2', 'c1'],
      ['UNASSIGNED', null, null, 'c2'],
    ]);
  });

  it('orders by time then id, skips unknown actions and tolerates odd payloads', () => {
    const h = buildHistory(created, [
      row('DELIVERY_COMPLETED', 9, null),
      row('SOMETHING_ELSE', 5),
      row('DELIVERY_DISPATCHED', 1, [1, 2]),
    ]);
    expect(h.map((e) => e.kind)).toEqual(['CREATED', 'DISPATCHED', 'COMPLETED']);
  });
});
