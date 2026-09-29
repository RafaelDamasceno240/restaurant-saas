import { randomUUID } from 'crypto';
import { ConflictException, Injectable } from '@nestjs/common';
import {
  Prisma,
  StockExitReason,
  StockMovement,
  StockMovementOrigin,
  StockMovementType,
  StockReferenceType,
} from '@prisma/client';
import { computeAverageCostCents, Decimal, toDisplay, wouldGoNegative } from './inventory-calculations';

export type Tx = Prisma.TransactionClient;

export interface LockedBalance {
  id: string;
  quantity: Decimal;
  averageCostCents: number;
}

export interface BalanceKey {
  tenantId: string;
  branchId: string;
  inventoryItemId: string;
}

export interface LedgerMovementInput extends BalanceKey {
  itemName: string;
  type: StockMovementType;
  origin: StockMovementOrigin;
  delta: Decimal;
  allowNegative: boolean;
  incomingUnitCostCents?: number;
  exitReason?: StockExitReason | null;
  notes?: string | null;
  supplierName?: string | null;
  documentNumber?: string | null;
  lotCode?: string | null;
  expiresAt?: Date | null;
  reference?: { type: StockReferenceType; id: string };
  userId?: string | null;
}

@Injectable()
export class StockLedgerService {
  async lockBalance(tx: Tx, key: BalanceKey): Promise<LockedBalance> {
    await tx.$executeRaw`
      INSERT INTO "inventory_balances" ("id", "tenantId", "branchId", "inventoryItemId", "quantity", "averageCostCents", "updatedAt")
      VALUES (${randomUUID()}, ${key.tenantId}, ${key.branchId}, ${key.inventoryItemId}, 0, 0, NOW())
      ON CONFLICT ("branchId", "inventoryItemId") DO NOTHING`;
    const rows = await tx.$queryRaw<{ id: string; quantity: string; averageCostCents: number }[]>`
      SELECT "id", "quantity"::text AS "quantity", "averageCostCents"
      FROM "inventory_balances"
      WHERE "branchId" = ${key.branchId} AND "inventoryItemId" = ${key.inventoryItemId}
      FOR UPDATE`;
    const row = rows[0];
    return { id: row.id, quantity: new Decimal(row.quantity), averageCostCents: row.averageCostCents };
  }

  async apply(tx: Tx, input: LedgerMovementInput): Promise<StockMovement> {
    const balance = await this.lockBalance(tx, input);
    return this.applyToLockedBalance(tx, balance, input);
  }

  async applyToLockedBalance(tx: Tx, balance: LockedBalance, input: LedgerMovementInput): Promise<StockMovement> {
    if (wouldGoNegative(balance.quantity, input.delta, input.allowNegative)) {
      throw this.insufficientStock(input, balance.quantity);
    }

    const next = balance.quantity.add(input.delta);
    const receivesCost = input.incomingUnitCostCents !== undefined && input.delta.isPositive();
    const averageCostCents = receivesCost
      ? computeAverageCostCents(balance.quantity, balance.averageCostCents, input.delta, input.incomingUnitCostCents!)
      : balance.averageCostCents;

    await tx.inventoryBalance.update({
      where: { id: balance.id },
      data: { quantity: next, averageCostCents },
    });

    return tx.stockMovement.create({
      data: {
        tenantId: input.tenantId,
        branchId: input.branchId,
        inventoryItemId: input.inventoryItemId,
        type: input.type,
        origin: input.origin,
        quantity: input.delta,
        balanceAfter: next,
        unitCostCents: input.incomingUnitCostCents ?? balance.averageCostCents,
        exitReason: input.exitReason ?? null,
        notes: input.notes ?? null,
        supplierName: input.supplierName ?? null,
        documentNumber: input.documentNumber ?? null,
        lotCode: input.lotCode ?? null,
        expiresAt: input.expiresAt ?? null,
        referenceType: input.reference?.type ?? null,
        referenceId: input.reference?.id ?? null,
        createdByUserId: input.userId ?? null,
      },
    });
  }

  async branchAllowsNegative(tx: Tx, branchId: string): Promise<boolean> {
    const branch = await tx.branch.findUnique({ where: { id: branchId }, select: { allowNegativeStock: true } });
    return branch?.allowNegativeStock ?? false;
  }

  private insufficientStock(input: LedgerMovementInput, available: Decimal) {
    const required = input.delta.neg();
    return new ConflictException({
      code: 'INSUFFICIENT_STOCK',
      message: `Estoque insuficiente de "${input.itemName}": saldo ${available.toFixed(3)}, necessário ${required.toFixed(3)}.`,
      details: {
        inventoryItemId: input.inventoryItemId,
        available: toDisplay(available),
        required: toDisplay(required),
      },
    });
  }
}
