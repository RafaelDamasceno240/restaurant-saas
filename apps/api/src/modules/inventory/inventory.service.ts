import { Injectable } from '@nestjs/common';
import { StockMovement } from '@prisma/client';
import { computeConsumption, RecipeLine } from './inventory-calculations';
import { StockLedgerService, Tx } from './stock-ledger.service';

export interface OrderForStock {
  id: string;
  tenantId: string;
  branchId: string;
  items: { productId: string; quantity: number }[];
}

export interface OrderReference {
  id: string;
  tenantId: string;
  branchId: string;
}

@Injectable()
export class InventoryService {
  constructor(private readonly ledger: StockLedgerService) {}

  async consumeForOrderInTx(tx: Tx, order: OrderForStock, userId?: string | null): Promise<StockMovement[]> {
    if (await this.hasOrderMovement(tx, order.id, 'SALE')) return [];

    const productIds = [...new Set(order.items.map((item) => item.productId))];
    const recipes = await tx.productRecipe.findMany({
      where: { tenantId: order.tenantId, productId: { in: productIds } },
      include: { items: { include: { inventoryItem: { select: { name: true } } } } },
    });
    if (recipes.length === 0) return [];

    const itemNames = new Map<string, string>();
    const recipeLines = new Map<string, RecipeLine[]>();
    for (const recipe of recipes) {
      recipeLines.set(
        recipe.productId,
        recipe.items.map((line) => {
          itemNames.set(line.inventoryItemId, line.inventoryItem.name);
          return { inventoryItemId: line.inventoryItemId, quantity: line.quantity };
        }),
      );
    }

    const consumption = computeConsumption(order.items, recipeLines);
    if (consumption.length === 0) return [];
    const allowNegative = await this.ledger.branchAllowsNegative(tx, order.branchId);

    const movements: StockMovement[] = [];
    for (const line of consumption) {
      movements.push(
        await this.ledger.apply(tx, {
          tenantId: order.tenantId,
          branchId: order.branchId,
          inventoryItemId: line.inventoryItemId,
          itemName: itemNames.get(line.inventoryItemId) ?? 'insumo',
          type: 'SALE',
          origin: 'ORDER',
          delta: line.quantity.neg(),
          allowNegative,
          reference: { type: 'ORDER', id: order.id },
          userId,
        }),
      );
    }
    return movements;
  }

  async reverseForOrderInTx(tx: Tx, order: OrderReference, userId?: string | null): Promise<StockMovement[]> {
    const sales = await tx.stockMovement.findMany({
      where: { tenantId: order.tenantId, referenceType: 'ORDER', referenceId: order.id, type: 'SALE' },
      include: { inventoryItem: { select: { name: true } } },
      orderBy: { inventoryItemId: 'asc' },
    });
    if (sales.length === 0) return [];
    if (await this.hasOrderMovement(tx, order.id, 'REVERSAL')) return [];

    const movements: StockMovement[] = [];
    for (const sale of sales) {
      movements.push(
        await this.ledger.apply(tx, {
          tenantId: order.tenantId,
          branchId: sale.branchId,
          inventoryItemId: sale.inventoryItemId,
          itemName: sale.inventoryItem.name,
          type: 'REVERSAL',
          origin: 'REVERSAL',
          delta: sale.quantity.neg(),
          incomingUnitCostCents: sale.unitCostCents ?? undefined,
          allowNegative: true,
          notes: 'Estorno por cancelamento do pedido',
          reference: { type: 'ORDER', id: order.id },
          userId,
        }),
      );
    }
    return movements;
  }

  private async hasOrderMovement(tx: Tx, orderId: string, type: 'SALE' | 'REVERSAL'): Promise<boolean> {
    const found = await tx.stockMovement.findFirst({
      where: { referenceType: 'ORDER', referenceId: orderId, type },
      select: { id: true },
    });
    return found !== null;
  }
}
