import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeliveryStatus, Order, OrderItem, OrderStatus, Prisma, StockMovement } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { fromCents } from '../../common/util/money.util';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { isValidOrderStatusTransition } from './order-status.util';
import { deliveryFlowRequired } from '../delivery/delivery-errors';
import { InventoryService } from '../inventory/inventory.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { CustomerLookupService } from '../customers/customer-lookup.service';
import { OrderEffectsService } from '../order-effects/order-effects.service';
import { CashRegisterService } from '../cash/cash-register.service';
import { isConcludedOrderStatus } from '../../common/util/order-conclusion.util';
import { statusConsumesStock } from '../inventory/inventory-calculations';
import { ListOrdersQueryDto, OrdersBoardQueryDto } from './dto/list-orders-query.dto';
import { CANCEL_REASON_MAX, CANCEL_REASON_MIN } from './dto/update-order-status.dto';
import {
  OrderDetailDto,
  OrderListItemDto,
  OrderListResponseDto,
  OrdersBoardResponseDto,
} from './dto/order-admin-response.dto';

type DeliverySummary = { id: string; status: DeliveryStatus; notes: string | null } | null;
type OrderWithItemsAndCount = Order & {
  items: OrderItem[];
  _count: { items: number };
  delivery: DeliverySummary;
};
type OrderWithItems = Order & { items: OrderItem[]; delivery: DeliverySummary };

const deliverySummarySelect = { select: { id: true, status: true, notes: true } } as const;

const DEFAULT_PAGE_SIZE = 20;

// The kitchen board: the statuses an order is in while the kitchen works on it, in the order
// of the flow, and how many orders each column carries at most.
export const ORDER_BOARD_STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'] as const satisfies readonly OrderStatus[];
export const ORDER_BOARD_COLUMN_LIMIT = 50;

