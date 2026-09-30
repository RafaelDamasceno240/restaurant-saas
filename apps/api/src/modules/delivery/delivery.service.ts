import { Injectable } from '@nestjs/common';
import { DeliveryStatus, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { Tx } from '../inventory/stock-ledger.service';
import {
  courierNotEligible,
  courierNotFound,
  deliveryAssignmentLocked,
  deliveryNotesLocked,
  deliveryNotFound,
  deliveryStateInconsistent,
  invalidDeliveryTransition,
  orderNotReadyForDispatch,
} from './delivery-errors';
import { courierIneligibleReason, courierWhere } from './delivery-courier';
import { HISTORY_ACTIONS, buildHistory } from './delivery-history';
import { createdAtRange, escapeLike, normalizeNotes } from './delivery-input';
import { canAssignCourier, canEditDeliveryNotes, isValidDeliveryTransition } from './delivery-status.util';
import {
  CouriersQueryDto,
  DeliverySettingsQueryDto,
  ListDeliveriesQueryDto,
  UpdateDeliveryNotesDto,
  UpdateDeliverySettingsDto,
} from './dto/delivery.dto';

const TRANSACTION_OPTIONS = { timeout: 20_000, maxWait: 10_000 };
const DEFAULT_PAGE_SIZE = 20;

const listInclude = {
  courier: { select: { id: true, name: true } },
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
  courierUserId: string | null;
}

const MAX_COURIERS = 200;
const MAX_HISTORY_EVENTS = 500;

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
      ...courierWhere(query.courier, user.userId),
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

  // Assign / reassign. The client only names the courier: tenant and branch come from the
  // session and the delivery. Same lock order as every other move (ORDER, then DELIVERY),
  // state re-read after the locks, eligibility checked INSIDE the transaction so a courier
  // deactivated or unlinked a moment ago cannot slip through. Same courier = replay.
  async assignCourier(user: AuthenticatedRequestUser, id: string, courierUserId: string) {
    const scoped = await this.loadScoped(user, id);

    const replay = await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, user.tenantId, scoped.orderId);
      const current = await this.lockDelivery(tx, user.tenantId, id);
      if (current.courierUserId === courierUserId) return true;
      if (!canAssignCourier(current.status)) throw deliveryAssignmentLocked();
      await this.assertEligibleCourier(tx, user.tenantId, courierUserId, scoped.branchId);

      await tx.delivery.update({ where: { id }, data: { courierUserId, assignedAt: new Date() } });
      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: current.courierUserId ? 'DELIVERY_REASSIGNED' : 'DELIVERY_ASSIGNED',
        entity: 'Delivery',
        entityId: id,
        beforeData: { courierUserId: current.courierUserId },
        afterData: {
          courierUserId,
          previousCourierUserId: current.courierUserId,
          status: current.status,
          orderId: scoped.orderId,
          orderNumber: order.orderNumber,
          branchId: scoped.branchId,
        },
      });
      return false;
    }, TRANSACTION_OPTIONS);

    return { ...(await this.findView(user, id)), idempotentReplay: replay };
  }

  async unassignCourier(user: AuthenticatedRequestUser, id: string) {
    const scoped = await this.loadScoped(user, id);

    const replay = await this.prisma.$transaction(async (tx) => {
      const order = await this.lockOrder(tx, user.tenantId, scoped.orderId);
      const current = await this.lockDelivery(tx, user.tenantId, id);
      if (current.courierUserId === null) return true;
      if (!canAssignCourier(current.status)) throw deliveryAssignmentLocked();

      await tx.delivery.update({ where: { id }, data: { courierUserId: null, assignedAt: null } });
      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'DELIVERY_UNASSIGNED',
        entity: 'Delivery',
        entityId: id,
        beforeData: { courierUserId: current.courierUserId },
        afterData: {
          courierUserId: null,
          status: current.status,
          orderId: scoped.orderId,
          orderNumber: order.orderNumber,
          branchId: scoped.branchId,
        },
      });
      return false;
    }, TRANSACTION_OPTIONS);

    return { ...(await this.findView(user, id)), idempotentReplay: replay };
  }

  // Users that can be offered as courier for a branch: same tenant, ACTIVE, role DELIVERY,
  // linked to the branch (OWNER/ADMIN holding DELIVERY are tenant-wide).
  async listCouriers(user: AuthenticatedRequestUser, query: CouriersQueryDto) {
    await this.branchAccess.assertAccess(user, query.branchId);
    const users = await this.prisma.user.findMany({
      where: {
        tenantId: user.tenantId,
        status: 'ACTIVE',
        userRoles: { some: { tenantId: user.tenantId, role: { name: 'DELIVERY' } } },
        OR: [
          { userBranches: { some: { branchId: query.branchId } } },
          { userRoles: { some: { tenantId: user.tenantId, role: { name: { in: ['OWNER', 'ADMIN'] } } } } },
        ],
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: MAX_COURIERS,
      select: { id: true, name: true },
    });
    return { data: users };
  }

  // Operational history rebuilt from the audit log: no table of its own. A cancellation is
  // recorded against the ORDER, so that one event is read through the order id.
  async history(user: AuthenticatedRequestUser, id: string) {
    const scoped = await this.loadScoped(user, id);
    const delivery = await this.prisma.delivery.findFirstOrThrow({
      where: { id, tenantId: user.tenantId },
      select: { createdAt: true },
    });
    const rows = await this.prisma.auditLog.findMany({
      where: {
        tenantId: user.tenantId,
        action: { in: [...HISTORY_ACTIONS] },
        OR: [
          { entity: 'Delivery', entityId: id },
          { entity: 'Order', entityId: scoped.orderId, action: 'DELIVERY_CANCELLED' },
        ],
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: MAX_HISTORY_EVENTS,
      select: { id: true, action: true, createdAt: true, userId: true, beforeData: true, afterData: true },
    });

    const events = buildHistory(
      delivery.createdAt,
      rows.map((r) => ({
        id: r.id,
        action: r.action,
        createdAt: r.createdAt,
        actor: r.userId ? { id: r.userId, name: '' } : null,
        beforeData: r.beforeData,
        afterData: r.afterData,
      })),
    );

    // Resolve every referenced user (actors and couriers) with ONE query, inside the tenant.
    const ids = new Set<string>();
    for (const e of events) {
      if (e.actor) ids.add(e.actor.id);
      if (e.courierUserId) ids.add(e.courierUserId);
      if (e.previousCourierUserId) ids.add(e.previousCourierUserId);
    }
    const people = ids.size
      ? await this.prisma.user.findMany({
          where: { id: { in: [...ids] }, tenantId: user.tenantId },
          select: { id: true, name: true },
        })
      : [];
    const nameOf = new Map(people.map((p) => [p.id, p.name]));
    const person = (pid: string | null) => (pid ? { id: pid, name: nameOf.get(pid) ?? null } : null);

    return {
      data: events.map((e) => ({
        id: e.id,
        kind: e.kind,
        at: e.at,
        attempt: e.attempt,
        reason: e.reason,
        actor: e.actor ? person(e.actor.id) : null,
        courier: person(e.courierUserId),
        previousCourier: person(e.previousCourierUserId),
      })),
    };
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
          courierUserId: current.courierUserId,
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

  private async assertEligibleCourier(tx: Tx, tenantId: string, courierUserId: string, branchId: string) {
    const candidate = await tx.user.findFirst({
      where: { id: courierUserId, tenantId },
      select: {
        status: true,
        userRoles: { select: { role: { select: { name: true } } } },
        userBranches: { select: { branchId: true } },
      },
    });
    if (!candidate) throw courierNotFound();
    const reason = courierIneligibleReason(
      {
        status: candidate.status,
        roles: candidate.userRoles.map((r) => r.role.name),
        branchIds: candidate.userBranches.map((b) => b.branchId),
      },
      branchId,
    );
    if (reason) throw courierNotEligible(reason);
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
      SELECT "status", "attemptCount", "courierUserId" FROM "deliveries" WHERE "id" = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`;
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
      courier: row.courier,
      assignedAt: row.assignedAt,
      canAssign: canAssignCourier(row.status),
      orderCreatedAt: order.createdAt,
      dispatchedAt: row.dispatchedAt,
      deliveredAt: row.deliveredAt,
      failedAt: row.failedAt,
      cancelledAt: row.cancelledAt,
    };
  }
}
