import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, PurchaseStatus, StockMovement } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { Decimal, toDisplay, toQuantity } from '../inventory/inventory-calculations';
import { inventoryItemInactive, inventoryItemNotFound } from '../inventory/inventory-errors';
import { assertEntryRules } from '../inventory/stock-movements.service';
import { StockLedgerService, Tx } from '../inventory/stock-ledger.service';
import { assertTotalsWithinLimit, computePurchaseTotals } from './purchase-calculations';
import {
  cancelReasonRequired,
  invalidPurchaseTotal,
  purchaseAlreadyProcessed,
  purchaseCancelled,
  purchaseEmpty,
  purchaseNotEditable,
  purchaseNotFound,
  purchaseStockMismatch,
  supplierInactive,
  supplierNotFound,
} from './purchase-errors';
import {
  CancelPurchaseDto,
  CreatePurchaseDto,
  ListPurchasesQueryDto,
  PurchaseItemInputDto,
  UpdatePurchaseDto,
} from './dto/purchases.dto';

const TRANSACTION_OPTIONS = { timeout: 20_000, maxWait: 10_000 };

const detailInclude = {
  supplier: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  receivedBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
  items: {
    include: { inventoryItem: { select: { id: true, name: true, unit: true } } },
    orderBy: [{ id: 'asc' }],
  },
} satisfies Prisma.PurchaseInclude;

const listInclude = {
  supplier: { select: { id: true, name: true } },
  branch: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  _count: { select: { items: true } },
} satisfies Prisma.PurchaseInclude;

type PurchaseDetail = Prisma.PurchaseGetPayload<{ include: typeof detailInclude }>;
type PurchaseListRow = Prisma.PurchaseGetPayload<{ include: typeof listInclude }>;

interface LineData {
  inventoryItemId: string;
  quantity: Decimal;
  unitCostCents: number;
  lotCode: string | null;
  expiresAt: Date | null;
}

interface LockedPurchase {
  status: PurchaseStatus;
  branchId: string;
}

interface ReceiveOutcome {
  replay: boolean;
  movements: StockMovement[];
}

interface CancelOutcome {
  replay: boolean;
  previousStatus: PurchaseStatus;
  movements: StockMovement[];
}

const EMPTY_SUMMARY = () => ({
  DRAFT: { count: 0, totalCents: 0 },
  RECEIVED: { count: 0, totalCents: 0 },
  CANCELLED: { count: 0, totalCents: 0 },
});

