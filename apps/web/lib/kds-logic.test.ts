import type { AdminOrderListItem, OrdersBoard } from './orders-api';
import {
  boardColumn,
  columnCountLabel,
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
      expect(boardColumn(board, 'PENDING')).toEqual({ orders: [order('p1'), order('p2')], total: 2 });
      expect(boardColumn(board, 'PREPARING').orders.map((o) => o.id)).toEqual(['r1']);
      expect(boardColumn(board, 'CONFIRMED')).toEqual({ orders: [], total: 0 });
    });

    it('treats a board that has not arrived, or a missing column, as empty', () => {
      expect(boardColumn(undefined, 'PENDING')).toEqual({ orders: [], total: 0 });
      expect(boardColumn({ columnLimit: 50, columns: [] }, 'READY')).toEqual({ orders: [], total: 0 });
    });
  });

  describe('columnCountLabel', () => {
    it('shows the total, and says so when the column was capped', () => {
      expect(columnCountLabel(boardColumn(board, 'PENDING'))).toBe('2');
      expect(columnCountLabel(boardColumn(board, 'CONFIRMED'))).toBe('0');
      expect(columnCountLabel(boardColumn(board, 'READY'))).toBe('2 de 120');
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
