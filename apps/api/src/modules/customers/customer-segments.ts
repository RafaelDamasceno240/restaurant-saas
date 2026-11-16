// Customer segmentation (Fase 11, CRM avançado). Pure: no I/O, so the rules are unit-tested
// alone and the SQL filter of the list is checked against them in the e2e suite.
//
// Everything is derived from the customer's BILLABLE orders (every status but CANCELLED, the
// same rule as the metrics - see customer-metrics.ts). Nothing is stored: a customer's segments
// change by themselves as time passes and orders arrive.
//
// The rules (decision, documented in docs/CRM.md):
//   NEW        first purchase in the last 30 days
//   RECURRING  at least 2 purchases, the last one in the last 60 days
//   AT_RISK    has purchased, but the last purchase was more than 60 and at most 180 days ago
//              ("sem compra recente")
//   LOST       never purchased, or the last purchase was more than 180 days ago ("inativos" in
//              the commercial sense; NOT the registry flag `active`, which is a separate filter)
// A customer may be NEW and RECURRING at once (two purchases this month). AT_RISK and LOST are
// mutually exclusive, and neither can coexist with NEW or RECURRING.
//
// "Maior gasto" and "maior ticket" are not segments: they are ORDERINGS of the list.
export const NEW_WINDOW_DAYS = 30;
export const RECENT_WINDOW_DAYS = 60;
export const LOST_AFTER_DAYS = 180;

export const CUSTOMER_SEGMENTS = ['NEW', 'RECURRING', 'AT_RISK', 'LOST'] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

export const CUSTOMER_SORTS = ['name', 'spent', 'ticket', 'orders', 'recent'] as const;
export type CustomerSort = (typeof CUSTOMER_SORTS)[number];

const DAY_MS = 86_400_000;

export interface SegmentBoundaries {
  // A first purchase at or after this instant makes the customer NEW.
  newSince: Date;
  // A last purchase at or after this instant is "recent".
  recentSince: Date;
  // A last purchase before this instant means the customer is LOST.
  lostBefore: Date;
}

// Computed once per request and used by BOTH the SQL filter and classifyCustomer(), so a row
// returned for a segment is always classified into it, to the millisecond.
export function segmentBoundaries(now: Date): SegmentBoundaries {
  const at = (days: number) => new Date(now.getTime() - days * DAY_MS);
  return { newSince: at(NEW_WINDOW_DAYS), recentSince: at(RECENT_WINDOW_DAYS), lostBefore: at(LOST_AFTER_DAYS) };
}

export interface PurchaseSummary {
  ordersCount: number;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
}

export function classifyCustomer(summary: PurchaseSummary, bounds: SegmentBoundaries): CustomerSegment[] {
  const { ordersCount, firstOrderAt, lastOrderAt } = summary;
  if (ordersCount <= 0 || !firstOrderAt || !lastOrderAt) return ['LOST'];

  const segments: CustomerSegment[] = [];
  if (firstOrderAt >= bounds.newSince) segments.push('NEW');
  if (ordersCount >= 2 && lastOrderAt >= bounds.recentSince) segments.push('RECURRING');
  if (lastOrderAt < bounds.recentSince && lastOrderAt >= bounds.lostBefore) segments.push('AT_RISK');
  if (lastOrderAt < bounds.lostBefore) segments.push('LOST');
  return segments;
}