@Injectable()
export class PurchasesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchAccess: BranchAccessService,
    private readonly ledger: StockLedgerService,
  ) {}

  async list(user: AuthenticatedRequestUser, query: ListPurchasesQueryDto) {
    await this.branchAccess.assertAccess(user, query.branchId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const search = query.search?.trim();

    const purchaseDate: Prisma.DateTimeFilter = {};
    if (query.dateFrom) purchaseDate.gte = new Date(query.dateFrom);
    if (query.dateTo) purchaseDate.lte = new Date(query.dateTo);

    const baseWhere: Prisma.PurchaseWhereInput = {
      tenantId: user.tenantId,
      branchId: query.branchId,
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.dateFrom || query.dateTo ? { purchaseDate } : {}),
      ...(search
        ? {
            OR: [
              { purchaseNumber: { contains: search, mode: 'insensitive' } },
              { supplier: { name: { contains: search, mode: 'insensitive' } } },
            ],
          }
        : {}),
    };
    const where: Prisma.PurchaseWhereInput = { ...baseWhere, ...(query.status ? { status: query.status } : {}) };

    const [total, rows, grouped] = await this.prisma.$transaction([
      this.prisma.purchase.count({ where }),
      this.prisma.purchase.findMany({
        where,
        orderBy: [{ purchaseDate: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: listInclude,
      }),
      this.prisma.purchase.groupBy({
        by: ['status'],
        where: baseWhere,
        orderBy: { status: 'asc' },
        _count: { _all: true },
        _sum: { totalCents: true },
      }),
    ]);

    const summary = EMPTY_SUMMARY();
    for (const group of grouped) {
      const counted = typeof group._count === 'object' ? group._count : null;
      summary[group.status] = { count: counted?._all ?? 0, totalCents: group._sum?.totalCents ?? 0 };
    }

    return {
      data: rows.map((row) => this.toListView(row)),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      summary,
    };
  }

  async findOne(user: AuthenticatedRequestUser, id: string) {
    const purchase = await this.loadScoped(user, id);
    const events = await this.prisma.auditLog.findMany({
      where: { tenantId: user.tenantId, entity: 'Purchase', entityId: id },
      orderBy: { createdAt: 'asc' },
      select: { id: true, action: true, createdAt: true, afterData: true, user: { select: { id: true, name: true } } },
    });
    return this.toDetailView(purchase, events);
  }

  async create(user: AuthenticatedRequestUser, dto: CreatePurchaseDto) {
    await this.branchAccess.assertAccess(user, dto.branchId);
    if (dto.receiveNow && !user.permissions.includes('purchases.receive')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Você não tem permissão para receber compras.',
      });
    }
    await this.requireActiveSupplier(user.tenantId, dto.supplierId);
    const lines = await this.buildLines(user.tenantId, dto.items);
    const adjustments = {
      discountCents: dto.discountCents ?? 0,
      freightCents: dto.freightCents ?? 0,
      otherCostsCents: dto.otherCostsCents ?? 0,
    };
    const totals = computePurchaseTotals(lines, adjustments);
    assertTotalsWithinLimit(totals);
    if (totals.totalCents < 0) throw invalidPurchaseTotal();

    const outcome = await this.runInTransaction(async (tx) => {
      const purchaseNumber = await this.nextPurchaseNumber(tx, user.tenantId);
      const created = await tx.purchase.create({
        data: {
          tenantId: user.tenantId,
          branchId: dto.branchId,
          supplierId: dto.supplierId,
          purchaseNumber,
          purchaseDate: new Date(dto.purchaseDate),
          ...adjustments,
          subtotalCents: totals.subtotalCents,
          totalCents: totals.totalCents,
          notes: dto.notes?.trim() || null,
          createdById: user.userId,
          items: {
            create: lines.map((line, index) => ({
              inventoryItemId: line.inventoryItemId,
              quantity: line.quantity,
              unitCostCents: line.unitCostCents,
              totalCostCents: totals.lineTotals[index],
              lotCode: line.lotCode,
              expiresAt: line.expiresAt,
            })),
          },
        },
        select: { id: true },
      });
      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'PURCHASE_CREATED',
        entity: 'Purchase',
        entityId: created.id,
        afterData: {
          purchaseNumber,
          branchId: dto.branchId,
          supplierId: dto.supplierId,
          itemCount: lines.length,
          totalCents: totals.totalCents,
        },
      });
      if (dto.receiveNow) await this.receiveInTx(tx, user, created.id);
      return { id: created.id };
    });

    return this.findOne(user, outcome.id);
  }

  async update(user: AuthenticatedRequestUser, id: string, dto: UpdatePurchaseDto) {
    await this.loadScoped(user, id);
    if (dto.supplierId) await this.requireActiveSupplier(user.tenantId, dto.supplierId);
    const newLines = dto.items ? await this.buildLines(user.tenantId, dto.items) : null;

    await this.runInTransaction(async (tx) => {
      const locked = await this.lockPurchase(tx, user.tenantId, id);
      if (locked.status !== 'DRAFT') throw purchaseNotEditable();

      const fresh = await tx.purchase.findUniqueOrThrow({ where: { id }, include: { items: true } });
      const lines: Pick<LineData, 'quantity' | 'unitCostCents'>[] = newLines ?? fresh.items;
      const adjustments = {
        discountCents: dto.discountCents ?? fresh.discountCents,
        freightCents: dto.freightCents ?? fresh.freightCents,
        otherCostsCents: dto.otherCostsCents ?? fresh.otherCostsCents,
      };
      const totals = computePurchaseTotals(lines, adjustments);
      assertTotalsWithinLimit(totals);
      if (totals.totalCents < 0) throw invalidPurchaseTotal();

      if (newLines) {
        await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
        await tx.purchaseItem.createMany({
          data: newLines.map((line, index) => ({
            purchaseId: id,
            inventoryItemId: line.inventoryItemId,
            quantity: line.quantity,
            unitCostCents: line.unitCostCents,
            totalCostCents: totals.lineTotals[index],
            lotCode: line.lotCode,
            expiresAt: line.expiresAt,
          })),
        });
      }
      await tx.purchase.update({
        where: { id },
        data: {
          ...(dto.supplierId ? { supplierId: dto.supplierId } : {}),
          ...(dto.purchaseDate ? { purchaseDate: new Date(dto.purchaseDate) } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
          ...adjustments,
          subtotalCents: totals.subtotalCents,
          totalCents: totals.totalCents,
        },
      });
      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'PURCHASE_UPDATED',
        entity: 'Purchase',
        entityId: id,
        beforeData: { totalCents: fresh.totalCents, supplierId: fresh.supplierId },
        afterData: { totalCents: totals.totalCents, supplierId: dto.supplierId ?? fresh.supplierId },
      });
    });

    return this.findOne(user, id);
  }

  async receive(user: AuthenticatedRequestUser, id: string) {
    await this.loadScoped(user, id);
    const outcome = await this.runInTransaction((tx) => this.receiveInTx(tx, user, id));
    return { ...(await this.findOne(user, id)), idempotentReplay: outcome.replay };
  }

  async cancel(user: AuthenticatedRequestUser, id: string, dto: CancelPurchaseDto) {
    const purchase = await this.loadScoped(user, id);
    const reason = dto.reason?.trim() || null;
    if (purchase.status === 'RECEIVED' && !reason) throw cancelReasonRequired();

    const outcome = await this.runInTransaction((tx) => this.cancelInTx(tx, user, purchase, reason));
    return { ...(await this.findOne(user, id)), idempotentReplay: outcome.replay };
  }

  private async receiveInTx(tx: Tx, user: AuthenticatedRequestUser, id: string): Promise<ReceiveOutcome> {
    const locked = await this.lockPurchase(tx, user.tenantId, id);
    if (locked.status === 'RECEIVED') return { replay: true, movements: [] };
    if (locked.status === 'CANCELLED') throw purchaseCancelled();

    const purchase = await tx.purchase.findUniqueOrThrow({
      where: { id },
      include: { supplier: { select: { name: true } }, items: { include: { inventoryItem: true } } },
    });
    if (purchase.items.length === 0) throw purchaseEmpty();

    for (const item of purchase.items) {
      if (item.inventoryItem.tenantId !== user.tenantId) throw inventoryItemNotFound();
      if (!item.inventoryItem.active) throw inventoryItemInactive();
      assertEntryRules(item.inventoryItem, { expiresAt: item.expiresAt });
    }

    const ordered = [...purchase.items].sort(
      (a, b) => a.inventoryItemId.localeCompare(b.inventoryItemId) || a.id.localeCompare(b.id),
    );
    const movements: StockMovement[] = [];
    try {
      for (const item of ordered) {
        movements.push(
          await this.ledger.apply(tx, {
            tenantId: user.tenantId,
            branchId: purchase.branchId,
            inventoryItemId: item.inventoryItemId,
            itemName: item.inventoryItem.name,
            type: 'ENTRY',
            origin: 'PURCHASE',
            delta: item.quantity,
            allowNegative: false,
            incomingUnitCostCents: item.unitCostCents,
            supplierName: purchase.supplier.name,
            documentNumber: purchase.purchaseNumber,
            lotCode: item.lotCode,
            expiresAt: item.expiresAt,
            reference: { type: 'PURCHASE', id: item.id },
            userId: user.userId,
          }),
        );
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw purchaseAlreadyProcessed();
      }
      throw error;
    }

    await tx.purchase.update({
      where: { id },
      data: { status: 'RECEIVED', receivedAt: new Date(), receivedById: user.userId },
    });
    await this.audit.recordTx(tx, {
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'PURCHASE_RECEIVED',
      entity: 'Purchase',
      entityId: id,
      afterData: {
        purchaseNumber: purchase.purchaseNumber,
        branchId: purchase.branchId,
        itemCount: movements.length,
        stockMovementIds: movements.map((movement) => movement.id),
      },
    });
    return { replay: false, movements };
  }

  private async cancelInTx(
    tx: Tx,
    user: AuthenticatedRequestUser,
    purchase: PurchaseDetail,
    reason: string | null,
  ): Promise<CancelOutcome> {
    const locked = await this.lockPurchase(tx, user.tenantId, purchase.id);
    if (locked.status === 'CANCELLED') return { replay: true, previousStatus: 'CANCELLED', movements: [] };
    if (locked.status === 'RECEIVED' && !reason) throw cancelReasonRequired();

    const movements: StockMovement[] = [];
    if (locked.status === 'RECEIVED') {
      const itemIds = purchase.items.map((item) => item.id);
      const entries = await tx.stockMovement.findMany({
        where: { tenantId: user.tenantId, referenceType: 'PURCHASE', referenceId: { in: itemIds }, type: 'ENTRY' },
        include: { inventoryItem: { select: { name: true } } },
        orderBy: [{ inventoryItemId: 'asc' }, { id: 'asc' }],
      });
      if (entries.length !== itemIds.length) throw purchaseStockMismatch();

      const allowNegative = await this.ledger.branchAllowsNegative(tx, locked.branchId);
      try {
        for (const entry of entries) {
          movements.push(
            await this.ledger.apply(tx, {
              tenantId: user.tenantId,
              branchId: entry.branchId,
              inventoryItemId: entry.inventoryItemId,
              itemName: entry.inventoryItem.name,
              type: 'REVERSAL',
              origin: 'REVERSAL',
              delta: entry.quantity.neg(),
              allowNegative,
              supplierName: entry.supplierName,
              documentNumber: entry.documentNumber,
              lotCode: entry.lotCode,
              expiresAt: entry.expiresAt,
              notes: `Estorno da compra ${purchase.purchaseNumber}`,
              reference: { type: 'PURCHASE', id: entry.referenceId! },
              userId: user.userId,
            }),
          );
        }
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw purchaseAlreadyProcessed();
        }
        throw error;
      }
    }

    await tx.purchase.update({
      where: { id: purchase.id },
      data: { status: 'CANCELLED', cancelledAt: new Date(), cancelledById: user.userId, cancelReason: reason },
    });
    await this.audit.recordTx(tx, {
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'PURCHASE_CANCELLED',
      entity: 'Purchase',
      entityId: purchase.id,
      beforeData: { status: locked.status },
      afterData: {
        purchaseNumber: purchase.purchaseNumber,
        branchId: purchase.branchId,
        reason,
        reversalMovementIds: movements.map((movement) => movement.id),
      },
    });
    return { replay: false, previousStatus: locked.status, movements };
  }

  private async runInTransaction<T>(work: (tx: Tx) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work, TRANSACTION_OPTIONS);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw purchaseAlreadyProcessed();
      }
      throw error;
    }
  }

  private async lockPurchase(tx: Tx, tenantId: string, id: string): Promise<LockedPurchase> {
    const rows = await tx.$queryRaw<LockedPurchase[]>`
      SELECT "status", "branchId" FROM "purchases" WHERE "id" = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
    if (rows.length === 0) throw purchaseNotFound();
    return rows[0];
  }

  private async nextPurchaseNumber(tx: Tx, tenantId: string): Promise<string> {
    const rows = await tx.$queryRaw<{ lastNumber: number }[]>`
      INSERT INTO "purchase_sequences" ("tenantId", "lastNumber") VALUES (${tenantId}, 1)
      ON CONFLICT ("tenantId") DO UPDATE SET "lastNumber" = "purchase_sequences"."lastNumber" + 1
      RETURNING "lastNumber"`;
    return `COMP-${String(rows[0].lastNumber).padStart(6, '0')}`;
  }

  private async loadScoped(user: AuthenticatedRequestUser, id: string): Promise<PurchaseDetail> {
    const purchase = await this.prisma.purchase.findFirst({
      where: { id, tenantId: user.tenantId },
      include: detailInclude,
    });
    if (!purchase) throw purchaseNotFound();
    const allowedBranchIds = await this.branchAccess.accessibleBranchIds(user);
    if (allowedBranchIds && !allowedBranchIds.includes(purchase.branchId)) throw purchaseNotFound();
    return purchase;
  }

  private async requireActiveSupplier(tenantId: string, supplierId: string) {
    const supplier = await this.prisma.supplier.findFirst({
      where: { id: supplierId, tenantId },
      select: { active: true },
    });
    if (!supplier) throw supplierNotFound();
    if (!supplier.active) throw supplierInactive();
  }

  private async buildLines(tenantId: string, inputs: PurchaseItemInputDto[]): Promise<LineData[]> {
    const ids = [...new Set(inputs.map((input) => input.inventoryItemId))];
    const items = await this.prisma.inventoryItem.findMany({
      where: { id: { in: ids }, tenantId },
      select: { id: true, active: true },
    });
    const byId = new Map(items.map((item) => [item.id, item]));
    for (const id of ids) {
      const item = byId.get(id);
      if (!item) throw inventoryItemNotFound();
      if (!item.active) throw inventoryItemInactive();
    }
    return inputs.map((input) => ({
      inventoryItemId: input.inventoryItemId,
      quantity: toQuantity(input.quantity),
      unitCostCents: input.unitCostCents,
      lotCode: input.lotCode?.trim() || null,
      expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
    }));
  }

  private toListView(row: PurchaseListRow) {
    return {
      id: row.id,
      purchaseNumber: row.purchaseNumber,
      status: row.status,
      purchaseDate: row.purchaseDate,
      supplier: row.supplier,
      branch: row.branch,
      itemCount: row._count.items,
      subtotalCents: row.subtotalCents,
      totalCents: row.totalCents,
      receivedAt: row.receivedAt,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
    };
  }

  private toDetailView(
    row: PurchaseDetail,
    events: { id: string; action: string; createdAt: Date; afterData: Prisma.JsonValue; user: { id: string; name: string } | null }[],
  ) {
    return {
      id: row.id,
      purchaseNumber: row.purchaseNumber,
      status: row.status,
      purchaseDate: row.purchaseDate,
      supplier: row.supplier,
      branch: row.branch,
      subtotalCents: row.subtotalCents,
      discountCents: row.discountCents,
      freightCents: row.freightCents,
      otherCostsCents: row.otherCostsCents,
      totalCents: row.totalCents,
      notes: row.notes,
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      receivedAt: row.receivedAt,
      receivedBy: row.receivedBy,
      cancelledAt: row.cancelledAt,
      cancelledBy: row.cancelledBy,
      cancelReason: row.cancelReason,
      items: row.items.map((item) => ({
        id: item.id,
        inventoryItem: item.inventoryItem,
        quantity: toDisplay(item.quantity),
        unitCostCents: item.unitCostCents,
        totalCostCents: item.totalCostCents,
        lotCode: item.lotCode,
        expiresAt: item.expiresAt,
      })),
      events: events.map((event) => ({
        id: event.id,
        action: event.action,
        createdAt: event.createdAt,
        user: event.user,
        reason:
          event.action === 'PURCHASE_CANCELLED' &&
          event.afterData &&
          typeof event.afterData === 'object' &&
          !Array.isArray(event.afterData) &&
          typeof event.afterData.reason === 'string'
            ? event.afterData.reason
            : null,
      })),
    };
  }
}
