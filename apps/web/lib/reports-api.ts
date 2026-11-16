import { apiFetch } from './api-client';
import type { CashSession } from './cash-api';

// Operational reports. Money is integer cents; days are calendar days ('YYYY-MM-DD') in the
// restaurant's time zone. Every figure is computed by the API: these screens only present it.

export interface ReportHeader {
  // The period the API actually used (it fills in the defaults and reports the zone).
  period: { from: string; to: string; timezone: string; days: number };
  branchId: string | null;
}

export interface ReportFilters {
  from?: string;
  to?: string;
  // Undefined = every branch the user may see.
  branchId?: string;
}

export interface PageMeta {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export interface BreakdownRow {
  key: string;
  ordersCount: number;
  totalCents: number;
}

export interface SalesReport extends ReportHeader {
  totals: {
    ordersCount: number;
    itemsCents: number;
    discountCents: number;
    cashbackUsedCents: number;
    deliveryFeeCents: number;
    totalCents: number;
    averageTicketCents: number;
    concludedCount: number;
    concludedCents: number;
    onAccountCents: number;
    cancelledCount: number;
    cancelledCents: number;
  };
  byDay: { day: string; ordersCount: number; totalCents: number }[];
  byHour: { hour: number; ordersCount: number; totalCents: number }[];
  byPaymentMethod: BreakdownRow[];
  bySource: BreakdownRow[];
  byFulfillment: BreakdownRow[];
}

export interface ProductsReport extends ReportHeader {
  totals: { productsCount: number; quantity: number; revenueCents: number };
  data: {
    productId: string;
    name: string;
    categoryName: string;
    active: boolean;
    quantity: number;
    revenueCents: number;
    ordersCount: number;
    shareBps: number;
  }[];
  meta: PageMeta;
}

export interface CustomersReport extends ReportHeader {
  totals: {
    customersCount: number;
    identifiedOrders: number;
    identifiedCents: number;
    anonymousOrders: number;
    anonymousCents: number;
    newCustomers: number;
  };
  data: {
    customerId: string;
    name: string;
    phone: string;
    active: boolean;
    ordersCount: number;
    totalCents: number;
    averageTicketCents: number;
    lastOrderAt: string;
  }[];
  meta: PageMeta;
}

export interface InventoryReport extends ReportHeader {
  totals: { itemsCount: number; purchasedCostCents: number; soldCostCents: number; otherExitCostCents: number; lossCostCents: number };
  data: {
    inventoryItemId: string;
    name: string;
    unit: string;
    active: boolean;
    purchasedQuantity: number;
    purchasedCostCents: number;
    soldQuantity: number;
    soldCostCents: number;
    otherExitQuantity: number;
    otherExitCostCents: number;
    lossQuantity: number;
    lossCostCents: number;
    adjustmentQuantity: number;
    currentQuantity: number;
  }[];
  meta: PageMeta;
}

export interface DeliveryReport extends ReportHeader {
  totals: {
    total: number;
    pending: number;
    outForDelivery: number;
    delivered: number;
    failed: number;
    cancelled: number;
    attempts: number;
    redelivered: number;
    successRateBps: number | null;
    averageRouteMinutes: number | null;
    averageDoorMinutes: number | null;
    feeCents: number;
    deliveredOrdersCents: number;
  };
  byCourier: { courierId: string | null; courierName: string | null; total: number; delivered: number; failed: number; averageRouteMinutes: number | null }[];
  byDay: { day: string; total: number; delivered: number }[];
}

export interface CashReport extends ReportHeader {
  totals: CashSession['totals'] & {
    sessions: number;
    closed: number;
    open: number;
    shortageCents: number;
    surplusCents: number;
    sessionsWithDifference: number;
  };
  data: {
    id: string;
    status: 'OPEN' | 'CLOSED';
    branch: { id: string; name: string };
    openedBy: { id: string; name: string };
    closedBy: { id: string; name: string } | null;
    openedAt: string;
    closedAt: string | null;
    openingBalanceCents: number;
    totals: CashSession['totals'];
    expectedBalanceCents: number;
    countedClosingBalanceCents: number | null;
    differenceCents: number | null;
  }[];
  meta: PageMeta;
}

type Params = Record<string, string | number | undefined | null>;

export function reportQuery(params: Params): string {
  const query = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') query.set(name, String(value));
  }
  const text = query.toString();
  return text ? `?${text}` : '';
}

const fetchReport = <T>(token: string, name: string, params: Params) =>
  apiFetch<T>(`/reports/${name}${reportQuery(params)}`, { accessToken: token });

export const reportsApi = {
  sales: (token: string, filters: ReportFilters) => fetchReport<SalesReport>(token, 'sales', { ...filters }),
  products: (token: string, filters: ReportFilters & { sort?: 'revenue' | 'quantity'; search?: string; page?: number }) =>
    fetchReport<ProductsReport>(token, 'products', { ...filters }),
  customers: (token: string, filters: ReportFilters & { sort?: 'total' | 'orders'; page?: number }) =>
    fetchReport<CustomersReport>(token, 'customers', { ...filters }),
  inventory: (token: string, filters: ReportFilters & { sort?: 'consumption' | 'loss' | 'name'; search?: string; page?: number }) =>
    fetchReport<InventoryReport>(token, 'inventory', { ...filters }),
  delivery: (token: string, filters: ReportFilters) => fetchReport<DeliveryReport>(token, 'delivery', { ...filters }),
  cash: (token: string, filters: ReportFilters & { page?: number }) => fetchReport<CashReport>(token, 'cash', { ...filters }),
};
