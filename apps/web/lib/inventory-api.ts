import { apiFetch } from './api-client';

export type InventoryUnit = 'UNIT' | 'KG' | 'G' | 'L' | 'ML';
export type StockStatus = 'OK' | 'LOW_STOCK' | 'OUT_OF_STOCK';
export type RecipeStatus = StockStatus | 'NO_RECIPE';
export type StockMovementType = 'ENTRY' | 'EXIT' | 'ADJUSTMENT' | 'SALE' | 'REVERSAL';
export type StockMovementOrigin = 'PURCHASE' | 'MANUAL' | 'ORDER' | 'INVENTORY' | 'REVERSAL';
export type StockExitReason = 'CONSUMPTION' | 'LOSS' | 'DAMAGE' | 'ADJUSTMENT' | 'OTHER';
export type InventoryAlertType = 'OUT_OF_STOCK' | 'EXPIRED' | 'LOW_STOCK' | 'EXPIRING_SOON' | 'NO_RECIPE';
export type ItemStatusFilter = StockStatus | 'INACTIVE';

export const UNIT_LABEL: Record<InventoryUnit, string> = { UNIT: 'UN', KG: 'KG', G: 'G', L: 'L', ML: 'ML' };

export const UNIT_OPTIONS: { value: InventoryUnit; label: string }[] = [
  { value: 'UNIT', label: 'Unidade (UN)' },
  { value: 'KG', label: 'Quilograma (KG)' },
  { value: 'G', label: 'Grama (G)' },
  { value: 'L', label: 'Litro (L)' },
  { value: 'ML', label: 'Mililitro (ML)' },
];

export const COMPATIBLE_UNITS: Record<InventoryUnit, InventoryUnit[]> = {
  UNIT: ['UNIT'],
  KG: ['KG', 'G'],
  G: ['G', 'KG'],
  L: ['L', 'ML'],
  ML: ['ML', 'L'],
};

export const MOVEMENT_TYPE_LABEL: Record<StockMovementType, string> = {
  ENTRY: 'Entrada',
  EXIT: 'Saída',
  ADJUSTMENT: 'Ajuste',
  SALE: 'Venda',
  REVERSAL: 'Estorno',
};

export const ORIGIN_LABEL: Record<StockMovementOrigin, string> = {
  PURCHASE: 'Compra',
  MANUAL: 'Manual',
  ORDER: 'Pedido',
  INVENTORY: 'Inventário',
  REVERSAL: 'Estorno',
};

export const EXIT_REASON_LABEL: Record<StockExitReason, string> = {
  CONSUMPTION: 'Consumo',
  LOSS: 'Perda',
  DAMAGE: 'Avaria',
  ADJUSTMENT: 'Ajuste',
  OTHER: 'Outros',
};

export const STOCK_STATUS_LABEL: Record<RecipeStatus, string> = {
  OK: 'OK',
  LOW_STOCK: 'Estoque baixo',
  OUT_OF_STOCK: 'Sem estoque',
  NO_RECIPE: 'Sem ficha técnica',
};

export const ALERT_LABEL: Record<InventoryAlertType, string> = {
  OUT_OF_STOCK: 'Sem estoque',
  EXPIRED: 'Vencido',
  LOW_STOCK: 'Estoque baixo',
  EXPIRING_SOON: 'Validade próxima',
  NO_RECIPE: 'Sem ficha técnica',
};

export interface InventoryItem {
  id: string;
  name: string;
  sku: string | null;
  unit: InventoryUnit;
  minStock: number;
  maxStock: number | null;
  tracksExpiry: boolean;
  notes: string | null;
  active: boolean;
  usedInRecipes: number;
  quantity: number | null;
  averageCostCents: number | null;
  stockValueCents: number | null;
  status: StockStatus | null;
}

export interface InventoryItemInput {
  name: string;
  sku?: string | null;
  unit?: InventoryUnit;
  minStock?: number;
  maxStock?: number | null;
  tracksExpiry?: boolean;
  notes?: string | null;
  active?: boolean;
}

