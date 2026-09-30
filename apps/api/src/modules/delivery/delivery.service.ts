import { Injectable } from '@nestjs/common';
import { DeliveryStatus, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { Tx } from '../inventory/stock-ledger.service';
import {
  deliveryNotFound,
  deliveryStateInconsistent,
  invalidDeliveryTransition,
  orderNotReadyForDispatch,
} from './delivery-errors';
import { isValidDeliveryTransition } from './delivery-status.util';
import { DeliverySettingsQueryDto, ListDeliveriesQueryDto, UpdateDeliverySettingsDto } from './dto/delivery.dto';

const TRANSACTION_OPTIONS = { timeout: 20_000, maxWait: 10_000 };
const DEFAULT_PAGE_SIZE = 20;

const listInclude = {
  order: {
    select: {
      orderNumber: true,
      status: true,
      customerName: true,
      customerPhone: true,
      paymentMethod: true,
      notes: true,
      street: true,
      number: true,
      complement: true,
      neighborhood: true,
      city: true,
      state: true,
      zipCode: true,
      subtotalCents: true,
      deliveryFeeCents: true,
      totalCents: true,
      createdAt: true,
      _count: { select: { items: true } },
    },
  },
} satisfies Prisma.DeliveryInclude;

type DeliveryRow = Prisma.DeliveryGetPayload<{ include: typeof listInclude }>;

interface LockedOrder {
  status: OrderStatus;
  orderNumber: string;
}

type Step = 'dispatch' | 'complete';

const STEP: Record<Step, { from: DeliveryStatus; to: DeliveryStatus; orderFrom: OrderStatus; orderTo: OrderStatus }> = {
  dispatch: { from: 'PENDING', to: 'OUT_FOR_DELIVERY', orderFrom: 'READY', orderTo: 'OUT_FOR_DELIVERY' },
  complete: { from: 'OUT_FOR_DELIVERY', to: 'DELIVERED', orderFrom: 'OUT_FOR_DELIVERY', orderTo: 'DELIVERED' },
};

const EMPTY_SUMMARY = (): Record<DeliveryStatus, number> => ({
  PENDING: 0,
  OUT_FOR_DELIVERY: 0,
  DELIVERED: 0,
  CANCELLED: 0,
});

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  async list(user: AuthenticatedRequestUser, query: ListDeliveriesQueryDto) {
    await this.branchAccess.assertAccess(user, query.branchId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.DeliveryWhereInput = {
      tenantId: user.tenantId,
      branchId: query.branchId,
      ...(query.status ? { status: query.status } : {}),
    };
    // Active work first-in-first-out; history newest first.
    const active = query.status === 'PENDING' || query.status === 'OUT_FOR_DELIVERY';

    const [total, rows, grouped] = await this.prisma.$transaction([
      this.prisma.delivery.count({ where }),
      this.prisma.delivery.findMany({
        where,
        orderBy: [{ createdAt: active ? 'asc' : 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: listInclude,
      }),
      this.prisma.delivery.groupBy({
        by: ['status'],
        where: { tenantId: user.tenantId, branchId: query.branchId },
        orderBy: { status: 'asc' },
        _count: { _all: true },
      }),
    ]);

    const summary = EMPTY_SUMMARY();
    for (const group of grouped) {
      const counted = typeof group._count === 'object' ? group._count : null;
      summary[group.status] = counted?._all ?? 0;
    }
    return {
      data: rows.map((row) => this.toView(row)),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      summary,
    };
  }

  dispatch(user: AuthenticatedRequestUser, id: string) {
    return this.transition(user, id, 'dispatch');
  }

  complete(user: AuthenticatedRequestUser, id: string) {
    return this.transition(user, id, 'complete');
  }

  async getSettings(user: AuthenticatedRequestUser, query: DeliverySettingsQueryDto) {
    await this.branchAccess.assertAccess(user, query.branchId);
    const branch = await this.prisma.branch.findFirstOrThrow({
      where: { id: query.branchId, tenantId: user.tenantId },
      select: { id: true, deliveryEnabled: true, deliveryFeeCents: true, deliveryMinOrderCents: true },
    });
    return this.toSettings(branch);
  }

  async updateSettings(user: AuthenticatedRequestUser, dto: UpdateDeliverySettingsDto) {
    await this.branchAccess.assertAccess(user, dto.branchId);
    const branch = await this.prisma.$transaction(async (tx) => {
      const before = await tx.branch.findFirstOrThrow({
        where: { id: dto.branchId, tenantId: user.tenantId },
        select: { deliveryEnabled: true, deliveryFeeCents: true, deliveryMinOrderCents: true },
      });
      const updated = await tx.branch.update({
        where: { id: dto.branchId },
        data: {
          deliveryEnabled: dto.enabled,
          deliveryFeeCents: dto.feeCents,
          deliveryMinOrderCents: dto.minOrderCents,
        },
        select: { id: true, deliveryEnabled: true, deliveryFeeCents: true, deliveryMinOrderCents: true },
      });
      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'DELIVERY_SETTINGS_UPDATED',
        entity: 'Branch',
        entityId: dto.branchId,
        beforeData: {
          enabled: before.deliveryEnabled,
          feeCents: before.deliveryFeeCents,
          minOrderCents: before.deliveryMinOrderCents,
        },
        afterData: { enabled: dto.enabled, feeCents: dto.feeCents, minOrderCents: dto.minOrderCents },
      });
      return updated;
    }, TRANSACTION_OPTIONS);
    return this.toSettings(branch);
  }

  // Dispatch / complete: the delivery row and its order move together, in ONE
  // transaction. Lock order is always ORDER first, then DELIVERY (the same order
  // OrdersService uses when it cancels), so the two can never deadlock. The state
  // is re-read AFTER the locks: a duplicate or concurrent request finds the target
  // state already reached and answers as a replay (200, idempotentReplay=true,
  // nothing written); an impossible transition is a 409.
  private async transition(user: AuthenticatedRequestUser, id: string, step: Step) {
    const scoped = await this.loadScoped(user, id);
    const rule = STEP[step];

    const replay = await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, user.tenantId, scoped.orderId);
      const current = await this.lockDeliveryStatus(tx, user.tenantId, id);

      if (current === rule.to) return true;
      if (!isValidDeliveryTransition(current, rule.to)) throw invalidDeliveryTransition(current, rule.to);
      if (order.status !== rule.orderFrom) {
        if (step === 'dispatch') throw orderNotReadyForDispatch();
        throw deliveryStateInconsistent();
      }

      const now = new Date();
      await tx.delivery.update({
        where: { id },
        data:
          step === 'dispatch'
            ? { status: rule.to, dispatchedAt: now, dispatchedByUserId: user.userId }
            : { status: rule.to, deliveredAt: now, completedByUserId: user.userId },
      });
      await tx.order.update({ where: { id: scoped.orderId }, data: { status: rule.orderTo } });

      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: step === 'dispatch' ? 'DELIVERY_DISPATCHED' : 'DELIVERY_COMPLETED',
        entity: 'Delivery',
        entityId: id,
        beforeData: { status: current },
        afterData: { status: rule.to, orderId: scoped.orderId, orderNumber: order.orderNumber },
      });
      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'ORDER_STATUS_CHANGED',
        entity: 'Order',
        entityId: scoped.orderId,
        beforeData: { status: rule.orderFrom },
        afterData: { status: rule.orderTo, via: 'DELIVERY' },
      });
      return false;
    }, TRANSACTION_OPTIONS);

    const fresh = await this.prisma.delivery.findFirstOrThrow({
      where: { id, tenantId: user.tenantId },
      include: listInclude,
    });
    return { ...this.toView(fresh), idempotentReplay: replay };
  }

  private async lockOrder(tx: Tx, tenantId: string, orderId: string): Promise<LockedOrder> {
    const rows = await tx.$queryRaw<LockedOrder[]>`
      SELECT "status", "orderNumber" FROM "orders" WHERE "id" = ${orderId} AND "tenantId" = ${tenantId} FOR UPDATE`;
    if (rows.length === 0) throw deliveryNotFound();
    return rows[0];
  }

  private async lockDeliveryStatus(tx: Tx, tenantId: string, id: string): Promise<DeliveryStatus> {
    const rows = await tx.$queryRaw<{ status: DeliveryStatus }[]>`
      SELECT "status" FROM "deliveries" WHERE "id" = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
    if (rows.length === 0) throw deliveryNotFound();
    return rows[0].status;
  }

  // Tenant-scoped lookup; a delivery of a branch the caller cannot operate is a
  // 404, same as a delivery of another tenant (nothing about existence leaks).
  private async loadScoped(user: AuthenticatedRequestUser, id: string) {
    const delivery = await this.prisma.delivery.findFirst({
      where: { id, tenantId: user.tenantId },
      select: { id: true, branchId: true, orderId: true },
    });
    if (!delivery) throw deliveryNotFound();
    const allowed = await this.branchAccess.accessibleBranchIds(user);
    if (allowed && !allowed.includes(delivery.branchId)) throw deliveryNotFound();
    return delivery;
  }

  private toSettings(branch: {
    id: string;
    deliveryEnabled: boolean;
    deliveryFeeCents: number;
    deliveryMinOrderCents: number;
  }) {
    return {
      branchId: branch.id,
      enabled: branch.deliveryEnabled,
      feeCents: branch.deliveryFeeCents,
      minOrderCents: branch.deliveryMinOrderCents,
    };
  }

  private toView(row: DeliveryRow) {
    const order = row.order;
    return {
      id: row.id,
      status: row.status,
      orderId: row.orderId,
      orderNumber: order.orderNumber,
      orderStatus: order.status,
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      address: {
        street: order.street ?? '',
        number: order.number ?? '',
        complement: order.complement,
        neighborhood: order.neighborhood ?? '',
        city: order.city ?? '',
        state: order.state ?? '',
        zipCode: order.zipCode ?? '',
      },
      paymentMethod: order.paymentMethod,
      notes: order.notes,
      itemCount: order._count.items,
      subtotalCents: order.subtotalCents,
      deliveryFeeCents: order.deliveryFeeCents,
      totalCents: order.totalCents,
      canDispatch: row.status === 'PENDING' && order.status === 'READY',
      orderCreatedAt: order.createdAt,
      dispatchedAt: row.dispatchedAt,
      deliveredAt: row.deliveredAt,
      cancelledAt: row.cancelledAt,
    };
  }
}
