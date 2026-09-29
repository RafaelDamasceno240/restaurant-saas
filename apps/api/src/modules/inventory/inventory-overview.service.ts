import { Injectable } from '@nestjs/common';
import { InventoryUnit } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import {
  daysUntil,
  Decimal,
  estimateEntriesOnHand,
  EXPIRY_WARNING_DAYS,
  expiryStatus,
  roundCents,
  stockStatus,
  stockValueCents,
  toDisplay,
} from './inventory-calculations';
import { InventoryItemsService } from './inventory-items.service';
import { StockMovementsService } from './stock-movements.service';
import { BranchQueryDto, SummaryQueryDto, UpdateInventorySettingsDto } from './dto/inventory-overview.dto';

export type InventoryAlertType = 'OUT_OF_STOCK' | 'EXPIRED' | 'LOW_STOCK' | 'EXPIRING_SOON' | 'NO_RECIPE';

export interface InventoryAlert {
  type: InventoryAlertType;
  inventoryItemId: string | null;
  productId: string | null;
  name: string;
  unit: InventoryUnit | null;
  quantity: number | null;
  minStock: number | null;
  lotCode: string | null;
  expiresAt: Date | null;
  daysToExpiry: number | null;
}

const ALERT_PRIORITY: Record<InventoryAlertType, number> = {
  OUT_OF_STOCK: 0,
  EXPIRED: 1,
  LOW_STOCK: 2,
  EXPIRING_SOON: 3,
  NO_RECIPE: 4,
};

const DEFAULT_PERIOD_DAYS = 30;
const RECENT_ACTIVITY_SIZE = 8;
const LOSS_REASONS = new Set(['LOSS', 'DAMAGE']);

interface MovementAggregate {
  type: string;
  exitReason: string | null;
  count: number;
  value: string;
}

