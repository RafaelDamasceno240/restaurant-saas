import { Injectable } from '@nestjs/common';
import { StockMovement } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { compareIds, Decimal, toDisplay, toQuantity } from './inventory-calculations';
import { duplicateItems, hasDuplicates, inventoryItemNotFound } from './inventory-errors';
import { StockLedgerService } from './stock-ledger.service';
import { CreateInventoryCountDto } from './dto/inventory-counts.dto';

interface CountedLine {
  inventoryItemId: string;
  name: string;
  unit: string;
  systemQuantity: Decimal;
  countedQuantity: Decimal;
  difference: Decimal;
  movement: StockMovement | null;
}

@Injectable()
export class InventoryCountsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchAccess: BranchAccessService,
    private readonly ledger: StockLedgerService,
  ) {}

  async create(user: AuthenticatedRequestUser, dto: CreateInventoryCountDto) {
    await this.branchAccess.assertAccess(user, dto.branchId);
    const ids = dto.items.map((line) => line.inventoryItemId);
    if (hasDuplicates(ids)) throw duplicateItems('Cada insumo só pode aparecer uma vez na contagem.');
    const items = await this.prisma.inventoryItem.findMany({ where: { id: { in: ids }, tenantId: user.tenantId } });
    if (items.length !== ids.length) throw inventoryItemNotFound();
    const itemById = new Map(items.map((item) => [item.id, item]));
    const notes = dto.notes?.trim() || null;
    const orderedLines = [...dto.items].sort((a, b) => compareIds(a.inventoryItemId, b.inventoryItemId));

    const { count, lines } = await this.prisma.$transaction(async (tx) => {
      const header = await tx.inventoryCount.create({
        data: { tenantId: user.tenantId, branchId: dto.branchId, notes, createdByUserId: user.userId },
      });
      const counted: CountedLine[] = [];
      for (const line of orderedLines) {
        const item = itemById.get(line.inventoryItemId)!;
        const balance = await this.ledger.lockBalance(tx, {
          tenantId: user.tenantId,
          branchId: dto.branchId,
          inventoryItemId: item.id,
        });
        const countedQuantity = toQuantity(line.countedQuantity);
        const difference = countedQuantity.sub(balance.quantity);
        const movement = difference.isZero()
          ? null
          : await this.ledger.applyToLockedBalance(tx, balance, {
              tenantId: user.tenantId,
              branchId: dto.branchId,
              inventoryItemId: item.id,
              itemName: item.name,
              type: 'ADJUSTMENT',
              origin: 'INVENTORY',
              delta: difference,
              allowNegative: true,
              notes,
              reference: { type: 'INVENTORY_COUNT', id: header.id },
              userId: user.userId,
            });
        await tx.inventoryCountItem.create({
          data: {
            countId: header.id,
            inventoryItemId: item.id,
            systemQuantity: balance.quantity,
            countedQuantity,
            difference,
            stockMovementId: movement?.id ?? null,
          },
        });
        counted.push({
          inventoryItemId: item.id,
          name: item.name,
          unit: item.unit,
          systemQuantity: balance.quantity,
          countedQuantity,
          difference,
          movement,
        });
      }
      return { count: header, lines: counted };
    });

    await this.recordAudit(user, count.id, dto.branchId, lines);

    return {
      id: count.id,
      branchId: count.branchId,
      notes: count.notes,
      createdAt: count.createdAt,
      createdBy: { id: user.userId },
      adjustedCount: lines.filter((line) => line.movement).length,
      items: lines.map((line) => ({
        inventoryItemId: line.inventoryItemId,
        name: line.name,
        unit: line.unit,
        systemQuantity: toDisplay(line.systemQuantity),
        countedQuantity: toDisplay(line.countedQuantity),
        difference: toDisplay(line.difference),
        stockMovementId: line.movement?.id ?? null,
      })),
    };
  }

  private async recordAudit(user: AuthenticatedRequestUser, countId: string, branchId: string, lines: CountedLine[]) {
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'INVENTORY_COUNT_CREATED',
      entity: 'InventoryCount',
      entityId: countId,
      afterData: {
        branchId,
        items: lines.map((line) => ({
          inventoryItemId: line.inventoryItemId,
          systemQuantity: line.systemQuantity.toFixed(3),
          countedQuantity: line.countedQuantity.toFixed(3),
          difference: line.difference.toFixed(3),
        })),
      },
    });
    for (const line of lines) {
      if (!line.movement) continue;
      await this.audit.record({
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'INVENTORY_ADJUSTMENT',
        entity: 'StockMovement',
        entityId: line.movement.id,
        afterData: {
          branchId,
          countId,
          inventoryItemId: line.inventoryItemId,
          quantity: line.difference.toFixed(3),
          balanceAfter: line.countedQuantity.toFixed(3),
        },
      });
    }
  }
}
