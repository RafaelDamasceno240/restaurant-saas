import type { AdminOrderListItem, KitchenRoundStatus, KitchenTableRound, OrdersBoard, OrderStatus } from './orders-api';

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
  // B9: table rounds in this stage, and how many there are in all.
  rounds: KitchenTableRound[];
  roundsTotal: number;
}

// A column the API did not send (or a board not loaded yet) is an empty column, never an error.
export function boardColumn(board: OrdersBoard | undefined, status: KdsStatus): KdsColumn {
  const column = board?.columns.find((candidate) => candidate.status === status);
  return column
    ? { orders: column.data, total: column.total, rounds: column.tableRounds ?? [], roundsTotal: column.tableRoundsTotal ?? 0 }
    : { orders: [], total: 0, rounds: [], roundsTotal: 0 };
}

export function columnCountLabel(column: KdsColumn): string {
  const shown = column.orders.length + column.rounds.length;
  const total = column.total + column.roundsTotal;
  return total > shown ? `${shown} de ${total}` : String(total);
}

// B9: what a column shows, orders and table rounds together, newest first (the order the API
// sends each list in).
export type KdsCard = { kind: 'order'; at: string; order: AdminOrderListItem } | { kind: 'round'; at: string; round: KitchenTableRound };

export function columnCards(column: KdsColumn): KdsCard[] {
  const cards: KdsCard[] = [
    ...column.orders.map((order) => ({ kind: 'order' as const, at: order.createdAt, order })),
    ...column.rounds.map((round) => ({ kind: 'round' as const, at: round.sentAt, round })),
  ];
  return cards.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

// What the "Novos" column holds that should ring when it appears: new orders and new rounds.
export function newCardIds(board: OrdersBoard | undefined): string[] {
  const column = boardColumn(board, 'PENDING');
  return [...column.orders.map((o) => o.id), ...column.rounds.map((r) => `round:${r.id}`)];
}

// B9: the action of a table round's card. No "Aceitar": the round's stock was taken when the
// waiter sent it, there is nothing to accept.
export const ROUND_ACTION: Record<KitchenRoundStatus, { label: string; to: 'PREPARING' | 'READY' | 'SERVED' }> = {
  SENT: { label: 'Iniciar preparo', to: 'PREPARING' },
  PREPARING: { label: 'Marcar como pronto', to: 'READY' },
  READY: { label: 'Entregue na mesa', to: 'SERVED' },
};

export function roundTitle(round: Pick<KitchenTableRound, 'tableNumber' | 'tableName' | 'roundNumber'>): string {
  return `Mesa ${round.tableNumber}${round.tableName ? ` (${round.tableName})` : ''} · rodada ${round.roundNumber}`;
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