// B9: the column of the board each production status of a table round goes to.
const ROUND_COLUMN: Record<'SENT' | 'PREPARING' | 'READY', (typeof ORDER_BOARD_STATUSES)[number]> = {
  SENT: 'PENDING',
  PREPARING: 'PREPARING',
  READY: 'READY',
};
const ROUND_STATUS_ORDER = ['SENT', 'PREPARING', 'READY'] as const;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly inventory: InventoryService,
    private readonly branchAccess: BranchAccessService,
    private readonly customers: CustomerLookupService,
    private readonly effects: OrderEffectsService,
    private readonly cashRegister: CashRegisterService,
  ) {}

  // Every query below is scoped by `tenantId` taken from the caller
  // (the controller passes it from @CurrentUser(), i.e. the JWT) — never
  // from a query param, body field, or route param. See docs/multi-tenancy.md.
  async findAllForUser(user: AuthenticatedRequestUser, query: ListOrdersQueryDto): Promise<OrderListResponseDto> {
    const scope = await this.listScope(user, query.branchId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.OrderWhereInput = {
      ...scope,
      ...(query.status ? { status: query.status } : {}),
    };

    const [total, orders] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { items: true, delivery: deliverySummarySelect, _count: { select: { items: true } } },
      }),
    ]);

    return {
      data: orders.map((o) => this.toListItemDto(o)),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  // The kitchen board in ONE request: the four in-progress statuses, each with its newest
  // orders and its total. The screen used to ask for each status separately, every few
  // seconds; with the per-address request limit that left room for a single kitchen screen per
  // network. Same scope as the list above (tenant from the token, branches the caller may see),
  // same order (newest first) and the same item shape, so nothing changes in what is shown.
  async boardForUser(user: AuthenticatedRequestUser, query: OrdersBoardQueryDto): Promise<OrdersBoardResponseDto> {
    const scope = await this.listScope(user, query.branchId);
    const [rounds, ...results] = await this.prisma.$transaction([
      // B9: the table rounds with anything still in production, in the same request (one poll =
      // one request, whatever the board shows). Same scope as the orders: tenant from the token,
      // branches the caller may see. The tab may already be paid: production goes on.
      this.prisma.tabRound.findMany({
        where: {
          tenantId: scope.tenantId as string,
          ...(scope.branchId ? { branchId: scope.branchId as Prisma.StringFilter | string } : {}),
          items: { some: { status: { in: [...ROUND_STATUS_ORDER] } } },
        },
        orderBy: { sentAt: 'desc' },
        take: ORDER_BOARD_COLUMN_LIMIT * ROUND_STATUS_ORDER.length,
        include: {
          tab: { select: { table: { select: { number: true, name: true } } } },
          items: { where: { status: { in: [...ROUND_STATUS_ORDER] } }, orderBy: { createdAt: 'asc' } },
        },
      }),
      ...ORDER_BOARD_STATUSES.flatMap((status) => [
        this.prisma.order.count({ where: { ...scope, status } }),
        this.prisma.order.findMany({
          where: { ...scope, status },
          orderBy: { createdAt: 'desc' },
          take: ORDER_BOARD_COLUMN_LIMIT,
          include: { items: true, delivery: deliverySummarySelect, _count: { select: { items: true } } },
        }),
      ]),
    ]);
    const roundCards = rounds.map((round) => {
      const status = ROUND_STATUS_ORDER.find((s) => round.items.some((item) => item.status === s))!;
      return {
        id: round.id,
        tabId: round.tabId,
        roundNumber: round.number,
        tableNumber: round.tab.table.number,
        tableName: round.tab.table.name,
        sentAt: round.sentAt,
        status,
        items: round.items.map((item) => ({
          id: item.id,
          name: item.productNameSnapshot,
          quantity: item.quantity - item.cancelledQuantity,
          notes: item.notes,
          status: item.status,
        })),
      };
    });
    return {
      columnLimit: ORDER_BOARD_COLUMN_LIMIT,
      columns: ORDER_BOARD_STATUSES.map((status, index) => {
        const inColumn = roundCards.filter((card) => ROUND_COLUMN[card.status as keyof typeof ROUND_COLUMN] === status);
        return {
          status,
          total: results[index * 2] as number,
          data: (results[index * 2 + 1] as OrderWithItemsAndCount[]).map((o) => this.toListItemDto(o)),
          tableRounds: inColumn.slice(0, ORDER_BOARD_COLUMN_LIMIT),
          tableRoundsTotal: inColumn.length,
        };
      }),
    };
  }

  // Which orders a listing may show: always the caller's tenant (from the JWT), narrowed to the
  // branch asked for, or to the branches the caller is linked to. Shared by the list and the
  // board so the two can never disagree about who sees what.
  private async listScope(user: AuthenticatedRequestUser, branchId?: string): Promise<Prisma.OrderWhereInput> {
    const tenantId = user.tenantId;
    const allowedBranchIds = await this.branchAccess.accessibleBranchIds(user);
    if (branchId && allowedBranchIds && !allowedBranchIds.includes(branchId)) {
      throw new ForbiddenException({
        code: 'BRANCH_ACCESS_DENIED',
        message: 'Você não tem acesso a esta unidade.',
      });
    }
    // OWNER/ADMIN have no branch list to be checked against, so the branch itself is checked:
    // one that is not of this tenant is "not found", like in every other module, instead of an
    // empty page. (Any status: the history of a deactivated branch stays readable.)
    if (branchId && !allowedBranchIds) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchId, tenantId },
        select: { id: true },
      });
      if (!branch) {
        throw new NotFoundException({ code: 'BRANCH_NOT_FOUND', message: 'Unidade não encontrada.' });
      }
    }
    return {
      tenantId,
      ...(branchId ? { branchId } : allowedBranchIds ? { branchId: { in: allowedBranchIds } } : {}),
    };
  }

  async findOneForUser(user: AuthenticatedRequestUser, id: string): Promise<OrderDetailDto> {
    const detail = await this.findOneForTenant(user.tenantId, id);
    const allowedBranchIds = await this.branchAccess.accessibleBranchIds(user);
    if (allowedBranchIds && !allowedBranchIds.includes(detail.branchId)) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pedido não encontrado.' });
    }
    return detail;
  }

  async findOneForTenant(tenantId: string, id: string): Promise<OrderDetailDto> {
    const order = await this.prisma.order.findFirst({
      where: { id, tenantId },
      include: { items: true, delivery: deliverySummarySelect },
    });
    if (!order) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pedido não encontrado.' });
    }
    return this.toDetailDto(order);
  }

  async updateStatus(
    tenantId: string,
    id: string,
    newStatus: OrderStatus,
    actor: AuthenticatedRequestUser,
    reason?: string,
  ): Promise<OrderDetailDto> {
    // `orders.update` (checked by the controller's guard) is the baseline
    // gate for this whole endpoint. Cancelling is treated as a stricter
    // sub-action requiring `orders.cancel` too — a MANAGER without it could
    // otherwise cancel orders just by having generic update rights.
    if (newStatus === 'CANCELLED' && !actor.permissions.includes('orders.cancel')) {
      throw new ForbiddenException({
        code: 'FORBIDDEN',
        message: 'Você não tem permissão para cancelar pedidos.',
      });
    }
    // B5: the DTO already demands it on the HTTP route; checked here too so no other caller can
    // cancel without saying why.
    const cancelReason = reason?.trim() ?? '';
    if (newStatus === 'CANCELLED' && cancelReason.length < CANCEL_REASON_MIN) {
      throw new BadRequestException({
        code: 'CANCEL_REASON_REQUIRED',
        message: `Informe o motivo do cancelamento (de ${CANCEL_REASON_MIN} a ${CANCEL_REASON_MAX} caracteres).`,
      });
    }

    // Fase 09: the status change and its stock effect are ONE transaction.
    // The order row is locked first (FOR UPDATE) and its status re-read
    // after the lock, so two concurrent "confirm" clicks serialize: the
    // second sees CONFIRMED, fails the transition check, and never consumes
    // stock a second time. If consumption fails (INSUFFICIENT_STOCK) the
    // status change rolls back with it — never CONFIRMED without the stock
    // movement, never a stock movement without CONFIRMED.
    const allowedBranchIds = await this.branchAccess.accessibleBranchIds(actor);
    let result: { before: OrderStatus; movements: StockMovement[] };
    try {
      result = await this.prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          { status: OrderStatus; branchId: string; fulfillmentType: string; orderNumber: string; paymentMethod: string; totalCents: number }[]
        >`
          SELECT "status", "branchId", "fulfillmentType", "orderNumber", "paymentMethod", "totalCents"
          FROM "orders" WHERE "id" = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
        if (rows.length === 0 || (allowedBranchIds && !allowedBranchIds.includes(rows[0].branchId))) {
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pedido não encontrado.' });
        }
        const before = rows[0].status;
        const isDelivery = rows[0].fulfillmentType === 'DELIVERY';
        // Cancelling a sale that was paid in cash gives the money back from the drawer, so the
        // cash session comes next in the lock order (ORDER -> CASH SESSION -> ..., the order the
        // sale itself used). Only asked for when this request can actually cancel the order: a
        // transition that will be refused below must fail for its own reason, not for a closed
        // drawer. No open session in the branch = no cancellation (CASH_REGISTER_NOT_OPEN).
        const mayCancel =
          newStatus === 'CANCELLED' && (isValidOrderStatusTransition(before, 'CANCELLED') || (before === 'READY' && isDelivery));
        const cashRefund = mayCancel
          ? await this.cashRegister.lockSessionForSaleRefund(tx, { tenantId, branchId: rows[0].branchId, orderId: id })
          : null;
        // B3: concluding an order paid in cash that has not entered the drawer yet (online, paid on
        // pickup) is when the money is received: same place in the lock order, same rule (no open
        // session, no conclusion). Only when this request can really conclude it. A DELIVERY order
        // is concluded by DeliveryService (DELIVERED), which does the same.
        const mayComplete = newStatus === 'COMPLETED' && !isDelivery && isValidOrderStatusTransition(before, 'COMPLETED');
        const cashSaleSessionId = mayComplete
          ? await this.cashRegister.lockSessionForCashOnConclusion(tx, {
              tenantId,
              branchId: rows[0].branchId,
              orderId: id,
              paymentMethod: rows[0].paymentMethod,
              totalCents: rows[0].totalCents,
            })
          : null;
        // Then DELIVERY — the same order DeliveryService uses (it never touches the cash session).
        const deliveryStatus = isDelivery ? await this.lockDeliveryStatus(tx, tenantId, id) : null;
        // The one exception to the order flow: after a FAILED delivery the order (READY)
        // may be cancelled, as an explicit decision (orders.cancel). Anything else keeps
        // the regular rules, and a failure alone never cancels an order.
        const cancelAfterFailedDelivery = before === 'READY' && newStatus === 'CANCELLED' && deliveryStatus === 'FAILED';
        if (!cancelAfterFailedDelivery && !isValidOrderStatusTransition(before, newStatus)) {
          throw new ConflictException({
            code: 'INVALID_STATUS_TRANSITION',
            message: `Não é possível mudar o pedido de "${before}" para "${newStatus}".`,
          });
        }

        // Fase 10: a DELIVERY order is finished by the delivery flow (dispatch ->
        // delivered), never by the generic status endpoint.
        if (isDelivery && newStatus === 'COMPLETED') throw deliveryFlowRequired();

        await tx.order.update({ where: { id }, data: { status: newStatus } });
        // Benefits of a concluded sale (loyalty points...) are credited in this same transaction:
        // concluded and credited commit together, or neither does.
        if (isConcludedOrderStatus(newStatus)) {
          await this.effects.onOrderConcludedInTx(tx, { tenantId, orderId: id, actorUserId: actor.userId });
        }
        // ...and what a cancelled sale took from the customer (cashback spent on it) goes back,
        // also in this transaction: cancelled and refunded commit together.
        if (newStatus === 'CANCELLED') {
          await this.effects.onOrderCancelledInTx(tx, { tenantId, orderId: id, actorUserId: actor.userId });
          // B5: who cancelled, which order, when (createdAt) and why, in the same transaction:
          // the cancellation and its record commit together, or neither does.
          await this.audit.recordTx(tx, {
            tenantId,
            userId: actor.userId,
            action: 'ORDER_CANCELLED',
            entity: 'Order',
            entityId: id,
            beforeData: { status: before },
            afterData: { status: 'CANCELLED', orderNumber: rows[0].orderNumber, reason: cancelReason },
          });
        }
        // B3: ...and the cash received for it enters the drawer, linked to the order (CashMovement.orderId).
        if (cashSaleSessionId) {
          const sale = await this.cashRegister.recordSale(tx, {
            sessionId: cashSaleSessionId,
            tenantId,
            orderId: id,
            amountCents: rows[0].totalCents,
            userId: actor.userId,
          });
          await this.audit.recordTx(tx, {
            tenantId,
            userId: actor.userId,
            action: 'CASH_MOVEMENT_CREATED',
            entity: 'CashMovement',
            entityId: sale.id,
            afterData: { type: 'SALE', orderId: id, sessionId: cashSaleSessionId, amountCents: rows[0].totalCents, reason: 'ORDER_COMPLETED' },
          });
        }
        // ...and so does the cash it put in the drawer. The movement and its audit entry are part
        // of the cancellation: cancelled and refunded commit together, or neither does.
        if (cashRefund) {
          const refund = await this.cashRegister.recordSaleRefund(tx, {
            sessionId: cashRefund.sessionId,
            tenantId,
            orderId: id,
            orderNumber: rows[0].orderNumber,
            amountCents: cashRefund.amountCents,
            userId: actor.userId,
          });
          await this.audit.recordTx(tx, {
            tenantId,
            userId: actor.userId,
            action: 'CASH_SALE_REFUNDED',
            entity: 'CashMovement',
            entityId: refund.id,
            afterData: { orderId: id, sessionId: cashRefund.sessionId, type: 'SALE_REFUND', amountCents: cashRefund.amountCents },
          });
        }
        // Cancelling the order cancels its delivery in the same transaction: PENDING for
        // PENDING..PREPARING orders, FAILED for the explicit cancel after a failed delivery.
        if (isDelivery && newStatus === 'CANCELLED') {
          const cancelled = await tx.delivery.updateMany({
            where: { orderId: id, tenantId, status: { in: ['PENDING', 'FAILED'] } },
            data: { status: 'CANCELLED', cancelledAt: new Date() },
          });
          if (cancelled.count > 0) {
            await this.audit.recordTx(tx, {
              tenantId,
              userId: actor.userId,
              action: 'DELIVERY_CANCELLED',
              entity: 'Order',
              entityId: id,
              beforeData: { deliveryStatus },
              afterData: { deliveryStatus: 'CANCELLED', reason: 'ORDER_CANCELLED' },
            });
          }
        }

        const order = { id, tenantId, branchId: rows[0].branchId };
        let movements: StockMovement[] = [];
        if (!statusConsumesStock(before) && statusConsumesStock(newStatus)) {
          const items = await tx.orderItem.findMany({
            where: { orderId: id },
            select: { productId: true, quantity: true },
          });
          movements = await this.inventory.consumeForOrderInTx(tx, { ...order, items }, actor.userId);
        } else if (newStatus === 'CANCELLED') {
          movements = await this.inventory.reverseForOrderInTx(tx, order, actor.userId);
        }
        return { before, movements };
      });
    } catch (error) {
      // Backstop for the (order, item, type) unique key — unreachable while
      // the row lock above holds, but never let it surface as a 500.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'ORDER_ALREADY_PROCESSED',
          message: 'Este pedido já foi processado por outra requisição.',
        });
      }
      throw error;
    }

    await this.audit.record({
      tenantId,
      userId: actor.userId,
      action: 'ORDER_STATUS_CHANGED',
      entity: 'Order',
      entityId: id,
      beforeData: { status: result.before },
      afterData: { status: newStatus },
    });
    if (result.movements.length > 0) {
      await this.audit.record({
        tenantId,
        userId: actor.userId,
        action: 'INVENTORY_MOVEMENT_CREATED',
        entity: 'Order',
        entityId: id,
        afterData: {
          reason: newStatus === 'CANCELLED' ? 'ORDER_CANCELLED' : 'ORDER_CONFIRMED',
          movements: result.movements.map((m) => ({
            id: m.id,
            type: m.type,
            inventoryItemId: m.inventoryItemId,
            quantity: m.quantity.toFixed(3),
          })),
        },
      });
    }

    return this.findOneForTenant(tenantId, id);
  }

  // ---- customer link (Fase 11, CRM avançado) ---------------------------------------------

  // Attaches an existing order to a customer of the registry, or removes the link (null). This
  // is how an online or delivery order - which the public checkout never attributes to anyone -
  // becomes part of a customer's history: a staff member confirms who it belongs to.
  //  - needs orders.update (controller) AND customers.read (checked by the lookup);
  //  - the order must be of the caller's tenant and of a branch they can see (else 404);
  //  - the customer must be of the same tenant and active;
  //  - the order row is locked, so two simultaneous links cannot interleave, and the audit
  //    entry is written in the same transaction (the trail records ids only, never names);
  //  - the order's own customerName/customerPhone snapshot is never rewritten;
  //  - a coupon redemption keeps the customer it was recorded with (the per-customer limit is
  //    about who redeemed, not about who the order was later filed under);
  //  - an order that already credited points to its customer cannot change customer until
  //    those points are reversed; linking a customer to an already concluded order credits
  //    its points then (once).
  // Repeating the same link changes nothing and writes no audit.
  async setCustomer(user: AuthenticatedRequestUser, id: string, customerId: string | null): Promise<OrderDetailDto> {
    const tenantId = user.tenantId;
    const customer = customerId ? await this.customers.resolveForOrder(user, customerId) : null;
    if (!customer) this.customers.assertCanLink(user);
    const allowedBranchIds = await this.branchAccess.accessibleBranchIds(user);

    await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ customerId: string | null; branchId: string; status: OrderStatus }[]>`
        SELECT "customerId", "branchId", "status" FROM "orders" WHERE "id" = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
      if (rows.length === 0 || (allowedBranchIds && !allowedBranchIds.includes(rows[0].branchId))) {
        throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pedido não encontrado.' });
      }
      const before = rows[0].customerId;
      const next = customer?.id ?? null;
      if (before === next) return;

      // Points (and other benefits) already credited for this order stay with the customer
      // they were credited to: the change is refused until they are reversed.
      await this.effects.assertCustomerCanChangeInTx(tx, id);

      await tx.order.update({ where: { id }, data: { customerId: next } });
      await this.audit.recordTx(tx, {
        tenantId,
        userId: user.userId,
        action: next ? 'ORDER_CUSTOMER_LINKED' : 'ORDER_CUSTOMER_UNLINKED',
        entity: 'Order',
        entityId: id,
        beforeData: { customerId: before },
        afterData: { customerId: next },
      });
      // A sale that was already concluded when its customer became known earns now.
      if (next && isConcludedOrderStatus(rows[0].status)) {
        await this.effects.onOrderConcludedInTx(tx, { tenantId, orderId: id, actorUserId: user.userId });
      }
    });

    return this.findOneForTenant(tenantId, id);
  }

  // Customers whose registered phone is the one typed on this order: a hint for the screen,
  // never an automatic attribution.
  async customerSuggestions(user: AuthenticatedRequestUser, id: string) {
    this.customers.assertCanLink(user);
    const order = await this.findOneForUser(user, id);
    return { data: await this.customers.suggestByPhone(user, order.customerPhone) };
  }

  private async lockDeliveryStatus(tx: Prisma.TransactionClient, tenantId: string, orderId: string) {
    const rows = await tx.$queryRaw<{ status: DeliveryStatus }[]>`
      SELECT "status" FROM "deliveries" WHERE "orderId" = ${orderId} AND "tenantId" = ${tenantId} FOR UPDATE`;
    return rows[0]?.status ?? null;
  }

  private toListItemDto(order: OrderWithItemsAndCount): OrderListItemDto {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      source: order.source,
      branchId: order.branchId,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerId: order.customerId,
      fulfillmentType: order.fulfillmentType,
      paymentMethod: order.paymentMethod,
      notes: order.notes,
      subtotal: fromCents(order.subtotalCents),
      discount: fromCents(order.discountCents),
      couponCode: order.couponCode,
      cashbackUsed: fromCents(order.cashbackUsedCents),
      deliveryFee: fromCents(order.deliveryFeeCents),
      total: fromCents(order.totalCents),
      delivery: order.delivery,
      itemCount: order._count.items,
      items: order.items.map((item) => this.toItemDto(item)),
      createdAt: order.createdAt,
    };
  }

  private toDetailDto(order: OrderWithItems): OrderDetailDto {
    return {
      id: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      source: order.source,
      branchId: order.branchId,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerId: order.customerId,
      fulfillmentType: order.fulfillmentType,
      address:
        order.fulfillmentType === 'DELIVERY'
          ? {
              street: order.street ?? '',
              number: order.number ?? '',
              complement: order.complement,
              neighborhood: order.neighborhood ?? '',
              city: order.city ?? '',
              state: order.state ?? '',
              zipCode: order.zipCode ?? '',
            }
          : null,
      paymentMethod: order.paymentMethod,
      notes: order.notes,
      items: order.items.map((item) => this.toItemDto(item)),
      subtotal: fromCents(order.subtotalCents),
      discount: fromCents(order.discountCents),
      couponCode: order.couponCode,
      cashbackUsed: fromCents(order.cashbackUsedCents),
      deliveryFee: fromCents(order.deliveryFeeCents),
      total: fromCents(order.totalCents),
      delivery: order.delivery,
      createdAt: order.createdAt,
    };
  }

  // Shared by both toListItemDto and toDetailDto (fatia 06 added items to
  // the list response too) — one place that turns an OrderItem row into the
  // public-shaped item, always from the historical snapshot fields, never
  // re-reading Product.
  private toItemDto(item: OrderItem) {
    return {
      productId: item.productId,
      name: item.productNameSnapshot,
      unitPrice: fromCents(item.unitPriceCents),
      quantity: item.quantity,
      subtotal: fromCents(item.subtotalCents),
    };
  }
}
