import { Injectable } from '@nestjs/common';
import { DeliveryStatus, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { Tx } from '../inventory/stock-ledger.service';
import {
  deliveryNotesLocked,
  deliveryNotFound,
  deliveryStateInconsistent,
  invalidDeliveryTransition,
  orderNotReadyForDispatch,
} from './delivery-errors';
import { createdAtRange, escapeLike, normalizeNotes } from './delivery-input';
import { canEditDeliveryNotes, isValidDeliveryTransition } from './delivery-status.util';
import {
  DeliverySettingsQueryDto,
  ListDeliveriesQueryDto,
  UpdateDeliveryNotesDto,
  UpdateDeliverySettingsDto,
} from './dto/delivery.dto';

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

interface LockedDelivery {
  status: DeliveryStatus;
  attemptCount: number;
}

type Step = 'dispatch' | 'complete' | 'fail' | 'redeliver';

interface StepRule {
  to: DeliveryStatus;
  orderFrom: OrderStatus;
  orderTo: OrderStatus;
  action: string;
}

// The four operational moves. The order changes only when orderFrom !== orderTo:
// a failure sends the order back to READY (never to CANCELLED), a redelivery request
// keeps it READY.
const STEP: Record<Step, StepRule> = {
  dispatch: { to: 'OUT_FOR_DELIVERY', orderFrom: 'READY', orderTo: 'OUT_FOR_DELIVERY', action: 'DELIVERY_DISPATCHED' },
  complete: { to: 'DELIVERED', orderFrom: 'OUT_FOR_DELIVERY', orderTo: 'DELIVERED', action: 'DELIVERY_COMPLETED' },
  fail: { to: 'FAILED', orderFrom: 'OUT_FOR_DELIVERY', orderTo: 'READY', action: 'DELIVERY_FAILED' },
  redeliver: { to: 'PENDING', orderFrom: 'READY', orderTo: 'READY', action: 'DELIVERY_REDELIVERY_REQUESTED' },
};

const EMPTY_SUMMARY = (): Record<DeliveryStatus, number> => ({
  PENDING: 0,
  OUT_FOR_DELIVERY: 0,
  DELIVERED: 0,
  CANCELLED: 0,
  FAILED: 0,
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

    // Every filter except the delivery status: the tab counters (summary) must describe
    // the same search/period/order-status the operator is looking at.
    const search = query.search?.trim();
    const base: Prisma.DeliveryWhereInput = {
      tenantId: user.tenantId,
      branchId: query.branchId,
      ...(createdAtRange(query.dateFrom, query.dateTo) ? { createdAt: createdAtRange(query.dateFrom, query.dateTo) } : {}),
      ...(query.orderStatus || search
        ? {
            order: {
              ...(query.orderStatus ? { status: query.orderStatus } : {}),
              ...(search
                ? {
                    OR: [
                      { orderNumber: { contains: escapeLike(search), mode: 'insensitive' } },
                      { customerName: { contains: escapeLike(search), mode: 'insensitive' } },
                    ],
                  }
                : {}),
            },
          }
        : {}),
    };
    const where: Prisma.DeliveryWhereInput = { ...base, ...(query.status ? { status: query.status } : {}) };
    // Active work first-in-first-out; history newest first. `id` makes the order total.
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
        where: base,
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

  fail(user: AuthenticatedRequestUser, id: string, reason: string) {
    return this.transition(user, id, 'fail', reason);
  }

  redeliver(user: AuthenticatedRequestUser, id: string) {
    return this.transition(user, id, 'redeliver');
  }

  // Delivery-specific observation, separate from Order.notes. Same-value writes are a
  // no-op (200, idempotentReplay=true, no audit); a finished delivery is read-only.
  async updateNotes(user: AuthenticatedRequestUser, id: string, dto: UpdateDeliveryNotesDto) {
    await this.loadScoped(user, id);
    const next = normalizeNotes(dto.notes);

    const replay = await this.prisma.$transaction(async (tx) => {
      const current = await this.lockDelivery(tx, user.tenantId, id);
      if (!canEditDeliveryNotes(current.status)) throw deliveryNotesLocked();
      const before = await tx.delivery.findUniqueOrThrow({ where: { id }, select: { notes: true } });
      if (before.notes === next) return true;

      await tx.delivery.update({ where: { id }, data: { notes: next } });
      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'DELIVERY_NOTES_UPDATED',
        entity: 'Delivery',
        entityId: id,
        beforeData: { notes: before.notes },
        afterData: { notes: next },
      });
      return false;
    }, TRANSACTION_OPTIONS);

    return { ...(await this.findView(user, id)), idempotentReplay: replay };
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

  // The operational moves: the delivery row and its order move together, in ONE
  // transaction. Lock order is always ORDER first, then DELIVERY (the same order
  // OrdersService uses when it cancels), so the two can never deadlock. The state is
  // re-read AFTER the locks: a duplicate or concurrent request finds the target state
  // already reached and answers as a replay (200, idempotentReplay=true, nothing written);
  // an impossible move is a 409. Idempotency is by STATE, not by attempt: a stale
  // duplicate of an earlier attempt's request is indistinguishable from a repeat.
  private async transition(user: AuthenticatedRequestUser, id: string, step: Step, reason?: string) {
    const scoped = await this.loadScoped(user, id);
    const rule = STEP[step];

    const replay = await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, user.tenantId, scoped.orderId);
      const current = await this.lockDelivery(tx, user.tenantId, id);

      // PENDING is also the initial state: only a delivery that already had an attempt
      // counts as "redelivery already requested".
      const alreadyThere = current.status === rule.to && (step !== 'redeliver' || current.attemptCount > 0);
      if (alreadyThere) return true;
      if (!isValidDeliveryTransition(current.status, rule.to)) throw invalidDeliveryTransition(current.status, rule.to);
      if (order.status !== rule.orderFrom) {
        if (step === 'dispatch') throw orderNotReadyForDispatch();
        throw deliveryStateInconsistent();
      }

      const now = new Date();
      const data: Prisma.DeliveryUpdateInput = { status: rule.to };
      if (step === 'dispatch') {
        data.dispatchedAt = now;
        data.dispatchedBy = { connect: { id: user.userId } };
        data.attemptCount = { increment: 1 };
      } else if (step === 'complete') {
        data.deliveredAt = now;
        data.completedBy = { connect: { id: user.userId } };
      } else if (step === 'fail') {
        data.failedAt = now;
        data.failureReason = reason ?? null;
      } else {
        data.failedAt = null;
        data.failureReason = null;
      }
      await tx.delivery.update({ where: { id }, data });
      if (rule.orderFrom !== rule.orderTo) {
        await tx.order.update({ where: { id: scoped.orderId }, data: { status: rule.orderTo } });
      }

      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: rule.action,
        entity: 'Delivery',
        entityId: id,
        beforeData: { status: current.status },
        afterData: {
          status: rule.to,
          orderId: scoped.orderId,
          orderNumber: order.orderNumber,
          attempt: step === 'dispatch' ? current.attemptCount + 1 : current.attemptCount,
          ...(reason ? { reason } : {}),
        },
      });
      if (rule.orderFrom !== rule.orderTo) {
        await this.audit.recordTx(tx, {
          tenantId: user.tenantId,
          userId: user.userId,
          action: 'ORDER_STATUS_CHANGED',
          entity: 'Order',
          entityId: scoped.orderId,
          beforeData: { status: rule.orderFrom },
          afterData: { status: rule.orderTo, via: 'DELIVERY' },
        });
      }
      return false;
    }, TRANSACTION_OPTIONS);

    return { ...(await this.findView(user, id)), idempotentReplay: replay };
  }

  private async findView(user: AuthenticatedRequestUser, id: string) {
    const fresh = await this.prisma.delivery.findFirstOrThrow({
      where: { id, tenantId: user.tenantId },
      include: listInclude,
    });
    return this.toView(fresh);
  }

  private async lockOrder(tx: Tx, tenantId: string, orderId: string): Promise<LockedOrder> {
    const rows = await tx.$queryRaw<LockedOrder[]>`
      SELECT "status", "orderNumber" FROM "orders" WHERE "id" = ${orderId} AND "tenantId" = ${tenantId} FOR UPDATE`;
    if (rows.length === 0) throw deliveryNotFound();
    return rows[0];
  }

  private async lockDelivery(tx: Tx, tenantId: string, id: string): Promise<LockedDelivery> {
    const rows = await tx.$queryRaw<LockedDelivery[]>`
      SELECT "status", "attemptCount" FROM "deliveries" WHERE "id" = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
    if (rows.length === 0) throw deliveryNotFound();
    return rows[0];
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
      // Two distinct notes: the order's general observation and the delivery instructions.
      orderNotes: order.notes,
      deliveryNotes: row.notes,
      itemCount: order._count.items,
      subtotalCents: order.subtotalCents,
      deliveryFeeCents: order.deliveryFeeCents,
      totalCents: order.totalCents,
      attemptCount: row.attemptCount,
      failureReason: row.failureReason,
      canDispatch: row.status === 'PENDING' && order.status === 'READY',
      canFail: row.status === 'OUT_FOR_DELIVERY',
      canRedeliver: row.status === 'FAILED',
      canEditNotes: canEditDeliveryNotes(row.status),
      orderCreatedAt: order.createdAt,
      dispatchedAt: row.dispatchedAt,
      deliveredAt: row.deliveredAt,
      failedAt: row.failedAt,
      cancelledAt: row.cancelledAt,
    };
  }
}