@Injectable()
export class InventoryOverviewService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchAccess: BranchAccessService,
    private readonly items: InventoryItemsService,
    private readonly movements: StockMovementsService,
  ) {}

  async summary(user: AuthenticatedRequestUser, query: SummaryQueryDto) {
    await this.branchAccess.assertAccess(user, query.branchId);
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - DEFAULT_PERIOD_DAYS * 86_400_000);

    const [stock, aggregates, alerts, recent] = await Promise.all([
      this.stockPosition(user.tenantId, query.branchId),
      this.prisma.$queryRaw<MovementAggregate[]>`
        SELECT "type"::text AS "type", "exitReason"::text AS "exitReason", COUNT(*)::int AS "count",
               COALESCE(SUM(ABS("quantity") * COALESCE("unitCostCents", 0)), 0)::text AS "value"
        FROM "stock_movements"
        WHERE "tenantId" = ${user.tenantId} AND "branchId" = ${query.branchId}
          AND "createdAt" >= ${from} AND "createdAt" <= ${to}
        GROUP BY "type", "exitReason"`,
      this.computeAlerts(user.tenantId, query.branchId),
      this.prisma.stockMovement.findMany({
        where: { tenantId: user.tenantId, branchId: query.branchId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: RECENT_ACTIVITY_SIZE,
        include: {
          inventoryItem: { select: { id: true, name: true, unit: true } },
          createdBy: { select: { id: true, name: true } },
        },
      }),
    ]);

    const orderIds = recent.filter((m) => m.referenceType === 'ORDER').map((m) => m.referenceId!);
    const orders = orderIds.length
      ? await this.prisma.order.findMany({
          where: { id: { in: orderIds }, tenantId: user.tenantId },
          select: { id: true, orderNumber: true },
        })
      : [];
    const orderNumbers = new Map(orders.map((order) => [order.id, order.orderNumber]));

    return {
      period: { from, to },
      stockValueCents: stock.valueCents,
      activeItemCount: stock.activeItemCount,
      lowStockCount: stock.lowStockCount,
      outOfStockCount: stock.outOfStockCount,
      entries: totalsOf(aggregates, (row) => row.type === 'ENTRY'),
      exits: totalsOf(aggregates, (row) => row.type === 'EXIT' || row.type === 'SALE'),
      losses: totalsOf(aggregates, (row) => row.type === 'EXIT' && LOSS_REASONS.has(row.exitReason ?? '')),
      alertCounts: countAlerts(alerts),
      recentActivity: recent.map((row) => this.movements.toView(row, orderNumbers)),
    };
  }

  async alerts(user: AuthenticatedRequestUser, query: BranchQueryDto) {
    await this.branchAccess.assertAccess(user, query.branchId);
    const alerts = await this.computeAlerts(user.tenantId, query.branchId);
    return { alerts, counts: countAlerts(alerts), expiryWarningDays: EXPIRY_WARNING_DAYS };
  }

  async balances(user: AuthenticatedRequestUser, query: BranchQueryDto) {
    const items = await this.items.list(user, { branchId: query.branchId });
    return items.filter((item) => item.active);
  }

  async getSettings(user: AuthenticatedRequestUser, query: BranchQueryDto) {
    const branch = await this.branchAccess.assertAccess(user, query.branchId);
    return { branchId: branch.id, allowNegativeStock: branch.allowNegativeStock };
  }

  async updateSettings(user: AuthenticatedRequestUser, dto: UpdateInventorySettingsDto) {
    const branch = await this.branchAccess.assertAccess(user, dto.branchId);
    await this.prisma.branch.update({
      where: { id: branch.id },
      data: { allowNegativeStock: dto.allowNegativeStock },
    });
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'INVENTORY_SETTINGS_UPDATED',
      entity: 'Branch',
      entityId: branch.id,
      beforeData: { allowNegativeStock: branch.allowNegativeStock },
      afterData: { allowNegativeStock: dto.allowNegativeStock },
    });
    return { branchId: branch.id, allowNegativeStock: dto.allowNegativeStock };
  }

  private async stockPosition(tenantId: string, branchId: string) {
    const [items, balances] = await Promise.all([
      this.prisma.inventoryItem.findMany({ where: { tenantId, active: true }, select: { id: true, minStock: true } }),
      this.items.balancesFor(tenantId, branchId),
    ]);
    let valueCents = 0;
    let lowStockCount = 0;
    let outOfStockCount = 0;
    for (const item of items) {
      const balance = balances.get(item.id);
      const quantity = balance?.quantity ?? new Decimal(0);
      valueCents += stockValueCents(quantity, balance?.averageCostCents ?? 0);
      const status = stockStatus(quantity, item.minStock);
      if (status === 'LOW_STOCK') lowStockCount += 1;
      if (status === 'OUT_OF_STOCK') outOfStockCount += 1;
    }
    return { valueCents, lowStockCount, outOfStockCount, activeItemCount: items.length };
  }

  private async computeAlerts(tenantId: string, branchId: string): Promise<InventoryAlert[]> {
    const now = new Date();
    const [items, balances, productsWithoutRecipe] = await Promise.all([
      this.prisma.inventoryItem.findMany({ where: { tenantId, active: true }, orderBy: { name: 'asc' } }),
      this.items.balancesFor(tenantId, branchId),
      this.prisma.product.findMany({
        where: { tenantId, active: true, recipe: null },
        select: { id: true, name: true },
        orderBy: { name: 'asc' },
      }),
    ]);

    const alerts: InventoryAlert[] = [];
    const itemsInStock: string[] = [];
    for (const item of items) {
      const quantity = balances.get(item.id)?.quantity ?? new Decimal(0);
      const status = stockStatus(quantity, item.minStock);
      if (quantity.gt(0)) itemsInStock.push(item.id);
      if (status === 'OK') continue;
      alerts.push({
        ...emptyAlert(),
        type: status,
        inventoryItemId: item.id,
        name: item.name,
        unit: item.unit,
        quantity: toDisplay(quantity),
        minStock: toDisplay(item.minStock),
      });
    }

    alerts.push(...(await this.expiryAlerts(tenantId, branchId, itemsInStock, items, balances, now)));

    for (const product of productsWithoutRecipe) {
      alerts.push({ ...emptyAlert(), type: 'NO_RECIPE', productId: product.id, name: product.name });
    }

    return alerts.sort(
      (a, b) =>
        ALERT_PRIORITY[a.type] - ALERT_PRIORITY[b.type] ||
        (a.daysToExpiry ?? 0) - (b.daysToExpiry ?? 0) ||
        a.name.localeCompare(b.name, 'pt-BR'),
    );
  }

  private async expiryAlerts(
    tenantId: string,
    branchId: string,
    itemIds: string[],
    items: { id: string; name: string; unit: InventoryUnit }[],
    balances: Map<string, { quantity: Decimal }>,
    now: Date,
  ): Promise<InventoryAlert[]> {
    if (itemIds.length === 0) return [];
    const withExpiry = await this.prisma.stockMovement.findMany({
      where: { tenantId, branchId, type: 'ENTRY', inventoryItemId: { in: itemIds }, expiresAt: { not: null } },
      distinct: ['inventoryItemId'],
      select: { inventoryItemId: true },
    });
    if (withExpiry.length === 0) return [];

    const entries = await this.prisma.stockMovement.findMany({
      where: { tenantId, branchId, type: 'ENTRY', inventoryItemId: { in: withExpiry.map((row) => row.inventoryItemId) } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, inventoryItemId: true, quantity: true, expiresAt: true, lotCode: true },
    });
    const entriesByItem = groupBy(entries, (entry) => entry.inventoryItemId);
    const itemById = new Map(items.map((item) => [item.id, item]));

    const alerts: InventoryAlert[] = [];
    for (const [itemId, itemEntries] of entriesByItem) {
      const item = itemById.get(itemId)!;
      const onHand = estimateEntriesOnHand(balances.get(itemId)?.quantity ?? new Decimal(0), itemEntries);
      for (const entry of onHand) {
        if (!entry.expiresAt) continue;
        const status = expiryStatus(entry.expiresAt, now);
        if (status === 'OK') continue;
        alerts.push({
          ...emptyAlert(),
          type: status,
          inventoryItemId: itemId,
          name: item.name,
          unit: item.unit,
          quantity: toDisplay(entry.onHand),
          lotCode: entry.lotCode,
          expiresAt: entry.expiresAt,
          daysToExpiry: daysUntil(entry.expiresAt, now),
        });
      }
    }
    return alerts;
  }
}

function emptyAlert(): Omit<InventoryAlert, 'type' | 'name'> {
  return {
    inventoryItemId: null,
    productId: null,
    unit: null,
    quantity: null,
    minStock: null,
    lotCode: null,
    expiresAt: null,
    daysToExpiry: null,
  };
}

function countAlerts(alerts: InventoryAlert[]): Record<InventoryAlertType, number> {
  const counts: Record<InventoryAlertType, number> = {
    OUT_OF_STOCK: 0,
    EXPIRED: 0,
    LOW_STOCK: 0,
    EXPIRING_SOON: 0,
    NO_RECIPE: 0,
  };
  for (const alert of alerts) counts[alert.type] += 1;
  return counts;
}

function totalsOf(rows: MovementAggregate[], predicate: (row: MovementAggregate) => boolean) {
  const selected = rows.filter(predicate);
  const value = selected.reduce((sum, row) => sum.add(new Decimal(row.value)), new Decimal(0));
  return { count: selected.reduce((sum, row) => sum + row.count, 0), valueCents: roundCents(value) };
}

function groupBy<T>(rows: T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const id = key(row);
    const list = groups.get(id);
    if (list) list.push(row);
    else groups.set(id, [row]);
  }
  return groups;
}

