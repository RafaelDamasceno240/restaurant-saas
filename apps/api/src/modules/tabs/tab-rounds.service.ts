import { randomUUID } from 'crypto';
import { BadRequestException, ConflictException, ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma, TabItemStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { InventoryService } from '../inventory/inventory.service';
import { OrderCreationService, PricedOrderItem } from '../order-creation/order-creation.service';
import { normalizeLineNote } from '../order-creation/option-pricing';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { MAX_UNITS_PER_PRODUCT } from '../../common/util/item-quantity.util';
import { TabsService } from './tabs.service';
import { mergeRoundOptions, productOverTabUnitLimit, RoundLine, roundSignature } from './tab-calculations';
import { decideCancellation } from './tab-item-rules';
import { QuoteTabRoundDto, SendTabRoundDto } from './dto/send-tab-round.dto';
import { CancelTabItemDto } from './dto/cancel-tab-item.dto';

type Tx = Prisma.TransactionClient;

// Same budget as the order transaction: a round may wait on the stock balances of an ingredient
// other channels are using at the same moment.
const ROUND_TRANSACTION_OPTIONS = { timeout: 20_000, maxWait: 10_000 };

// How a round is priced: the order pricing, with the 50-units limit left to the tab-wide check.
const ROUND_PRICING = {
  skipUnitLimit: true,
  unavailableMessage: 'Um ou mais produtos da rodada não estão mais disponíveis.',
};

const ROUND_WITH_ITEMS = { items: { include: { options: true } } } satisfies Prisma.TabRoundInclude;

type ExistingRound = Prisma.TabRoundGetPayload<{ include: typeof ROUND_WITH_ITEMS }>;

type SendTxResult =
  | {
      kind: 'created';
      roundId: string;
      number: number;
      itemIds: string[];
      movementIds: string[];
      lines: RoundLine[];
      priced: PricedOrderItem[];
    }
  | { kind: 'replay'; roundId: string; number: number };

// ===========================================================================
// B9 (piloto 2026-10-23): a table's items go to the kitchen in ROUNDS. The waiter builds a draft
// on the device and sends it whole; the API then, in ONE transaction:
//   tab lock (FOR UPDATE, tab must be OPEN) -> replay check by idempotency key -> 50 units per
//   product over the tab's ACTIVE units (B7) -> round + items (status SENT) -> stock balances
//   locked, checked against what PENDING orders need (B2), recipes consumed (SALE per item).
// Anything refused (closed tab, limit, no stock) rolls the whole round back: no item, no movement.
// Stock is always the last lock, as in every order flow.
// Add-ons (migration 22): before the transaction the round is priced exactly like a PDV or online
// sale (OrderCreationService.priceItems: required groups, limits, sold out, tenant scope); each
// item keeps its add-ons in tab_item_options and its unit price includes them. Add-ons have no
// recipe, so the stock consumed is still the product's own.
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
    private readonly orderCreation: OrderCreationService,
  ) {}

  async send(user: AuthenticatedRequestUser, tabId: string, dto: SendTabRoundDto) {
    const tab = await this.tabs.findTabForWrite(user, tabId);
    const lines: RoundLine[] = dto.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      notes: normalizeLineNote(item.notes),
      options: mergeRoundOptions(item.options),
    }));

    // A retry of a round already sent answers with that round even if a product was deactivated
    // (or an add-on sold out) in the meantime, so the replay is looked for before anything is priced.
    const known = await this.findByKey(tab.id, dto.idempotencyKey);
    if (known) return this.respond(user, tab.id, this.replayOrConflict(known, lines));

    const priced = await this.priceLines(user.tenantId, dto.items);

    let result: SendTxResult;
    try {
      result = await this.prisma.$transaction(
        (tx) => this.sendInTx(tx, user, tab, dto.idempotencyKey, lines, priced),
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
            unitPriceCents: result.priced[index].unitPriceCents,
            options: (result.priced[index].options ?? []).map((o) => ({ optionItemId: o.optionItemId, quantity: o.quantity })),
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

  // Read-only: what the waiter's draft costs, line by line (add-ons included), priced by the same
  // code as the round itself. Nothing is written or reserved; sending prices it all again.
  async quote(user: AuthenticatedRequestUser, tabId: string, dto: QuoteTabRoundDto) {
    await this.tabs.findTabForWrite(user, tabId);
    return this.orderCreation.quoteItems(user.tenantId, dto.items, ROUND_PRICING);
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
    priced: PricedOrderItem[],
  ): Promise<SendTxResult> {
    await this.tabs.lockTabAndAssertOpen(tx, tab.id, 'TAB_CLOSED');

    // Re-read AFTER the lock: a concurrent send with this key may have just committed.
    const existing = await tx.tabRound.findUnique({
      where: { tabId_idempotencyKey: { tabId: tab.id, idempotencyKey } },
      include: ROUND_WITH_ITEMS,
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
        message: `No máximo ${MAX_UNITS_PER_PRODUCT} unidades de "${priced.find((p) => p.productId === overLimit)!.productNameSnapshot}" na comanda.`,
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

    // Name and price (add-ons of one unit included) are the server's snapshot of this moment; a
    // later change of the menu never touches them (same rule as an order line).
    const items = priced.map((line, index) => ({
      id: randomUUID(),
      tenantId: user.tenantId,
      tabId: tab.id,
      roundId: round.id,
      productId: line.productId,
      productNameSnapshot: line.productNameSnapshot,
      unitPriceCentsSnapshot: line.unitPriceCents,
      quantity: line.quantity,
      notes: line.notes ?? null,
      status: 'SENT' as const,
      sentAt,
      sentByUserId: user.userId,
      // One millisecond apart, in the order the waiter listed them: the tab and the kitchen
      // show the lines of a round as they were sent.
      createdAt: new Date(sentAt.getTime() + index),
    }));
    await tx.tabItem.createMany({ data: items });
    const options = priced.flatMap((line, index) =>
      (line.options ?? []).map((option) => ({ ...option, tabItemId: items[index].id })),
    );
    if (options.length > 0) await tx.tabItemOption.createMany({ data: options });

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
      priced,
    };
  }

  // The SAME pricing as a PDV or online sale (OrderCreationService.priceItems): every product
  // re-read scoped to THIS tenant, active and not sold out, every add-on checked against the
  // product's own groups (required groups, limits, sold out), one single 400 for "missing",
  // "another tenant's" and "inactive" so the caller never learns which. The 50-units limit is
  // checked over the whole tab inside the transaction instead.
  private priceLines(tenantId: string, items: SendTabRoundDto['items']): Promise<PricedOrderItem[]> {
    return this.orderCreation.priceItems(tenantId, items, { enforceRequiredOptions: true, ...ROUND_PRICING });
  }

  private findByKey(tabId: string, idempotencyKey: string) {
    return this.prisma.tabRound.findUnique({
      where: { tabId_idempotencyKey: { tabId, idempotencyKey } },
      include: ROUND_WITH_ITEMS,
    });
  }

  private replayOrConflict(existing: ExistingRound, lines: RoundLine[]): SendTxResult {
    // Quantity, notes and add-ons of a sent item never change (a cancellation only counts
    // cancelled units), so the round's items are still exactly what was sent.
    const sent: RoundLine[] = existing.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      notes: item.notes,
      options: item.options.map((o) => ({ optionItemId: o.optionItemId, quantity: o.quantity })),
    }));
    if (roundSignature(sent) !== roundSignature(lines)) {
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
