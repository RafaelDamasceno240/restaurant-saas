import { BadRequestException, Injectable } from '@nestjs/common';
import { InventoryItem, Prisma, StockMovement, StockMovementOrigin } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { lineCostCents, toDisplay, toQuantity } from './inventory-calculations';
import { inventoryItemInactive, inventoryItemNotFound } from './inventory-errors';
import { StockLedgerService } from './stock-ledger.service';
import { CreateStockMovementDto, ListStockMovementsQueryDto } from './dto/stock-movements.dto';

const movementInclude = {
  inventoryItem: { select: { id: true, name: true, unit: true } },
  createdBy: { select: { id: true, name: true } },
} satisfies Prisma.StockMovementInclude;

type MovementWithRelations = Prisma.StockMovementGetPayload<{ include: typeof movementInclude }>;

@Injectable()
export class StockMovementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchAccess: BranchAccessService,
    private readonly ledger: StockLedgerService,
  ) {}

  async create(user: AuthenticatedRequestUser, dto: CreateStockMovementDto) {
    await this.branchAccess.assertAccess(user, dto.branchId);
    const item = await this.prisma.inventoryItem.findFirst({
      where: { id: dto.inventoryItemId, tenantId: user.tenantId },
    });
    if (!item) throw inventoryItemNotFound();
    if (!item.active) throw inventoryItemInactive();
    if (dto.type === 'ENTRY') assertEntryRules(item, dto);

    const movement = await this.prisma.$transaction(async (tx) =>
      this.ledger.apply(tx, {
        tenantId: user.tenantId,
        branchId: dto.branchId,
        inventoryItemId: item.id,
        itemName: item.name,
        type: dto.type,
        origin: originOf(dto),
        delta: dto.type === 'ENTRY' ? toQuantity(dto.quantity) : toQuantity(dto.quantity).neg(),
        allowNegative: await this.ledger.branchAllowsNegative(tx, dto.branchId),
        incomingUnitCostCents: dto.type === 'ENTRY' ? dto.unitCostCents : undefined,
        exitReason: dto.type === 'EXIT' ? dto.exitReason : null,
        notes: dto.notes?.trim() || null,
        supplierName: dto.type === 'ENTRY' ? dto.supplierName?.trim() || null : null,
        documentNumber: dto.type === 'ENTRY' ? dto.documentNumber?.trim() || null : null,
        lotCode: dto.type === 'ENTRY' ? dto.lotCode?.trim() || null : null,
        expiresAt: dto.type === 'ENTRY' && dto.expiresAt ? new Date(dto.expiresAt) : null,
        userId: user.userId,
      }),
    );

    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'INVENTORY_MOVEMENT_CREATED',
      entity: 'StockMovement',
      entityId: movement.id,
      afterData: {
        branchId: dto.branchId,
        inventoryItemId: item.id,
        type: movement.type,
        origin: movement.origin,
        quantity: movement.quantity.toFixed(3),
        balanceAfter: movement.balanceAfter.toFixed(3),
        unitCostCents: movement.unitCostCents,
        exitReason: movement.exitReason,
      },
    });

    const created = await this.prisma.stockMovement.findUniqueOrThrow({
      where: { id: movement.id },
      include: movementInclude,
    });
    return this.toView(created, new Map());
  }

  async list(user: AuthenticatedRequestUser, query: ListStockMovementsQueryDto) {
    await this.branchAccess.assertAccess(user, query.branchId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 50;
    const where = this.whereFor(user.tenantId, query);

    const [total, rows, creators] = await this.prisma.$transaction([
      this.prisma.stockMovement.count({ where }),
      this.prisma.stockMovement.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: movementInclude,
      }),
      this.prisma.stockMovement.findMany({
        where: { tenantId: user.tenantId, branchId: query.branchId, createdByUserId: { not: null } },
        distinct: ['createdByUserId'],
        select: { createdBy: { select: { id: true, name: true } } },
      }),
    ]);

    const orderNumbers = await this.orderNumbersFor(user.tenantId, rows);
    return {
      data: rows.map((row) => this.toView(row, orderNumbers)),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      filters: {
        users: creators
          .map((row) => row.createdBy)
          .filter((creator): creator is { id: string; name: string } => creator !== null)
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
      },
    };
  }

  private whereFor(tenantId: string, query: ListStockMovementsQueryDto): Prisma.StockMovementWhereInput {
    const search = query.search?.trim();
    const createdAt: Prisma.DateTimeFilter = {};
    if (query.from) createdAt.gte = new Date(query.from);
    if (query.to) createdAt.lte = endOfDayIfDateOnly(query.to);
    return {
      tenantId,
      branchId: query.branchId,
      ...(query.type ? { type: query.type } : {}),
      ...(query.origin ? { origin: query.origin } : {}),
      ...(query.inventoryItemId ? { inventoryItemId: query.inventoryItemId } : {}),
      ...(query.createdByUserId ? { createdByUserId: query.createdByUserId } : {}),
      ...(query.from || query.to ? { createdAt } : {}),
      ...(search
        ? {
            OR: [
              { inventoryItem: { name: { contains: search, mode: 'insensitive' } } },
              { notes: { contains: search, mode: 'insensitive' } },
              { supplierName: { contains: search, mode: 'insensitive' } },
              { documentNumber: { contains: search, mode: 'insensitive' } },
              { lotCode: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  private async orderNumbersFor(tenantId: string, rows: StockMovement[]): Promise<Map<string, string>> {
    const orderIds = [...new Set(rows.filter((row) => row.referenceType === 'ORDER').map((row) => row.referenceId!))];
    if (orderIds.length === 0) return new Map();
    const orders = await this.prisma.order.findMany({
      where: { id: { in: orderIds }, tenantId },
      select: { id: true, orderNumber: true },
    });
    return new Map(orders.map((order) => [order.id, order.orderNumber]));
  }

  toView(row: MovementWithRelations, orderNumbers: Map<string, string>) {
    return {
      id: row.id,
      type: row.type,
      origin: row.origin,
      inventoryItem: row.inventoryItem,
      quantity: toDisplay(row.quantity),
      balanceAfter: toDisplay(row.balanceAfter),
      unitCostCents: row.unitCostCents,
      totalCostCents: row.unitCostCents === null ? null : lineCostCents(row.quantity, row.unitCostCents),
      exitReason: row.exitReason,
      notes: row.notes,
      supplierName: row.supplierName,
      documentNumber: row.documentNumber,
      lotCode: row.lotCode,
      expiresAt: row.expiresAt,
      reference: row.referenceType
        ? {
            type: row.referenceType,
            id: row.referenceId,
            label: row.referenceType === 'ORDER' ? orderNumbers.get(row.referenceId!) ?? null : null,
          }
        : null,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    };
  }
}

function originOf(dto: CreateStockMovementDto): StockMovementOrigin {
  if (dto.type === 'EXIT') return 'MANUAL';
  return dto.supplierName?.trim() || dto.documentNumber?.trim() ? 'PURCHASE' : 'MANUAL';
}

function assertEntryRules(item: InventoryItem, dto: CreateStockMovementDto) {
  if (item.tracksExpiry && !dto.expiresAt) {
    throw new BadRequestException({
      code: 'EXPIRY_REQUIRED',
      message: `O insumo "${item.name}" controla validade: informe a data de validade da entrada.`,
    });
  }
}

function endOfDayIfDateOnly(value: string): Date {
  const date = new Date(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) date.setUTCHours(23, 59, 59, 999);
  return date;
}
