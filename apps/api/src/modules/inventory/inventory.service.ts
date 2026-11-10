import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma, StockMovement } from '@prisma/client';
import { cancelledUnitsShare, computeConsumption, Decimal, RecipeLine } from './inventory-calculations';
import { StockLedgerService, Tx } from './stock-ledger.service';

export interface OrderForStock {
  id: string;
  tenantId: string;
  branchId: string;
  items: { productId: string; quantity: number }[];
}

// An order just written as PENDING (same transaction), with the names it was sold under.
export interface NewPendingOrder extends OrderForStock {
  items: { productId: string; quantity: number; productNameSnapshot: string }[];
}

// B9: the items of a round just written (same transaction), each consumed under its own id.
export interface TabRoundForStock {
  tenantId: string;
  branchId: string;
  items: { id: string; productId: string; quantity: number; productNameSnapshot: string }[];
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

    const { itemNames, recipeLines } = await this.loadRecipes(tx, order);
    if (recipeLines.size === 0) return [];

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

  // B2 (piloto 2026-10-23): an order born PENDING (online checkout, PDV) only consumes its
  // recipes when it is confirmed, so the stock has to be checked when it is TAKEN, or the
  // customer is told "pedido recebido" for something the kitchen can never confirm. Called by
  // OrderCreationService at the END of the order transaction, after the order row exists:
  //  - every balance this order needs is locked FOR UPDATE, in id order, the same lock (and the
  //    same order) the confirmation and the manual movements take - stock is always the last
  //    lock of an order flow, so nothing waits on a lock taken before this one;
  //  - then what the branch's PENDING orders (this one included) still need is summed and
  //    compared with the balance. A concurrent order for the same ingredient waits on the lock
  //    and, once the first commits, sees its PENDING order in the sum: two orders cannot both
  //    take the last units.
  // Nothing is consumed here. Branches that allow negative stock, and products without a
  // recipe, are not restricted. The refusal names the product, never a quantity.
  async assertAvailableForNewPendingOrderInTx(tx: Tx, order: NewPendingOrder): Promise<void> {
    const { recipeLines } = await this.loadRecipes(tx, order);
    if (recipeLines.size === 0) return;
    const needed = computeConsumption(order.items, recipeLines);
    if (needed.length === 0) return;
    if (await this.ledger.branchAllowsNegative(tx, order.branchId)) return;

    const balances = await this.lockBalancesInTx(tx, order, needed);
    const reserved = await this.pendingOrdersNeedInTx(tx, order, needed);

    const short = [...reserved].find(([inventoryItemId, quantity]) =>
      quantity.gt(balances.get(inventoryItemId) ?? new Decimal(0)),
    );
    if (!short) return;
    const [shortItemId] = short;
    const product =
      order.items.find((item) => recipeLines.get(item.productId)?.some((l) => l.inventoryItemId === shortItemId)) ??
      order.items[0];
    throw new ConflictException({
      code: 'PRODUCT_OUT_OF_STOCK',
      message: `Desculpe, não temos "${product.productNameSnapshot}" disponível nessa quantidade agora. Diminua a quantidade ou remova o item para continuar.`,
      details: { productId: product.productId },
    });
  }

  // B9: a round sent to the kitchen from a table consumes its recipes right away - the kitchen is
  // about to use the ingredients, and once sent nothing may fail for lack of stock later (not the
  // preparation, not the checkout). Called by TabRoundsService at the END of the round
  // transaction, after the round and its items exist:
  //  - every balance the round needs is locked FOR UPDATE, in id order, BEFORE any movement is
  //    written (same lock and same order as the PENDING check above and the confirmation);
  //  - unless the branch allows negative stock, the round only goes if the balance still covers
  //    it ON TOP of what the branch's PENDING orders need (B2): an online or PDV order already
  //    told "pedido recebido" keeps its ingredients. Refused = PRODUCT_OUT_OF_STOCK naming the
  //    product, and the caller's transaction rolls back the whole round;
  //  - then one SALE per item and ingredient, referenced to the tab item (unique per item,
  //    ingredient and type, so the same item can never be consumed twice).
  //
  // `servedAlready`: items launched before rounds existed (migration 19), consumed at checkout for
  // the units still due. The food is already at the table, so nothing is checked and the balance
  // may go negative - refusing would only bring back B9 (a bill that cannot be closed).
  async consumeForTabRoundInTx(
    tx: Tx,
    round: TabRoundForStock,
    userId: string,
    { servedAlready = false }: { servedAlready?: boolean } = {},
  ): Promise<StockMovement[]> {
    const { itemNames, recipeLines } = await this.loadRecipes(tx, round);
    const needed = computeConsumption(round.items, recipeLines);
    if (needed.length === 0) return [];

    const balances = await this.lockBalancesInTx(tx, round, needed);
    const allowNegative = servedAlready || (await this.ledger.branchAllowsNegative(tx, round.branchId));
    if (!allowNegative) {
      const reserved = await this.pendingOrdersNeedInTx(tx, round, needed);
      const short = needed.find((line) =>
        line.quantity.add(reserved.get(line.inventoryItemId) ?? 0).gt(balances.get(line.inventoryItemId) ?? 0),
      );
      if (short) {
        const item =
          round.items.find((i) => recipeLines.get(i.productId)?.some((l) => l.inventoryItemId === short.inventoryItemId)) ??
          round.items[0];
        throw new ConflictException({
          code: 'PRODUCT_OUT_OF_STOCK',
          message: `Não há estoque para "${item.productNameSnapshot}" nessa quantidade. Diminua a quantidade ou retire o item da rodada.`,
          details: { productId: item.productId },
        });
      }
    }

    const movements: StockMovement[] = [];
    for (const item of round.items) {
      for (const line of computeConsumption([item], recipeLines)) {
        movements.push(
          await this.ledger.apply(tx, {
            tenantId: round.tenantId,
            branchId: round.branchId,
            inventoryItemId: line.inventoryItemId,
            itemName: itemNames.get(line.inventoryItemId) ?? 'insumo',
            type: 'SALE',
            origin: 'ORDER',
            delta: line.quantity.neg(),
            allowNegative,
            reference: { type: 'TAB_ITEM', id: item.id },
            userId,
          }),
        );
      }
    }
    return movements;
  }