export interface StockMovement {
  id: string;
  type: StockMovementType;
  origin: StockMovementOrigin;
  inventoryItem: { id: string; name: string; unit: InventoryUnit };
  quantity: number;
  balanceAfter: number;
  unitCostCents: number | null;
  totalCostCents: number | null;
  exitReason: StockExitReason | null;
  notes: string | null;
  supplierName: string | null;
  documentNumber: string | null;
  lotCode: string | null;
  expiresAt: string | null;
  reference: { type: 'ORDER' | 'INVENTORY_COUNT'; id: string; label: string | null } | null;
  createdBy: { id: string; name: string } | null;
  createdAt: string;
}

export interface MovementPage {
  data: StockMovement[];
  meta: { page: number; pageSize: number; total: number; totalPages: number };
  filters: { users: { id: string; name: string }[] };
}

export interface MovementFilters {
  type?: StockMovementType;
  origin?: StockMovementOrigin;
  inventoryItemId?: string;
  createdByUserId?: string;
  from?: string;
  to?: string;
  search?: string;
  page?: number;
}

export type MovementInput =
  | {
      type: 'ENTRY';
      branchId: string;
      inventoryItemId: string;
      quantity: number;
      unitCostCents: number;
      supplierName?: string;
      documentNumber?: string;
      lotCode?: string;
      expiresAt?: string;
      notes?: string;
    }
  | {
      type: 'EXIT';
      branchId: string;
      inventoryItemId: string;
      quantity: number;
      exitReason: StockExitReason;
      notes?: string;
    };

export interface PeriodTotals {
  count: number;
  valueCents: number;
}

export interface InventorySummary {
  period: { from: string; to: string };
  stockValueCents: number;
  activeItemCount: number;
  lowStockCount: number;
  outOfStockCount: number;
  entries: PeriodTotals;
  exits: PeriodTotals;
  losses: PeriodTotals;
  alertCounts: Record<InventoryAlertType, number>;
  recentActivity: StockMovement[];
}

export interface InventoryAlert {
  type: InventoryAlertType;
  inventoryItemId: string | null;
  productId: string | null;
  name: string;
  unit: InventoryUnit | null;
  quantity: number | null;
  minStock: number | null;
  lotCode: string | null;
  expiresAt: string | null;
  daysToExpiry: number | null;
}

export interface RecipeRow {
  productId: string;
  name: string;
  imageUrl: string | null;
  active: boolean;
  category: { id: string; name: string };
  priceCents: number;
  hasRecipe: boolean;
  itemCount: number;
  costCents: number | null;
  marginCents: number | null;
  marginPercent: number | null;
  producibleUnits: number | null;
  status: RecipeStatus;
}

export interface RecipeDetail {
  productId: string;
  productName: string;
  name: string | null;
  priceCents: number;
  items: {
    inventoryItemId: string;
    name: string;
    unit: InventoryUnit;
    quantity: number;
    inputUnit: InventoryUnit;
    inputQuantity: number;
    unitCostCents: number | null;
    subtotalCents: number | null;
  }[];
  costCents: number | null;
  marginCents: number | null;
  marginPercent: number | null;
}

export interface InventoryCountResult {
  id: string;
  createdAt: string;
  adjustedCount: number;
  items: {
    inventoryItemId: string;
    name: string;
    unit: InventoryUnit;
    systemQuantity: number;
    countedQuantity: number;
    difference: number;
    stockMovementId: string | null;
  }[];
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  return search.toString();
}

