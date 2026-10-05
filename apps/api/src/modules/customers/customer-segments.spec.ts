import { classifyCustomer, CUSTOMER_SEGMENTS, segmentBoundaries } from './customer-segments';

const NOW = new Date('2026-10-04T12:00:00.000Z');
const bounds = segmentBoundaries(NOW);
const daysAgo = (days: number) => new Date(NOW.getTime() - days * 86_400_000);
const classify = (ordersCount: number, first: Date | null, last: Date | null) =>
  classifyCustomer({ ordersCount, firstOrderAt: first, lastOrderAt: last }, bounds);

describe('segmentBoundaries', () => {
  it('is 30, 60 and 180 days before now', () => {
    expect(bounds.newSince).toEqual(daysAgo(30));
    expect(bounds.recentSince).toEqual(daysAgo(60));
    expect(bounds.lostBefore).toEqual(daysAgo(180));
  });
});

describe('classifyCustomer', () => {
  it('a customer who never purchased is LOST and nothing else', () => {
    expect(classify(0, null, null)).toEqual(['LOST']);
  });

  it('a single purchase this month is NEW, not recurring', () => {
    expect(classify(1, daysAgo(3), daysAgo(3))).toEqual(['NEW']);
  });

  it('two purchases this month are NEW and RECURRING at once', () => {
    expect(classify(2, daysAgo(10), daysAgo(1))).toEqual(['NEW', 'RECURRING']);
  });

  it('an old customer who keeps buying is RECURRING only', () => {
    expect(classify(12, daysAgo(400), daysAgo(5))).toEqual(['RECURRING']);
  });

  it('one old purchase inside the recent window belongs to no segment', () => {
    expect(classify(1, daysAgo(45), daysAgo(45))).toEqual([]);
  });

  it('no purchase for more than 60 days is AT_RISK, however many purchases there were', () => {
    expect(classify(1, daysAgo(90), daysAgo(90))).toEqual(['AT_RISK']);
    expect(classify(30, daysAgo(700), daysAgo(61))).toEqual(['AT_RISK']);
  });

  it('no purchase for more than 180 days is LOST', () => {
    expect(classify(8, daysAgo(900), daysAgo(181))).toEqual(['LOST']);
  });

  it('the boundaries are inclusive on the recent side, to the millisecond', () => {
    expect(classify(1, bounds.newSince, bounds.newSince)).toEqual(['NEW']);
    expect(classify(1, new Date(bounds.newSince.getTime() - 1), new Date(bounds.newSince.getTime() - 1))).toEqual([]);
    expect(classify(2, daysAgo(300), bounds.recentSince)).toEqual(['RECURRING']);
    expect(classify(2, daysAgo(300), new Date(bounds.recentSince.getTime() - 1))).toEqual(['AT_RISK']);
    expect(classify(2, daysAgo(300), bounds.lostBefore)).toEqual(['AT_RISK']);
    expect(classify(2, daysAgo(300), new Date(bounds.lostBefore.getTime() - 1))).toEqual(['LOST']);
  });

  it('AT_RISK and LOST never coexist, and neither coexists with NEW or RECURRING', () => {
    for (let last = 0; last <= 400; last += 7) {
      for (const count of [1, 2, 9]) {
        const segments = classify(count, daysAgo(last + (count > 1 ? 20 : 0)), daysAgo(last));
        const stale = segments.filter((s) => s === 'AT_RISK' || s === 'LOST');
        expect(stale.length).toBeLessThanOrEqual(1);
        if (stale.length === 1) expect(segments).toHaveLength(1);
        for (const segment of segments) expect(CUSTOMER_SEGMENTS).toContain(segment);
      }
    }
  });
});
