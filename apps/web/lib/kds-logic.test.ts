import type { AdminOrderListItem, KitchenTableRound, OrdersBoard } from './orders-api';
import {
  boardColumn,
  columnCards,
  columnCountLabel,
  newCardIds,
  ROUND_ACTION,
  roundTitle,
  KDS_COLUMN_LABEL,
  KDS_POLL_INTERVAL_MS,
  KDS_STATUSES,
  kdsPollsPerMinute,
  newPendingOrderArrived,
} from './kds-logic';

const order = (id: string): AdminOrderListItem => ({ id }) as AdminOrderListItem;

const board: OrdersBoard = {
  columnLimit: 50,
  columns: [
    { status: 'PENDING', total: 2, data: [order('p1'), order('p2')] },
    { status: 'CONFIRMED', total: 0, data: [] },
    { status: 'PREPARING', total: 1, data: [order('r1')] },
    { status: 'READY', total: 120, data: [order('d1'), order('d2')] },
  ],
};

describe('kds-logic', () => {
  it('lays out the four in-progress statuses in the order of the flow, each with a label', () => {
    expect([...KDS_STATUSES]).toEqual(['PENDING', 'CONFIRMED', 'PREPARING', 'READY']);
    for (const status of KDS_STATUSES) expect(KDS_COLUMN_LABEL[status]).toBeTruthy();
  });

  describe('boardColumn', () => {
    it('gives each column its own orders and total', () => {
      expect(boardColumn(board, 'PENDING')).toEqual({ orders: [order('p1'), order('p2')], total: 2, rounds: [], roundsTotal: 0 });
      expect(boardColumn(board, 'PREPARING').orders.map((o) => o.id)).toEqual(['r1']);
      expect(boardColumn(board, 'CONFIRMED')).toEqual({ orders: [], total: 0, rounds: [], roundsTotal: 0 });
    });

    it('treats a board that has not arrived, or a missing column, as empty', () => {
      expect(boardColumn(undefined, 'PENDING')).toEqual({ orders: [], total: 0, rounds: [], roundsTotal: 0 });
      expect(boardColumn({ columnLimit: 50, columns: [] }, 'READY')).toEqual({ orders: [], total: 0, rounds: [], roundsTotal: 0 });
    });
  });

  describe('columnCountLabel', () => {
    it('shows the total, and says so when the column was capped', () => {
      expect(columnCountLabel(boardColumn(board, 'PENDING'))).toBe('2');
      expect(columnCountLabel(boardColumn(board, 'CONFIRMED'))).toBe('0');
      expect(columnCountLabel(boardColumn(board, 'READY'))).toBe('2 de 120');
    });
  });

  describe('table rounds (B9)', () => {
    const round = (id: string, sentAt: string, extra: Partial<KitchenTableRound> = {}): KitchenTableRound => ({
      id,
      tabId: 't',
      roundNumber: 1,
      tableNumber: 4,
      tableName: null,
      sentAt,
      status: 'SENT',
      items: [],
      ...extra,
    });
    const withRounds: OrdersBoard = {
      columnLimit: 50,
      columns: [
        {
          status: 'PENDING',
          total: 1,
          data: [{ ...order('p1'), createdAt: '2026-10-24T12:05:00.000Z' }],
          tableRounds: [round('r2', '2026-10-24T12:10:00.000Z'), round('r1', '2026-10-24T12:00:00.000Z')],
          tableRoundsTotal: 2,
        },
      ],
    };

    it('shows orders and rounds of a column together, newest first, and counts both', () => {
      const column = boardColumn(withRounds, 'PENDING');
      expect(columnCards(column).map((c) => (c.kind === 'order' ? c.order.id : c.round.id))).toEqual(['r2', 'p1', 'r1']);
      expect(columnCountLabel(column)).toBe('3');
      expect(columnCountLabel({ ...column, roundsTotal: 60 })).toBe('3 de 61');
    });

    it('rings for a new round as for a new order', () => {
      const before = new Set(newCardIds({ ...withRounds, columns: [{ ...withRounds.columns[0], tableRounds: [round('r1', 'x')] }] }));
      expect(newPendingOrderArrived(before, newCardIds(withRounds))).toBe(true);
      expect(newPendingOrderArrived(new Set(newCardIds(withRounds)), newCardIds(withRounds))).toBe(false);
    });

    it('has no "Aceitar": a new round starts being prepared, then is ready, then delivered', () => {
      expect(ROUND_ACTION.SENT).toEqual({ label: 'Iniciar preparo', to: 'PREPARING' });
      expect(ROUND_ACTION.PREPARING.to).toBe('READY');
      expect(ROUND_ACTION.READY.to).toBe('SERVED');
      expect(Object.values(ROUND_ACTION).map((a) => a.label)).not.toContain('Aceitar');
    });

    it('names the table and the round', () => {
      expect(roundTitle({ tableNumber: 4, tableName: null, roundNumber: 2 })).toBe('Mesa 4 · rodada 2');
      expect(roundTitle({ tableNumber: 7, tableName: 'Varanda', roundNumber: 1 })).toBe('Mesa 7 (Varanda) · rodada 1');
    });
  });

  describe('newPendingOrderArrived', () => {
    it('never rings for what was already waiting when the screen was opened', () => {
      expect(newPendingOrderArrived(null, ['p1', 'p2'])).toBe(false);
    });

    it('rings when an id shows up that was not there before', () => {
      expect(newPendingOrderArrived(new Set(['p1']), ['p1', 'p2'])).toBe(true);
      expect(newPendingOrderArrived(new Set(), ['p1'])).toBe(true);
    });

    it('stays quiet when nothing new arrived, including when orders left the column', () => {
      expect(newPendingOrderArrived(new Set(['p1', 'p2']), ['p1', 'p2'])).toBe(false);
      expect(newPendingOrderArrived(new Set(['p1', 'p2']), ['p2'])).toBe(false);
      expect(newPendingOrderArrived(new Set(['p1']), [])).toBe(false);
    });
  });

  describe('request budget', () => {
    // The API accepts 100 requests per minute per route and per network address
    // (ThrottlerModule in apps/api/src/app.module.ts). Devices on the same Wi-Fi share it.
    const ROUTE_LIMIT_PER_MINUTE = 100;

    it('keeps polling every 5 seconds: 12 board requests per screen per minute', () => {
      expect(KDS_POLL_INTERVAL_MS).toBe(5_000);
      expect(kdsPollsPerMinute()).toBe(12);
    });

    it('leaves room for several kitchen screens on one address, which four requests per poll did not', () => {
      const perScreen = kdsPollsPerMinute();
      expect(6 * perScreen).toBeLessThan(ROUTE_LIMIT_PER_MINUTE);
      // What the screen used to do: one request per column.
      const before = KDS_STATUSES.length * perScreen;
      expect(2 * before).toBeGreaterThan(ROUTE_LIMIT_PER_MINUTE - 10);
    });
  });
});
