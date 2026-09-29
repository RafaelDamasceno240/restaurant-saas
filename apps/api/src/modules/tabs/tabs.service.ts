import {
  BadRequestException,
  ConflictException,
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
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { computeTabTotals } from './tab-calculations';
import { buildPricedItemsFromTab, classifyExistingCheckout } from './tab-checkout';
import { CreateTabDto } from './dto/create-tab.dto';
import { AddTabItemDto } from './dto/add-tab-item.dto';
import { UpdateTabItemDto } from './dto/update-tab-item.dto';
import { ListTabsQueryDto } from './dto/list-tabs-query.dto';
import { CheckoutTabDto } from './dto/checkout-tab.dto';

type Tx = Prisma.TransactionClient;

const tabDetailInclude = {
  table: { select: { id: true, number: true, name: true } },
  items: { orderBy: { createdAt: 'asc' as const } },
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
  | { kind: 'created'; created: OrderCreationResult; paymentId: string }
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
//  - every item mutation (add/update/remove) and checkout() lock the TAB row
//    FOR UPDATE and re-check status inside the transaction, so an item can
//    never land on a tab that's being checked out, and a tab can never be
//    sold twice;
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

  async addItem(user: AuthenticatedRequestUser, tabId: string, dto: AddTabItemDto) {
    const tab = await this.findTabForWrite(user, tabId);

    // Re-read from the DB, scoped to THIS tenant and active=true — same
    // guarantee as OrderCreationService. "Doesn't exist", "another tenant's
    // product", and "inactive" all collapse into the same 400, so the
    // caller never learns which (no cross-tenant existence leak). Product is
    // NOT branch-scoped in this schema (tenant-wide catalog, same as
    // PDV/checkout), so there is no separate branch check to make here.
    const product = await this.prisma.product.findFirst({
      where: { id: dto.productId, tenantId: user.tenantId, active: true },
    });
    if (!product) {
      throw new BadRequestException({
        code: 'PRODUCT_UNAVAILABLE',
        message: 'Produto não encontrado ou não está mais disponível.',
      });
    }

    const item = await this.prisma.$transaction(async (tx) => {
      await this.lockTabAndAssertOpen(tx, tab.id, 'TAB_CLOSED');
      return tx.tabItem.create({
        data: {
          tenantId: user.tenantId,
          tabId: tab.id,
          productId: product.id,
          productNameSnapshot: product.name,
          unitPriceCentsSnapshot: product.priceCents,
          quantity: dto.quantity,
          notes: dto.notes?.trim() || null,
        },
        select: { id: true },
      });
    });

    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'TAB_ITEM_ADDED',
      entity: 'TabItem',
      entityId: item.id,
      afterData: { tabId: tab.id, productId: product.id, quantity: dto.quantity },
    });
    return this.findOneForTenant(user, tab.id);
  }

  async updateItem(
    user: AuthenticatedRequestUser,
    tabId: string,
    itemId: string,
    dto: UpdateTabItemDto,
  ) {
    const tab = await this.findTabForWrite(user, tabId);
    const item = await this.prisma.tabItem.findFirst({ where: { id: itemId, tabId: tab.id } });
    if (!item) throw this.itemNotFound();

    await this.prisma.$transaction(async (tx) => {
      await this.lockTabAndAssertOpen(tx, tab.id, 'TAB_CLOSED');
      await tx.tabItem.update({
        where: { id: item.id },
        data: {
          ...(dto.quantity !== undefined ? { quantity: dto.quantity } : {}),
          ...(dto.notes !== undefined ? { notes: dto.notes.trim() || null } : {}),
        },
      });
    });

    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'TAB_ITEM_UPDATED',
      entity: 'TabItem',
      entityId: item.id,
      beforeData: { quantity: item.quantity, notes: item.notes },
      afterData: { quantity: dto.quantity ?? item.quantity, notes: dto.notes ?? item.notes },
    });
    return this.findOneForTenant(user, tab.id);
  }

  async removeItem(user: AuthenticatedRequestUser, tabId: string, itemId: string) {
    const tab = await this.findTabForWrite(user, tabId);
    const item = await this.prisma.tabItem.findFirst({ where: { id: itemId, tabId: tab.id } });
    if (!item) throw this.itemNotFound();

    await this.prisma.$transaction(async (tx) => {
      await this.lockTabAndAssertOpen(tx, tab.id, 'TAB_CLOSED');
      await tx.tabItem.delete({ where: { id: item.id } });
    });

    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'TAB_ITEM_REMOVED',
      entity: 'TabItem',
      entityId: item.id,
      beforeData: { tabId: tab.id, productId: item.productId, quantity: item.quantity },
    });
    return this.findOneForTenant(user, tab.id);
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
      result = await this.prisma.$transaction((tx) => this.checkoutInTx(tx, user, tab, dto));
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

    const items = await tx.tabItem.findMany({ where: { tabId: tab.id }, orderBy: { createdAt: 'asc' } });
    if (items.length === 0) {
      throw new ConflictException({
        code: 'TAB_EMPTY',
        message: 'Não é possível fechar uma comanda sem itens.',
      });
    }

    // Same core as checkout/PDV (no second Order implementation). CASH ->
    // requires the branch's OPEN cash session and writes the SALE in this tx.
    const created = await this.orderCreation.createPricedOrderInTx(tx, {
      tenantId: user.tenantId,
      branchId: tab.branchId,
      source: 'TABLE',
      // The food was already served at the table and the bill is paid now:
      // the sale is born finished. It never enters the kitchen/KDS flow.
      status: 'COMPLETED',
      fulfillmentType: 'DINE_IN',
      paymentMethod: dto.paymentMethod,
      recordCashSaleByUserId: user.userId,
      customerName: tab.customerName,
      customerPhone: null,
      address: null,
      notes: null,
      items: buildPricedItemsFromTab(items),
      tabId: tab.id,
      idempotencyKey: dto.idempotencyKey,
    });

    const payment = await this.payments.recordInternalConfirmed(tx, {
      tenantId: user.tenantId,
      orderId: created.order.id,
      method: dto.paymentMethod,
      amountCents: created.order.totalCents,
    });

    await tx.tab.update({
      where: { id: tab.id },
      data: { status: 'CLOSED', closedAt: new Date() },
    });

    return { kind: 'created', created, paymentId: payment.id };
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
  private async findTabForWrite(user: AuthenticatedRequestUser, tabId: string) {
    const tab = await this.prisma.tab.findFirst({
      where: { id: tabId, tenantId: user.tenantId },
    });
    if (!tab) throw this.notFound();
    await this.branchAccess.assertAccess(user, tab.branchId);
    return tab;
  }

  private async lockTabAndAssertOpen(tx: Tx, tabId: string, closedCode: string) {
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
        subtotalCents: item.unitPriceCentsSnapshot * item.quantity,
        notes: item.notes,
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

  private itemNotFound() {
    return new NotFoundException({ code: 'TAB_ITEM_NOT_FOUND', message: 'Item não encontrado nesta comanda.' });
  }
}
