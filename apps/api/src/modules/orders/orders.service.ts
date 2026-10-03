import {
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
import { statusConsumesStock } from '../inventory/inventory-calculations';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { OrderDetailDto, OrderListItemDto, OrderListResponseDto } from './dto/order-admin-response.dto';

type DeliverySummary = { id: string; status: DeliveryStatus; notes: string | null } | null;
type OrderWithItemsAndCount = Order & {
  items: OrderItem[];
  _count: { items: number };
  delivery: DeliverySummary;
};
type OrderWithItems = Order & { items: OrderItem[]; delivery: DeliverySummary };

const deliverySummarySelect = { select: { id: true, status: true, notes: true } } as const;

const DEFAULT_PAGE_SIZE = 20;

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly inventory: InventoryService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  // Every query below is scoped by `tenantId` taken from the caller
  // (the controller passes it from @CurrentUser(), i.e. the JWT) — never
  // from a query param, body field, or route param. See docs/multi-tenancy.md.
  async findAllForUser(user: AuthenticatedRequestUser, query: ListOrdersQueryDto): Promise<OrderListResponseDto> {
    const tenantId = user.tenantId;
    const allowedBranchIds = await this.branchAccess.accessibleBranchIds(user);
    if (query.branchId && allowedBranchIds && !allowedBranchIds.includes(query.branchId)) {
      throw new ForbiddenException({
        code: 'BRANCH_ACCESS_DENIED',
        message: 'Você não tem acesso a esta unidade.',
      });
    }
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.OrderWhereInput = {
      tenantId,
      ...(query.status ? { status: query.status } : {}),
      ...(query.branchId
        ? { branchId: query.branchId }
        : allowedBranchIds
          ? { branchId: { in: allowedBranchIds } }
          : {}),
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
        const rows = await tx.$queryRaw<{ status: OrderStatus; branchId: string; fulfillmentType: string }[]>`
          SELECT "status", "branchId", "fulfillmentType" FROM "orders" WHERE "id" = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
        if (rows.length === 0 || (allowedBranchIds && !allowedBranchIds.includes(rows[0].branchId))) {
          throw new NotFoundException({ code: 'NOT_FOUND', message: 'Pedido não encontrado.' });
        }
        const before = rows[0].status;
        const isDelivery = rows[0].fulfillmentType === 'DELIVERY';
        // Lock order: ORDER (above), then DELIVERY — the same order DeliveryService uses.
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
      fulfillmentType: order.fulfillmentType,
      paymentMethod: order.paymentMethod,
      notes: order.notes,
      subtotal: fromCents(order.subtotalCents),
      discount: fromCents(order.discountCents),
      couponCode: order.couponCode,
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