  // B9: what the round consumed for one tab item (its SALE movements, one per ingredient, in
  // ingredient id order - the order the balances are locked in).
  tabItemSalesInTx(tx: Tx, tenantId: string, tabItemId: string) {
    return tx.stockMovement.findMany({
      where: { tenantId, referenceType: 'TAB_ITEM', referenceId: tabItemId, type: 'SALE' },
      include: { inventoryItem: { select: { name: true } } },
      orderBy: { inventoryItemId: 'asc' },
    });
  }

  // B9: cancelled units of a tab item whose ingredients go back. Gives back exactly their share of
  // what the item consumed when it was sent (not today's recipe, which may have changed since),
  // at the cost it left with, one REVERSAL per ingredient referenced to the cancellation (unique
  // per cancellation, ingredient and type). The caller holds the tab and item locks; balances are
  // the last lock, in id order.
  async returnCancelledTabItemUnitsInTx(
    tx: Tx,
    input: {
      tenantId: string;
      cancellationId: string;
      sales: Awaited<ReturnType<InventoryService['tabItemSalesInTx']>>;
      itemQuantity: number;
      cancelledBefore: number;
      count: number;
    },
    userId: string,
  ): Promise<StockMovement[]> {
    const movements: StockMovement[] = [];
    for (const sale of input.sales) {
      const share = cancelledUnitsShare(sale.quantity.neg(), input.itemQuantity, input.cancelledBefore, input.count);
      if (share.lte(0)) continue;
      movements.push(
        await this.ledger.apply(tx, {
          tenantId: input.tenantId,
          branchId: sale.branchId,
          inventoryItemId: sale.inventoryItemId,
          itemName: sale.inventoryItem.name,
          type: 'REVERSAL',
          origin: 'REVERSAL',
          delta: share,
          incomingUnitCostCents: sale.unitCostCents ?? undefined,
          allowNegative: true,
          notes: 'Estorno por cancelamento de item da mesa',
          reference: { type: 'TAB_ITEM_CANCELLATION', id: input.cancellationId },
          userId,
        }),
      );
    }
    return movements;
  }

  // Locks, in id order (computeConsumption sorts), every balance in `needed`.
  private async lockBalancesInTx(
    tx: Tx,
    scope: { tenantId: string; branchId: string },
    needed: { inventoryItemId: string }[],
  ): Promise<Map<string, Decimal>> {
    const balances = new Map<string, Decimal>();
    for (const line of needed) {
      const locked = await this.ledger.lockBalance(tx, {
        tenantId: scope.tenantId,
        branchId: scope.branchId,
        inventoryItemId: line.inventoryItemId,
      });
      balances.set(line.inventoryItemId, locked.quantity);
    }
    return balances;
  }

  // What the branch's PENDING orders still need of each of these ingredients (B2). The caller
  // holds the balance locks, so no order can be taken or confirmed for them meanwhile.
  private async pendingOrdersNeedInTx(
    tx: Tx,
    scope: { tenantId: string; branchId: string },
    needed: { inventoryItemId: string }[],
  ): Promise<Map<string, Decimal>> {
    const rows = await tx.$queryRaw<{ inventoryItemId: string; reserved: string }[]>`
      SELECT ri."inventoryItemId", SUM(oi."quantity" * ri."quantity")::text AS "reserved"
      FROM "order_items" oi
      JOIN "orders" o ON o."id" = oi."orderId"
      JOIN "product_recipes" pr ON pr."productId" = oi."productId" AND pr."tenantId" = o."tenantId"
      JOIN "product_recipe_items" ri ON ri."recipeId" = pr."id"
      WHERE o."tenantId" = ${scope.tenantId} AND o."branchId" = ${scope.branchId} AND o."status" = 'PENDING'
        AND ri."inventoryItemId" IN (${Prisma.join(needed.map((line) => line.inventoryItemId))})
      GROUP BY ri."inventoryItemId"`;
    return new Map(rows.map((row) => [row.inventoryItemId, new Decimal(row.reserved)]));
  }

  private async loadRecipes(tx: Tx, order: { tenantId: string; items: { productId: string }[] }) {
    const productIds = [...new Set(order.items.map((item) => item.productId))];
    const recipes = await tx.productRecipe.findMany({
      where: { tenantId: order.tenantId, productId: { in: productIds } },
      include: { items: { include: { inventoryItem: { select: { name: true } } } } },
    });
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
    return { itemNames, recipeLines };
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
