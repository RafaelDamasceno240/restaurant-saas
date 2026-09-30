// Operational timeline of a delivery, rebuilt from the audit log (no history table).
//
// The attempt number is DERIVED: it counts DELIVERY_DISPATCHED events in order, so it does
// not depend on any field stored in the audit payload. A failure, a completion and a
// redelivery request belong to the attempt that was in progress.

export const HISTORY_ACTIONS = [
  'DELIVERY_ASSIGNED',
  'DELIVERY_REASSIGNED',
  'DELIVERY_UNASSIGNED',
  'DELIVERY_DISPATCHED',
  'DELIVERY_FAILED',
  'DELIVERY_REDELIVERY_REQUESTED',
  'DELIVERY_COMPLETED',
  'DELIVERY_NOTES_UPDATED',
  'DELIVERY_CANCELLED',
] as const;

export type HistoryKind =
  | 'CREATED'
  | 'ASSIGNED'
  | 'REASSIGNED'
  | 'UNASSIGNED'
  | 'DISPATCHED'
  | 'FAILED'
  | 'REDELIVERY_REQUESTED'
  | 'COMPLETED'
  | 'NOTES_UPDATED'
  | 'CANCELLED';

const KIND_BY_ACTION: Record<(typeof HISTORY_ACTIONS)[number], HistoryKind> = {
  DELIVERY_ASSIGNED: 'ASSIGNED',
  DELIVERY_REASSIGNED: 'REASSIGNED',
  DELIVERY_UNASSIGNED: 'UNASSIGNED',
  DELIVERY_DISPATCHED: 'DISPATCHED',
  DELIVERY_FAILED: 'FAILED',
  DELIVERY_REDELIVERY_REQUESTED: 'REDELIVERY_REQUESTED',
  DELIVERY_COMPLETED: 'COMPLETED',
  DELIVERY_NOTES_UPDATED: 'NOTES_UPDATED',
  DELIVERY_CANCELLED: 'CANCELLED',
};

const ATTEMPT_KINDS: ReadonlySet<HistoryKind> = new Set(['DISPATCHED', 'FAILED', 'COMPLETED', 'REDELIVERY_REQUESTED']);

export interface HistoryAuditRow {
  id: string;
  action: string;
  createdAt: Date;
  actor: { id: string; name: string } | null;
  beforeData: unknown;
  afterData: unknown;
}

export interface HistoryEvent {
  id: string;
  kind: HistoryKind;
  at: Date;
  actor: { id: string; name: string } | null;
  // 1-based attempt the event belongs to; null for events outside an attempt.
  attempt: number | null;
  // Human reason, only for FAILED.
  reason: string | null;
  // Courier responsible at that moment (assignment target, or the assignee during the attempt).
  courierUserId: string | null;
  // Courier that was removed / replaced (UNASSIGNED, REASSIGNED).
  previousCourierUserId: string | null;
}

function field(data: unknown, key: string): string | null {
  if (data && typeof data === 'object' && !Array.isArray(data)) {
    const value = (data as Record<string, unknown>)[key];
    return typeof value === 'string' && value !== '' ? value : null;
  }
  return null;
}

export function buildHistory(createdAt: Date, rows: readonly HistoryAuditRow[]): HistoryEvent[] {
  const ordered = [...rows].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
  const events: HistoryEvent[] = [
    {
      id: 'created',
      kind: 'CREATED',
      at: createdAt,
      actor: null,
      attempt: null,
      reason: null,
      courierUserId: null,
      previousCourierUserId: null,
    },
  ];

  let attempts = 0;
  for (const row of ordered) {
    const kind = KIND_BY_ACTION[row.action as (typeof HISTORY_ACTIONS)[number]];
    if (!kind) continue;
    if (kind === 'DISPATCHED') attempts += 1;

    const removed = kind === 'UNASSIGNED';
    events.push({
      id: row.id,
      kind,
      at: row.createdAt,
      actor: row.actor,
      attempt: ATTEMPT_KINDS.has(kind) && attempts > 0 ? attempts : null,
      reason: kind === 'FAILED' ? field(row.afterData, 'reason') : null,
      courierUserId: removed ? null : field(row.afterData, 'courierUserId'),
      previousCourierUserId: removed || kind === 'REASSIGNED' ? field(row.beforeData, 'courierUserId') : null,
    });
  }
  return events;
}
