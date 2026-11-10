import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, Product, TabItemStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../inventory/inventory.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { MAX_UNITS_PER_PRODUCT } from '../../common/util/item-quantity.util';
import { TabsService } from './tabs.service';
import { productOverTabUnitLimit, RoundLine, roundSignature } from './tab-calculations';
import { decideCancellation } from './tab-item-rules';
import { SendTabRoundDto } from './dto/send-tab-round.dto';
import { CancelTabItemDto } from './dto/cancel-tab-item.dto';

type Tx = Prisma.TransactionClient;

// Same budget as the order transaction: a round may wait on the stock balances of an ingredient
// other channels are using at the same moment.
const ROUND_TRANSACTION_OPTIONS = { timeout: 20_000, maxWait: 10_000 };

type ExistingRound = Prisma.TabRoundGetPayload<{ include: { items: true } }>;

type SendTxResult =
  | { kind: 'created'; roundId: string; number: number; itemIds: string[]; movementIds: string[]; lines: RoundLine[] }
  | { kind: 'replay'; roundId: string; number: number };

// ===========================================================================
// B9 (piloto 2026-10-23): a table's items go to the kitchen in ROUNDS. The waiter builds a draft
// on the device and sends it whole; the API then, in ONE transaction:
//   tab lock (FOR UPDATE, tab must be OPEN) -> replay check by idempotency key -> 50 units per
//   product over the tab's ACTIVE units (B7) -> round + items (status SENT) -> stock balances
//   locked, checked against what PENDING orders need (B2), recipes consumed (SALE per item).
// Anything refused (closed tab, limit, no stock) rolls the whole round back: no item, no movement.
// Stock is always the last lock, as in every order flow.
// Idempotency: the same key on the same tab returns the round it created (nothing new written),
// whether the retry arrives after the first commit (found after the tab lock) or races it (the
// UNIQUE (tabId, idempotencyKey) fires and the winner is returned). The same key with different
// items is a 409.
// ===========================================================================
@Injectable()
export class TabRoundsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly tabs: TabsService,
    private readonly inventory: InventoryService,
  ) {}

  async send(user: AuthenticatedRequestUser, tabId: string, dto: SendTabRoundDto) {
    const tab = await this.tabs.findTabForWrite(user, tabId);
    const lines: RoundLine[] = dto.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      notes: item.notes?.trim() || null,
    }));

    // A retry of a round already sent answers with that round even if a product was deactivated
    // in the meantime, so the replay is looked for before the products are checked.
    const known = await this.findByKey(tab.id, dto.idempotencyKey);
    if (known) return this.respond(user, tab.id, this.replayOrConflict(known, lines));

    const productById = await this.loadProducts(user.tenantId, lines);

    let result: SendTxResult;
    try {
      result = await this.prisma.$transaction(
        (tx) => this.sendInTx(tx, user, tab, dto.idempotencyKey, lines, productById),
        ROUND_TRANSACTION_OPTIONS,
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const winner = await this.findByKey(tab.id, dto.idempotencyKey);
        if (winner) return this.respond(user, tab.id, this.replayOrConflict(winner, lines));
      }
      throw error;
    }

    if (result.kind === 'created') {
      await this.audit.record({
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'TAB_ROUND_SENT',
        entity: 'TabRound',
        entityId: result.roundId,
        afterData: {
          tabId: tab.id,
          number: result.number,
          items: result.itemIds.map((tabItemId, index) => ({
            tabItemId,
            productId: result.lines[index].productId,
            quantity: result.lines[index].quantity,
          })),
        },
      });
      if (result.movementIds.length > 0) {
        await this.audit.record({
          tenantId: user.tenantId,
          userId: user.userId,
          action: 'INVENTORY_MOVEMENT_CREATED',
          entity: 'TabRound',
          entityId: result.roundId,
          afterData: { reason: 'TAB_ROUND_SENT', stockMovementIds: result.movementIds },
        });
      }
    }
    return this.respond(user, tab.id, result);
  }

  // =========================================================================
  // B9 - cancelling units of a sent item. One transaction:
  //   tab lock (OPEN) -> item lock (FOR UPDATE; the kitchen locks the same row to move it) ->
  //   rules of tab-item-rules.ts (status, permission, where the stock goes) -> no more units than
  //   are still active -> cancellation row -> stock back (RETURNED only, balances last) ->
  //   item counters/status -> TAB_ITEM_CANCELLED audit, in the same transaction.
  // A closed tab refuses (the sale is concluded and final, as any COMPLETED order).
  // =========================================================================
  async cancelItem(user: AuthenticatedRequestUser, tabId: string, itemId: string, dto: CancelTabItemDto) {
    const tab = await this.tabs.findTabForWrite(user, tabId);
    const reason = dto.reason.trim();

    await this.prisma.$transaction(async (tx) => {
      await this.tabs.lockTabAndAssertOpen(tx, tab.id, 'TAB_CLOSED');
      const rows = await tx.$queryRaw<
        { status: TabItemStatus; quantity: number; cancelledQuantity: number; roundId: string | null; productNameSnapshot: string }[]
      >`
        SELECT "status", "quantity", "cancelledQuantity", "roundId", "productNameSnapshot"
        FROM "tab_items" WHERE "id" = ${itemId} AND "tabId" = ${tab.id} FOR UPDATE`;
      if (rows.length === 0) throw this.tabs.itemNotFound();
      const item = rows[0];

      // A legacy item (launched before rounds) consumed nothing yet: its recipe is consumed at
      // checkout, for the units still due, so cancelling it never touches the stock.
      const sales = item.roundId ? await this.inventory.tabItemSalesInTx(tx, user.tenantId, itemId) : [];
      const decision = decideCancellation({ status: item.status, consumedStock: sales.length > 0, returnToStock: dto.returnToStock });
      if (!decision.ok) {
        throw decision.code === 'TAB_ITEM_ALREADY_CANCELLED'
          ? new ConflictException({ code: decision.code, message: 'Este item já foi cancelado.' })
          : new BadRequestException({ code: decision.code, message: 'Um item já entregue na mesa não volta ao estoque.' });
      }
      if (decision.needsManager && !user.permissions.includes('orders.cancel')) {
        throw new ForbiddenException({
          code: 'FORBIDDEN',
          message: 'Este item já está em preparo, pronto ou entregue: só um gerente pode cancelá-lo.',
        });
      }
      const active = item.quantity - item.cancelledQuantity;
      if (dto.quantity > active) {
        throw new ConflictException({
          code: 'TAB_ITEM_CANCEL_QUANTITY',
          message: `Só há ${active} ${active === 1 ? 'unidade ativa' : 'unidades ativas'} de "${item.productNameSnapshot}" para cancelar.`,
        });
      }

      const cancellation = await tx.tabItemCancellation.create({
        data: {
          tenantId: user.tenantId,
          tabItemId: itemId,
          quantity: dto.quantity,
          reason,
          statusAtCancel: item.status,
          stockOutcome: decision.stockOutcome,
          cancelledByUserId: user.userId,
        },
        select: { id: true },
      });
      const movements =
        decision.stockOutcome === 'RETURNED'
          ? await this.inventory.returnCancelledTabItemUnitsInTx(
              tx,
              {
                tenantId: user.tenantId,
                cancellationId: cancellation.id,
                sales,
                itemQuantity: item.quantity,
                cancelledBefore: item.cancelledQuantity,
                count: dto.quantity,
              },
              user.userId,
            )
          : [];

      const allCancelled = dto.quantity === active;
      await tx.tabItem.update({
        where: { id: itemId },
        data: {
          cancelledQuantity: { increment: dto.quantity },
          ...(allCancelled ? { status: 'CANCELLED', cancelledAt: new Date() } : {}),
        },
      });

      // Who cancelled, what, when (createdAt), why and where the ingredients went - committed
      // with the cancellation or not at all.
      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'TAB_ITEM_CANCELLED',
        entity: 'TabItem',
        entityId: itemId,
        beforeData: { status: item.status, cancelledQuantity: item.cancelledQuantity },
        afterData: {
          tabId: tab.id,
          cancellationId: cancellation.id,
          quantity: dto.quantity,
          reason,
          statusAtCancel: item.status,
          stockOutcome: decision.stockOutcome,
          status: allCancelled ? 'CANCELLED' : item.status,
          cancelledQuantity: item.cancelledQuantity + dto.quantity,
          stockMovementIds: movements.map((movement) => movement.id),
        },
      });
    });

    return this.tabs.findOneForTenant(user, tab.id);
  }

  private async sendInTx(
    tx: Tx,
    user: AuthenticatedRequestUser,
    tab: { id: string; branchId: string },
    idempotencyKey: string,
    lines: RoundLine[],
    productById: Map<string, Product>,
  ): Promise<SendTxResult> {
    await this.tabs.lockTabAndAssertOpen(tx, tab.id, 'TAB_CLOSED');

    // Re-read AFTER the lock: a concurrent send with this key may have just committed.
    const existing = await tx.tabRound.findUnique({
      where: { tabId_idempotencyKey: { tabId: tab.id, idempotencyKey } },
      include: { items: true },
    });
    if (existing) return this.replayOrConflict(existing, lines);

    const current = await tx.tabItem.findMany({
      where: { tabId: tab.id },
      select: { productId: true, quantity: true, cancelledQuantity: true },
    });
    const overLimit = productOverTabUnitLimit(current, lines, MAX_UNITS_PER_PRODUCT);
    if (overLimit) {
      throw new BadRequestException({
        code: 'QUANTITY_LIMIT',
        message: `No máximo ${MAX_UNITS_PER_PRODUCT} unidades de "${productById.get(overLimit)!.name}" na comanda.`,
      });
    }

    // Numbered under the tab lock, so two rounds of the same tab can never take the same number.
    const last = await tx.tabRound.aggregate({ where: { tabId: tab.id }, _max: { number: true } });
    const number = (last._max.number ?? 0) + 1;
    const sentAt = new Date();
    const round = await tx.tabRound.create({
      data: {
        tenantId: user.tenantId,
        branchId: tab.branchId,
        tabId: tab.id,
        number,
        idempotencyKey,
        sentByUserId: user.userId,
        sentAt,
      },
      select: { id: true },
    });

    const items = lines.map((line, index) => {
      const product = productById.get(line.productId)!;
      return {
        id: randomUUID(),
        tenantId: user.tenantId,
        tabId: tab.id,
        roundId: round.id,
        productId: product.id,
        productNameSnapshot: product.name,
        unitPriceCentsSnapshot: product.priceCents,
        quantity: line.quantity,
        notes: line.notes,
        status: 'SENT' as const,
        sentAt,
        sentByUserId: user.userId,
        // One millisecond apart, in the order the waiter listed them: the tab and the kitchen
        // show the lines of a round as they were sent.
        createdAt: new Date(sentAt.getTime() + index),
      };
    });
    await tx.tabItem.createMany({ data: items });

    const movements = await this.inventory.consumeForTabRoundInTx(
      tx,
      { tenantId: user.tenantId, branchId: tab.branchId, items },
      user.userId,
    );

    return {
      kind: 'created',
      roundId: round.id,
      number,
      itemIds: items.map((item) => item.id),
      movementIds: movements.map((movement) => movement.id),
      lines,
    };
  }

  // Every product re-read from the DB, scoped to THIS tenant and active=true, in one query. Same
  // rule (and the same single 400 for "missing", "another tenant's" and "inactive") as the order
  // creation, so the caller never learns which.
  private async loadProducts(tenantId: string, lines: RoundLine[]): Promise<Map<string, Product>> {
    const products = await this.prisma.product.findMany({
      where: { id: { in: [...new Set(lines.map((line) => line.productId))] }, tenantId, active: true },
    });
    const productById = new Map(products.map((product) => [product.id, product]));
    if (lines.some((line) => !productById.has(line.productId))) {
      throw new BadRequestException({
        code: 'PRODUCT_UNAVAILABLE',
        message: 'Um ou mais produtos da rodada não estão mais disponíveis.',
      });
    }
    return productById;
  }

  private findByKey(tabId: string, idempotencyKey: string) {
    return this.prisma.tabRound.findUnique({
      where: { tabId_idempotencyKey: { tabId, idempotencyKey } },
      include: { items: true },
    });
  }

  private replayOrConflict(existing: ExistingRound, lines: RoundLine[]): SendTxResult {
    // Quantity and notes of a sent item never change (a cancellation only counts cancelled
    // units), so the round's items are still exactly what was sent.
    if (roundSignature(existing.items) !== roundSignature(lines)) {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Esta chave de idempotência já foi usada em outra rodada desta comanda.',
      });
    }
    return { kind: 'replay', roundId: existing.id, number: existing.number };
  }

  private async respond(user: AuthenticatedRequestUser, tabId: string, result: SendTxResult) {
    return {
      ...(await this.tabs.findOneForTenant(user, tabId)),
      round: { id: result.roundId, number: result.number },
      idempotentReplay: result.kind === 'replay',
    };
  }
}
