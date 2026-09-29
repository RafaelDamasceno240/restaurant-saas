import { Injectable } from '@nestjs/common';
import { InventoryItem, InventoryUnit, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { Decimal, stockStatus, StockStatus, stockValueCents, toDisplay, toQuantity } from './inventory-calculations';
import { inventoryItemNotFound, invalidStockLimits, mapUniqueSkuError } from './inventory-errors';
import {
  CreateInventoryItemDto,
  ItemBranchQueryDto,
  ItemStatusFilter,
  ListInventoryItemsQueryDto,
  UpdateInventoryItemDto,
} from './dto/inventory-items.dto';

type ItemWithCount = InventoryItem & { _count: { recipeItems: number } };
type BalanceSnapshot = { quantity: Decimal; averageCostCents: number };

export interface InventoryItemView {
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
  createdAt: Date;
  updatedAt: Date;
  quantity: number | null;
  averageCostCents: number | null;
  stockValueCents: number | null;
  status: StockStatus | null;
}

@Injectable()
export class InventoryItemsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  async list(user: AuthenticatedRequestUser, query: ListInventoryItemsQueryDto): Promise<InventoryItemView[]> {
    if (query.branchId) await this.branchAccess.assertAccess(user, query.branchId);
    const search = query.search?.trim();
    const items = await this.prisma.inventoryItem.findMany({
      where: {
        tenantId: user.tenantId,
        ...(search
          ? {
              OR: [
                { name: { contains: search, mode: 'insensitive' } },
                { sku: { contains: search, mode: 'insensitive' } },
              ],
            }
          : {}),
      },
      orderBy: { name: 'asc' },
      include: { _count: { select: { recipeItems: true } } },
    });
    const balances = query.branchId ? await this.balancesFor(user.tenantId, query.branchId) : null;
    const views = items.map((item) => this.toView(item, balances ? balances.get(item.id) ?? null : undefined));
    return query.status ? views.filter((view) => matchesStatus(view, query.status!)) : views;
  }

  async get(user: AuthenticatedRequestUser, id: string, query: ItemBranchQueryDto): Promise<InventoryItemView> {
    if (query.branchId) await this.branchAccess.assertAccess(user, query.branchId);
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { _count: { select: { recipeItems: true } } },
    });
    if (!item) throw inventoryItemNotFound();
    const balances = query.branchId ? await this.balancesFor(user.tenantId, query.branchId) : null;
    return this.toView(item, balances ? balances.get(item.id) ?? null : undefined);
  }

  async create(user: AuthenticatedRequestUser, dto: CreateInventoryItemDto): Promise<InventoryItemView> {
    assertStockLimits(dto.minStock ?? 0, dto.maxStock ?? null);
    let item: ItemWithCount;
    try {
      item = await this.prisma.inventoryItem.create({
        data: {
          tenantId: user.tenantId,
          name: dto.name.trim(),
          sku: dto.sku?.trim() || null,
          unit: dto.unit,
          minStock: toQuantity(dto.minStock ?? 0),
          maxStock: dto.maxStock === undefined || dto.maxStock === null ? null : toQuantity(dto.maxStock),
          tracksExpiry: dto.tracksExpiry ?? false,
          notes: dto.notes?.trim() || null,
          active: dto.active ?? true,
        },
        include: { _count: { select: { recipeItems: true } } },
      });
    } catch (error) {
      throw mapUniqueSkuError(error);
    }
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'INVENTORY_ITEM_CREATED',
      entity: 'InventoryItem',
      entityId: item.id,
      afterData: auditSnapshot(item),
    });
    return this.toView(item);
  }

  async update(user: AuthenticatedRequestUser, id: string, dto: UpdateInventoryItemDto): Promise<InventoryItemView> {
    const before = await this.prisma.inventoryItem.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!before) throw inventoryItemNotFound();

    const nextMin = dto.minStock ?? toDisplay(before.minStock);
    const nextMax = dto.maxStock === undefined ? (before.maxStock ? toDisplay(before.maxStock) : null) : dto.maxStock;
    assertStockLimits(nextMin, nextMax);

    let item: ItemWithCount;
    try {
      item = await this.prisma.inventoryItem.update({
        where: { id },
        data: {
          name: dto.name?.trim(),
          sku: dto.sku === undefined ? undefined : dto.sku?.trim() || null,
          minStock: dto.minStock === undefined ? undefined : toQuantity(dto.minStock),
          maxStock: dto.maxStock === undefined ? undefined : dto.maxStock === null ? null : toQuantity(dto.maxStock),
          tracksExpiry: dto.tracksExpiry,
          notes: dto.notes === undefined ? undefined : dto.notes?.trim() || null,
          active: dto.active,
        },
        include: { _count: { select: { recipeItems: true } } },
      });
    } catch (error) {
      throw mapUniqueSkuError(error);
    }
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'INVENTORY_ITEM_UPDATED',
      entity: 'InventoryItem',
      entityId: id,
      beforeData: auditSnapshot(before),
      afterData: auditSnapshot(item),
    });
    return this.toView(item);
  }

  async balancesFor(tenantId: string, branchId: string): Promise<Map<string, BalanceSnapshot>> {
    const rows = await this.prisma.inventoryBalance.findMany({
      where: { tenantId, branchId },
      select: { inventoryItemId: true, quantity: true, averageCostCents: true },
    });
    return new Map(rows.map((row) => [row.inventoryItemId, row]));
  }

  toView(item: ItemWithCount, balance?: BalanceSnapshot | null): InventoryItemView {
    const base = {
      id: item.id,
      name: item.name,
      sku: item.sku,
      unit: item.unit,
      minStock: toDisplay(item.minStock),
      maxStock: item.maxStock ? toDisplay(item.maxStock) : null,
      tracksExpiry: item.tracksExpiry,
      notes: item.notes,
      active: item.active,
      usedInRecipes: item._count.recipeItems,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    };
    if (balance === undefined) {
      return { ...base, quantity: null, averageCostCents: null, stockValueCents: null, status: null };
    }
    const quantity = balance?.quantity ?? new Decimal(0);
    const averageCostCents = balance?.averageCostCents ?? 0;
    return {
      ...base,
      quantity: toDisplay(quantity),
      averageCostCents,
      stockValueCents: stockValueCents(quantity, averageCostCents),
      status: stockStatus(quantity, item.minStock),
    };
  }
}

function matchesStatus(view: InventoryItemView, filter: ItemStatusFilter): boolean {
  if (filter === 'INACTIVE') return !view.active;
  return view.active && view.status === filter;
}

function assertStockLimits(minStock: number, maxStock: number | null) {
  if (maxStock !== null && toQuantity(maxStock).lt(toQuantity(minStock))) throw invalidStockLimits();
}

function auditSnapshot(item: InventoryItem): Prisma.InputJsonObject {
  return {
    name: item.name,
    sku: item.sku,
    unit: item.unit,
    minStock: item.minStock.toFixed(3),
    maxStock: item.maxStock?.toFixed(3) ?? null,
    tracksExpiry: item.tracksExpiry,
    active: item.active,
  };
}