export const inventoryApi = {
  summary: (token: string, branchId: string, from?: string) =>
    apiFetch<InventorySummary>(`/inventory/summary?${qs({ branchId, from })}`, { accessToken: token }),
  alerts: (token: string, branchId: string) =>
    apiFetch<{ alerts: InventoryAlert[]; counts: Record<InventoryAlertType, number>; expiryWarningDays: number }>(
      `/inventory/alerts?${qs({ branchId })}`,
      { accessToken: token },
    ),
  listItems: (token: string, branchId: string, filters: { search?: string; status?: ItemStatusFilter } = {}) =>
    apiFetch<InventoryItem[]>(`/inventory/items?${qs({ branchId, ...filters })}`, { accessToken: token }),
  balances: (token: string, branchId: string) =>
    apiFetch<InventoryItem[]>(`/inventory/balances?${qs({ branchId })}`, { accessToken: token }),
  createItem: (token: string, input: InventoryItemInput) =>
    apiFetch<InventoryItem>('/inventory/items', { method: 'POST', body: input, accessToken: token }),
  updateItem: (token: string, id: string, input: Omit<InventoryItemInput, 'unit'>) =>
    apiFetch<InventoryItem>(`/inventory/items/${id}`, { method: 'PATCH', body: input, accessToken: token }),
  listMovements: (token: string, branchId: string, filters: MovementFilters) =>
    apiFetch<MovementPage>(`/inventory/movements?${qs({ branchId, ...filters })}`, { accessToken: token }),
  createMovement: (token: string, input: MovementInput) =>
    apiFetch<StockMovement>('/inventory/movements', { method: 'POST', body: input, accessToken: token }),
  listRecipes: (token: string, branchId: string, search?: string) =>
    apiFetch<RecipeRow[]>(`/inventory/recipes?${qs({ branchId, search })}`, { accessToken: token }),
  getRecipe: (token: string, productId: string, branchId: string) =>
    apiFetch<RecipeDetail>(`/inventory/recipes/${productId}?${qs({ branchId })}`, { accessToken: token }),
  putRecipe: (
    token: string,
    productId: string,
    items: { inventoryItemId: string; quantity: number; unit: InventoryUnit }[],
  ) => apiFetch<RecipeDetail>(`/inventory/recipes/${productId}`, { method: 'PUT', body: { items }, accessToken: token }),
  createCount: (
    token: string,
    input: { branchId: string; notes?: string; items: { inventoryItemId: string; countedQuantity: number }[] },
  ) => apiFetch<InventoryCountResult>('/inventory/inventory-counts', { method: 'POST', body: input, accessToken: token }),
  getSettings: (token: string, branchId: string) =>
    apiFetch<{ branchId: string; allowNegativeStock: boolean }>(`/inventory/settings?${qs({ branchId })}`, {
      accessToken: token,
    }),
  updateSettings: (token: string, branchId: string, allowNegativeStock: boolean) =>
    apiFetch<{ branchId: string; allowNegativeStock: boolean }>('/inventory/settings', {
      method: 'PATCH',
      body: { branchId, allowNegativeStock },
      accessToken: token,
    }),
};

export function formatQuantity(value: number, unit: InventoryUnit): string {
  const digits = Number.isInteger(value) ? 0 : 3;
  const formatted = value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: 3 });
  return `${formatted} ${UNIT_LABEL[unit]}`;
}

export function formatSignedQuantity(value: number, unit: InventoryUnit): string {
  const sign = value > 0 ? '+' : value < 0 ? '−' : '';
  return `${sign}${formatQuantity(Math.abs(value), unit)}`;
}

export function formatPercent(value: number | null): string {
  if (value === null) return '—';
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
}

export function formatDate(iso: string): string {
  const [year, month, day] = iso.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

export function parseCostToCents(input: string): number | null {
  const normalized = input.trim().replace(/\s/g, '').replace(/^R\$/i, '').replace(',', '.');
  if (!/^\d+(\.\d{0,2})?$/.test(normalized)) return null;
  const [intPart, decPart = ''] = normalized.split('.');
  return Number(intPart) * 100 + Number(decPart.padEnd(2, '0'));
}

export function parseQuantity(input: string): number | null {
  const normalized = input.trim().replace(',', '.');
  if (!/^\d+(\.\d{1,3})?$/.test(normalized)) return null;
  return Number(normalized);
}

export function countDifference(system: number, counted: number): number {
  return Math.round((counted - system) * 1000) / 1000;
}
