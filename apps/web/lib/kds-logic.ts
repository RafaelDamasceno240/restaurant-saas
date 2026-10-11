import type { AdminOrderListItem, OrdersBoard, OrderStatus } from './orders-api';

// The kitchen screen asks for the whole board every few seconds. One request per poll, whatever
// the number of columns: the API limits requests per route and per network address, and a
// restaurant's devices usually leave through one address (the same Wi-Fi), so what one screen
// spends is spent for all of them.
export const KDS_POLL_INTERVAL_MS = 5_000;

// The columns, in the order of the flow. The API decides what the board contains
// (ORDER_BOARD_STATUSES); this is how the screen lays it out and labels it.
export const KDS_STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'] as const satisfies readonly OrderStatus[];
export type KdsStatus = (typeof KDS_STATUSES)[number];

export const KDS_COLUMN_LABEL: Record<KdsStatus, string> = {
  PENDING: 'Novos',
  CONFIRMED: 'Confirmados',
  PREPARING: 'Preparando',
  READY: 'Prontos',
};

export interface KdsColumn {
  orders: AdminOrderListItem[];
  // How many orders are in this status in all; more than `orders.length` when the API capped it.
  total: number;
}

// A column the API did not send (or a board not loaded yet) is an empty column, never an error.
export function boardColumn(board: OrdersBoard | undefined, status: KdsStatus): KdsColumn {
  const column = board?.columns.find((candidate) => candidate.status === status);
  return column ? { orders: column.data, total: column.total } : { orders: [], total: 0 };
}

export function columnCountLabel(column: KdsColumn): string {
  return column.total > column.orders.length ? `${column.orders.length} de ${column.total}` : String(column.total);
}

// The new-order chime. `known` is null until the first board arrives: orders that were already
// waiting when the screen was opened never ring, only the ones that arrive afterwards.
export function newPendingOrderArrived(known: ReadonlySet<string> | null, current: readonly string[]): boolean {
  if (known === null) return false;
  return current.some((id) => !known.has(id));
}

// Requests one kitchen screen sends to the board route in a minute of polling.
export function kdsPollsPerMinute(intervalMs: number = KDS_POLL_INTERVAL_MS): number {
  return Math.ceil(60_000 / intervalMs);
}
