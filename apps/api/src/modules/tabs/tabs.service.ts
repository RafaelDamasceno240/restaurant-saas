import {
  ConflictException,
  ForbiddenException,
  HttpException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { TablesService } from '../tables/tables.service';
import { OrderCreationResult, OrderCreationService } from '../order-creation/order-creation.service';
import { PaymentsService } from '../payments/payments.service';
import { CustomerLookupService, LinkableCustomer } from '../customers/customer-lookup.service';
import { InventoryService } from '../inventory/inventory.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { activeUnits, computeTabTotals } from './tab-calculations';
import { buildPricedItemsFromTab, classifyExistingCheckout } from './tab-checkout';
import { CreateTabDto } from './dto/create-tab.dto';
import { ListTabsQueryDto } from './dto/list-tabs-query.dto';
import { CheckoutTabDto } from './dto/checkout-tab.dto';

type Tx = Prisma.TransactionClient;

const tabDetailInclude = {
  table: { select: { id: true, number: true, name: true } },
  items: { orderBy: { createdAt: 'asc' as const }, include: { round: { select: { number: true } } } },
  order: {
    select: {
      id: true,
      orderNumber: true,
      status: true,
      paymentMethod: true,
      totalCents: true,
      payment: { select: { status: true, method: true, amountCents: true, confirmedAt: true } },
    },
  },
} satisfies Prisma.TabInclude;

type ExistingSale = { id: string; tabId: string | null; idempotencyKey: string | null };

type CheckoutTxResult =
  // paymentId is null for a bill put on account (fiado): nothing was received yet.
  | { kind: 'created'; created: OrderCreationResult; paymentId: string | null }
  | { kind: 'existing'; existing: ExistingSale };

type TabWithDetail = Prisma.TabGetPayload<{ include: typeof tabDetailInclude }>;

// ===========================================================================
// Fatia 09 (Comandas). Invariants enforced here:
//  - every value is integer cents, computed server-side only — the item DTO
//    never carries a price field at all (structural guarantee, same as
//    OrderCreationService/PosOrdersService);
//  - opening a tab is serialized per table (SELECT ... FOR UPDATE on the
//    table row) + a partial unique index as DB-level backstop
//    (prisma/sql/tabs_constraints.sql) — never two OPEN tabs for one table;
//  - every item mutation (sending a round, cancelling units - TabRoundsService)
//    and checkout() lock the TAB row FOR UPDATE and re-check status inside the
//    transaction, so an item can never land on a tab that's being checked out,
//    and a tab can never be sold twice;
//  - B9: items are never edited or deleted once sent; more units = a new round,
//    fewer = a cancellation (TabRoundsService);
//  - a CLOSED tab is read-only: no route exists to reopen it, and every
//    mutation re-checks status even if the frontend is stale;
//  - tenantId always from the JWT; branch always re-validated via
//    BranchAccessService; product always re-read from the DB (tenant-scoped
//    + active) — client-supplied price is never trusted.
//  - fatia 10: the ONLY way to close a tab is checkout(), which turns it into
//    a paid Order atomically (see checkout() below).
// ===========================================================================
@Injectable()
export class TabsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchAccess: BranchAccessService,
    private readonly tablesService: TablesService,
    private readonly orderCreation: OrderCreationService,
    private readonly payments: PaymentsService,
    private readonly customers: CustomerLookupService,
    private readonly inventory: InventoryService,
  ) {}

  async findAllForBranch(user: AuthenticatedRequestUser, query: ListTabsQueryDto) {
    await this.branchAccess.assertAccess(user, query.branchId);
    const tabs = await this.prisma.tab.findMany({
      where: {
        tenantId: user.tenantId,
        branchId: query.branchId,
        status: query.status ?? 'OPEN',
      },
      include: tabDetailInclude,
      orderBy: { openedAt: 'desc' },
    });
    return tabs.map((t) => this.toDto(t));
  }

  async findOneForTenant(user: AuthenticatedRequestUser, id: string) {
    const tab = await this.prisma.tab.findFirst({
      where: { id, tenantId: user.tenantId },
      include: tabDetailInclude,
    });
    if (!tab) throw this.notFound();
    await this.branchAccess.assertAccess(user, tab.branchId);
    // Lets the checkout screen warn up front that CASH won't go through,
    // without granting the WAITER role cash.read. Just a boolean — the real
    // gate is still lockOpenSessionForSale() inside the checkout transaction.
    const openCashSessions = await this.prisma.cashRegisterSession.count({
      where: { tenantId: user.tenantId, branchId: tab.branchId, status: 'OPEN' },
    });
    return { ...this.toDto(tab), branchCashRegisterOpen: openCashSessions > 0 };
  }

  async open(user: AuthenticatedRequestUser, dto: CreateTabDto) {
    await this.branchAccess.assertAccess(user, dto.branchId);
    await this.tablesService.assertActiveTableForBranch(user.tenantId, dto.branchId, dto.tableId);

    let tabId: string;
    try {
      tabId = await this.prisma.$transaction(async (tx) => {
        // Serializes concurrent openings for THIS table: the second request
        // blocks here until the first commits, and then its check below sees
        // the committed OPEN tab (READ COMMITTED re-reads after the lock).
        await tx.$queryRaw`SELECT id FROM "dining_tables" WHERE id = ${dto.tableId} FOR UPDATE`;
        const existing = await tx.tab.findFirst({
          where: { tableId: dto.tableId, status: 'OPEN' },
          select: { id: true },
        });
        if (existing) throw this.tableOccupied();
        const created = await tx.tab.create({
          data: {
            tenantId: user.tenantId,
            branchId: dto.branchId,
            tableId: dto.tableId,
            status: 'OPEN',
            customerName: dto.customerName?.trim() || null,
          },
          select: { id: true },
        });
        return created.id;
      });
    } catch (error) {
      // Backstop: the partial unique index fired (should be unreachable
      // given the row lock above, but never let it surface as a 500).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.tableOccupied();
      }
      throw error;
    }

    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'TAB_OPENED',
      entity: 'Tab',
      entityId: tabId,
      afterData: { tableId: dto.tableId, branchId: dto.branchId },
    });
    return this.findOneForTenant(user, tabId);
  }

  // =========================================================================
  // Fatia 10 — checkout: Tab OPEN -> paid Order + OrderItems (from the
  // TabItem snapshots) + Payment + (CASH) SALE movement + Tab CLOSED, all in
  // ONE transaction: either everything commits or nothing does.
  //
  // Idempotency / double-sale protection, in layers:
  //  1. the tab row is locked FOR UPDATE, so concurrent checkouts of the same
  //     tab run one at a time; the loser re-reads the tab as CLOSED;
  //  2. DB constraints, each a hard backstop for exactly one financial record:
  //     orders.tabId UNIQUE (1 tab -> 1 Order), orders(tenantId,
  //     idempotencyKey) UNIQUE (1 key -> 1 sale), payments.orderId UNIQUE
  //     (1 Order -> 1 Payment), cash_movements.orderId UNIQUE (1 Order -> 1 SALE);
  //  3. any request that finds an existing sale (by key, by tab after the
  //     lock, or after a P2002) is classified: same tab + same key returns
  //     the existing result (replay, nothing new written); anything else is
  //     a controlled 409.
  // Lock order is always tab -> cash session (inside createPricedOrderInTx);
  // cash close and PDV sales only ever lock the session, so no lock cycle.
  // =========================================================================
  async checkout(user: AuthenticatedRequestUser, tabId: string, dto: CheckoutTabDto) {
    const tab = await this.findTabForWrite(user, tabId);

    const byKey = await this.findSaleByKey(user.tenantId, dto.idempotencyKey);
    if (byKey) return this.resolveExistingSale(user, byKey, tab.id, dto.idempotencyKey);

    // After the replay check on purpose: repeating a checkout that already happened must keep
    // answering with the sale, even if the customer was deactivated in the meantime.
    const customer = dto.customerId ? await this.customers.resolveForOrder(user, dto.customerId) : null;
    if (dto.cashbackToUseCents && !user.permissions.includes('cashback.use')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Você não tem permissão para usar cashback.' });
    }
    if (dto.paymentMethod === 'ON_ACCOUNT' && !user.permissions.includes('receivables.sell')) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Você não tem permissão para vender fiado.' });
    }

    const auditBase = {
      tenantId: user.tenantId,
      userId: user.userId,
      entity: 'Tab',
      entityId: tab.id,
    };
    await this.audit.record({
      ...auditBase,
      action: 'TAB_CHECKOUT_STARTED',
      afterData: { branchId: tab.branchId, paymentMethod: dto.paymentMethod },
    });

    let result: CheckoutTxResult;
    try {
      result = await this.prisma.$transaction((tx) => this.checkoutInTx(tx, user, tab, dto, customer));
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // A concurrent request won the race on one of the unique constraints
        // (only reachable for the per-tenant key; the tab lock serializes the
        // rest). Everything here was rolled back — resolve against the winner.
        const existing =
          (await this.findSaleByKey(user.tenantId, dto.idempotencyKey)) ??
          (await this.prisma.order.findUnique({
            where: { tabId: tab.id },
            select: { id: true, tabId: true, idempotencyKey: true },
          }));
        if (existing) return this.resolveExistingSale(user, existing, tab.id, dto.idempotencyKey);
      }
      await this.audit.record({
        ...auditBase,
        action: 'TAB_CHECKOUT_FAILED',
        afterData: {
          branchId: tab.branchId,
          paymentMethod: dto.paymentMethod,
          code: error instanceof HttpException ? (error.getResponse() as { code?: string }).code : 'INTERNAL_ERROR',
        },
      });
      throw error;
    }

    if (result.kind === 'existing') {
      return this.resolveExistingSale(user, result.existing, tab.id, dto.idempotencyKey);
    }

    const { order, cashMovementId } = result.created;
    await this.orderCreation.recordCreationAudit(result.created, 'TABLE', user.userId);
    await this.audit.record({
      ...auditBase,
      action: 'TAB_CHECKOUT_COMPLETED',
      beforeData: { status: 'OPEN' },
      afterData: {
        status: 'CLOSED',
        branchId: tab.branchId,
        orderId: order.id,
        orderNumber: order.orderNumber,
        totalCents: order.totalCents,
        paymentMethod: dto.paymentMethod,
        paymentId: result.paymentId,
        cashMovementId,
      },
    });
    return { ...(await this.findOneForTenant(user, tab.id)), idempotentReplay: false };
  }

  private async checkoutInTx(
    tx: Tx,
    user: AuthenticatedRequestUser,
    tab: { id: string; branchId: string; customerName: string | null },
    dto: CheckoutTabDto,
    customer: LinkableCustomer | null,
  ): Promise<CheckoutTxResult> {
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT "status" FROM "tabs" WHERE id = ${tab.id} FOR UPDATE`;
    if (rows.length === 0) throw this.notFound();
    if (rows[0].status !== 'OPEN') {
      // Re-read AFTER the lock: a concurrent checkout of this tab committed.
      const existing = await tx.order.findUnique({
        where: { tabId: tab.id },
        select: { id: true, tabId: true, idempotencyKey: true },
      });
      if (existing) return { kind: 'existing', existing };
      throw new ConflictException({
        code: 'TAB_ALREADY_CLOSED',
        message: 'Esta comanda já está fechada.',
      });
    }

    // B9: only the units still due are billed; cancellations take the tab lock too, so nothing
    // changes what is due while this runs. The kitchen may still be working on some items: that
    // is production, not billing, and it goes on after the bill is paid.
    const items = await tx.tabItem.findMany({ where: { tabId: tab.id }, orderBy: { createdAt: 'asc' } });
    const billed = buildPricedItemsFromTab(items);
    if (billed.length === 0) {
      throw new ConflictException({
        code: 'TAB_EMPTY',
        message: 'Não há nada a cobrar nesta comanda. Se todos os itens foram cancelados, libere a mesa.',
      });
    }

    // Same core as checkout/PDV (no second Order implementation). CASH ->
    // requires the branch's OPEN cash session and writes the SALE in this tx.
    const created = await this.orderCreation.createPricedOrderInTx(tx, {
      tenantId: user.tenantId,
      branchId: tab.branchId,
      source: 'TABLE',
      // The bill is paid now: the sale is born finished. The kitchen works on the tab's ITEMS
      // (B9), never on this Order, which never enters the kitchen/KDS order flow.
      status: 'COMPLETED',
      fulfillmentType: 'DINE_IN',
      paymentMethod: dto.paymentMethod,
      recordCashSaleByUserId: user.userId,
      // Same snapshot rule as the PDV: what was typed on the tab wins; the registry fills
      // the gaps once, and later edits of the customer never rewrite the order.
      customerName: tab.customerName ?? customer?.name ?? null,
      customerPhone: customer?.phone ?? null,
      customerId: customer?.id ?? null,
      cashbackToUseCents: dto.cashbackToUseCents ?? null,
      creditTerms: dto.paymentMethod === 'ON_ACCOUNT' ? (dto.creditTerms ?? null) : null,
      address: null,
      notes: null,
      items: billed,
      tabId: tab.id,
      idempotencyKey: dto.idempotencyKey,
      // B9: every round consumed its recipes when it was sent to the kitchen; the sale consumes
      // nothing more (no second deduction, and no bill refused for stock that ran out since).
      stockHandledByCaller: true,
    });

    // B9 compatibility: items launched before rounds existed (no round) never consumed anything.
    // Their recipes are consumed now, for the units still due, without refusing for lack of stock
    // (the food is already at the table). Each is referenced to its tab item, so it can never be
    // consumed twice. After the customer's accounts, like every stock lock.
    const legacy = items.filter((item) => item.roundId === null && activeUnits(item) > 0);
    const legacyMovements = legacy.length
      ? await this.inventory.consumeForTabRoundInTx(
          tx,
          {
            tenantId: user.tenantId,
            branchId: tab.branchId,
            items: legacy.map((item) => ({ ...item, quantity: activeUnits(item) })),
          },
          user.userId,
          { servedAlready: true },
        )
      : [];

    // A Payment row is money actually received. A bill put on account received nothing: its
    // receivable (opened inside createPricedOrderInTx) is what tracks it from here on.
    const payment =
      dto.paymentMethod === 'ON_ACCOUNT'
        ? null
        : await this.payments.recordInternalConfirmed(tx, {
            tenantId: user.tenantId,
            orderId: created.order.id,
            method: dto.paymentMethod,
            amountCents: created.order.totalCents,
          });

    await tx.tab.update({
      where: { id: tab.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });

    return {
      kind: 'created',
      created: { ...created, stockMovementIds: [...created.stockMovementIds, ...legacyMovements.map((m) => m.id)] },
      paymentId: payment?.id ?? null,
    };
  }

  // B9: a tab with nothing to charge (opened by mistake, or every item cancelled) used to keep its
  // table occupied forever - checkout() refuses an empty bill and there was no other way to close
  // it. This closes it WITHOUT a sale: no Order, no payment, no stock. Refused while any unit is
  // still due. Same tab lock as everything else; the audit entry commits with it.
  async closeEmpty(user: AuthenticatedRequestUser, tabId: string) {
    const tab = await this.findTabForWrite(user, tabId);
    await this.prisma.$transaction(async (tx) => {
      await this.lockTabAndAssertOpen(tx, tab.id, 'TAB_ALREADY_CLOSED');
      const items = await tx.tabItem.findMany({ where: { tabId: tab.id }, select: { quantity: true, cancelledQuantity: true } });
      const due = items.reduce((sum, item) => sum + activeUnits(item), 0);
      if (due > 0) {
        throw new ConflictException({
          code: 'TAB_HAS_ITEMS_TO_CHARGE',
          message: 'Esta comanda ainda tem itens a cobrar: feche a conta ou cancele os itens antes de liberar a mesa.',
        });
      }
      await tx.tab.update({ where: { id: tab.id }, data: { status: 'CLOSED', closedAt: new Date() } });
      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'TAB_CLOSED_EMPTY',
        entity: 'Tab',
        entityId: tab.id,
        beforeData: { status: 'OPEN' },
        afterData: { status: 'CLOSED', tableId: tab.tableId, branchId: tab.branchId, cancelledItemCount: items.length },
      });
    });
    return this.findOneForTenant(user, tab.id);
  }

  private findSaleByKey(tenantId: string, idempotencyKey: string) {
    return this.prisma.order.findUnique({
      where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } },
      select: { id: true, tabId: true, idempotencyKey: true },
    });
  }

  private async resolveExistingSale(
    user: AuthenticatedRequestUser,
    existing: ExistingSale,
    tabId: string,
    idempotencyKey: string,
  ) {
    const outcome = classifyExistingCheckout(existing, { tabId, idempotencyKey });
    if (outcome === 'IDEMPOTENCY_KEY_REUSED') {
      throw new ConflictException({
        code: 'IDEMPOTENCY_KEY_REUSED',
        message: 'Esta chave de idempotência já foi usada em outra venda.',
      });
    }
    if (outcome === 'TAB_ALREADY_CHECKED_OUT') {
      throw new ConflictException({
        code: 'TAB_ALREADY_CLOSED',
        message: 'Esta comanda já foi fechada e paga.',
      });
    }
    return { ...(await this.findOneForTenant(user, tabId)), idempotentReplay: true };
  }

  // ---------------------------------------------------------------------
  async findTabForWrite(user: AuthenticatedRequestUser, tabId: string) {
    const tab = await this.prisma.tab.findFirst({
      where: { id: tabId, tenantId: user.tenantId },
    });
    if (!tab) throw this.notFound();
    await this.branchAccess.assertAccess(user, tab.branchId);
    return tab;
  }

  async lockTabAndAssertOpen(tx: Tx, tabId: string, closedCode: string) {
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT "status" FROM "tabs" WHERE id = ${tabId} FOR UPDATE`;
    if (rows.length === 0) throw this.notFound();
    if (rows[0].status !== 'OPEN') {
      throw new ConflictException({
        code: closedCode,
        message: 'Esta comanda está fechada e não pode ser alterada.',
      });
    }
  }

  private toDto(tab: TabWithDetail) {
    const totals = computeTabTotals(tab.items);
    return {
      id: tab.id,
      tenantId: tab.tenantId,
      branchId: tab.branchId,
      status: tab.status,
      customerName: tab.customerName,
      table: tab.table,
      subtotalCents: totals.subtotalCents,
      totalCents: totals.totalCents,
      itemCount: totals.itemCount,
      items: tab.items.map((item) => ({
        id: item.id,
        productId: item.productId,
        name: item.productNameSnapshot,
        unitPriceCents: item.unitPriceCentsSnapshot,
        quantity: item.quantity,
        // B9: units cancelled so far and units still due; the subtotal charges only the latter.
        cancelledQuantity: item.cancelledQuantity,
        activeQuantity: activeUnits(item),
        subtotalCents: item.unitPriceCentsSnapshot * activeUnits(item),
        notes: item.notes,
        status: item.status,
        // null round = launched before rounds existed (never went to the kitchen).
        roundId: item.roundId,
        roundNumber: item.round?.number ?? null,
        sentAt: item.sentAt,
        preparingAt: item.preparingAt,
        readyAt: item.readyAt,
        servedAt: item.servedAt,
        cancelledAt: item.cancelledAt,
      })),
      openedAt: tab.openedAt,
      closedAt: tab.closedAt,
      // Fatia 10: the sale this tab was checked out into (null while OPEN).
      order: tab.order
        ? {
            id: tab.order.id,
            orderNumber: tab.order.orderNumber,
            status: tab.order.status,
            paymentMethod: tab.order.paymentMethod,
            totalCents: tab.order.totalCents,
            payment: tab.order.payment,
          }
        : null,
    };
  }

  private tableOccupied() {
    return new ConflictException({
      code: 'TABLE_ALREADY_OCCUPIED',
      message: 'Esta mesa já tem uma comanda aberta.',
    });
  }

  private notFound() {
    return new NotFoundException({ code: 'TAB_NOT_FOUND', message: 'Comanda não encontrada.' });
  }

  itemNotFound() {
    return new NotFoundException({ code: 'TAB_ITEM_NOT_FOUND', message: 'Item não encontrado nesta comanda.' });
  }
}
