import { Injectable } from '@nestjs/common';
import { Customer, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { Tx } from '../inventory/stock-ledger.service';
import { buildMetrics, isBillableOrderStatus, StatusGroup } from './customer-metrics';
import { customerCpfTaken, customerNotFound, customerPhoneTaken } from './customer-errors';
import { escapeLike, normalizeCpf, normalizeEmail, normalizePhone, searchTerms } from './customer-input';
import {
  classifyCustomer,
  CustomerSegment,
  CustomerSort,
  SegmentBoundaries,
  segmentBoundaries,
} from './customer-segments';
import {
  CreateCustomerDto,
  ListCustomerOrdersQueryDto,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from './dto/customers.dto';

const TRANSACTION_OPTIONS = { timeout: 20_000, maxWait: 10_000 };
const DEFAULT_PAGE_SIZE = 20;
const TOP_PRODUCTS_LIMIT = 5;

// Full record (detail/create/update). Contains personal data: only callers with
// customers.read reach it, and it is never written to logs or to the audit trail.
export function toCustomerView(customer: Customer) {
  return {
    id: customer.id,
    name: customer.name,
    phone: customer.phone,
    email: customer.email,
    cpf: customer.cpf,
    notes: customer.notes,
    active: customer.active,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

// One row of the list query: the customer plus what its billable orders add up to.
interface CustomerListRow {
  id: string;
  name: string;
  phone: string;
  email: string | null;
  active: boolean;
  createdAt: Date;
  ordersCount: number;
  totalSpentCents: bigint;
  firstOrderAt: Date | null;
  lastOrderAt: Date | null;
}

// The columns are TIMESTAMP (no time zone, UTC by convention). Sending the instant as a
// zone-less literal keeps the comparison independent of the database session's time zone.
const timestamp = (date: Date) => Prisma.sql`${date.toISOString().slice(0, 23)}::timestamp`;

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  // ---- list ---------------------------------------------------------------------------

  // One SQL statement decides the page: the customers of the tenant LEFT JOINed with what their
  // billable orders add up to, so searching, the segment filter, the ordering by spend/ticket
  // and the pagination all happen in the database (no N+1, no in-memory sorting of a whole
  // base). Every value is a bound parameter; nothing typed by a user reaches the SQL text.
  async list(user: AuthenticatedRequestUser, query: ListCustomersQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const status = query.status ?? 'active';
    const bounds = segmentBoundaries(new Date());

    const from = await this.customersWithStats(user);
    // Every filter except the active/inactive tab, so the tab counters describe the same view.
    const base = Prisma.sql`${from}
      WHERE c."tenantId" = ${user.tenantId}
        ${this.searchFilter(query.search)}
        ${query.segment ? Prisma.sql`AND ${this.segmentPredicate(query.segment, bounds)}` : Prisma.empty}`;
    const filtered =
      status === 'all' ? base : Prisma.sql`${base} AND c."active" = ${status === 'active'}`;

    const [counted, rows, grouped] = await this.prisma.$transaction([
      this.prisma.$queryRaw<{ total: number }[]>`SELECT COUNT(*)::int AS "total" ${filtered}`,
      this.prisma.$queryRaw<CustomerListRow[]>`
        SELECT c."id", c."name", c."phone", c."email", c."active", c."createdAt",
               COALESCE(s."ordersCount", 0)::int AS "ordersCount",
               COALESCE(s."totalSpentCents", 0)::bigint AS "totalSpentCents",
               s."firstOrderAt" AS "firstOrderAt",
               s."lastOrderAt" AS "lastOrderAt"
        ${filtered}
        ORDER BY ${this.ordering(query.sort ?? 'name')}
        LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
      this.prisma.$queryRaw<{ active: boolean; total: number }[]>`
        SELECT c."active" AS "active", COUNT(*)::int AS "total" ${base} GROUP BY c."active"`,
    ]);

    const total = counted[0]?.total ?? 0;
    const summary = { active: 0, inactive: 0 };
    for (const group of grouped) {
      if (group.active) summary.active = group.total;
      else summary.inactive = group.total;
    }
    return {
      // The list omits cpf and notes (data minimization); the detail has them.
      data: rows.map((row) => {
        const totalSpentCents = Number(row.totalSpentCents);
        return {
          id: row.id,
          name: row.name,
          phone: row.phone,
          email: row.email,
          active: row.active,
          createdAt: row.createdAt,
          ordersCount: row.ordersCount,
          totalSpentCents,
          averageTicketCents: row.ordersCount ? Math.round(totalSpentCents / row.ordersCount) : 0,
          firstOrderAt: row.firstOrderAt,
          lastOrderAt: row.lastOrderAt,
          segments: classifyCustomer(row, bounds),
        };
      }),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      summary,
    };
  }

  // How many ACTIVE customers each segment has right now (the chips above the list). Measured
  // on the branches the caller can see, like every other figure of the module.
  async segmentSummary(user: AuthenticatedRequestUser) {
    const bounds = segmentBoundaries(new Date());
    const from = await this.customersWithStats(user);
    const count = (segment: CustomerSegment) =>
      Prisma.sql`COUNT(*) FILTER (WHERE ${this.segmentPredicate(segment, bounds)})::int`;
    const rows = await this.prisma.$queryRaw<
      { total: number; NEW: number; RECURRING: number; AT_RISK: number; LOST: number }[]
    >`
      SELECT COUNT(*)::int AS "total",
             ${count('NEW')} AS "NEW",
             ${count('RECURRING')} AS "RECURRING",
             ${count('AT_RISK')} AS "AT_RISK",
             ${count('LOST')} AS "LOST"
      ${from}
      WHERE c."tenantId" = ${user.tenantId} AND c."active" = true`;
    const row = rows[0];
    return {
      total: row?.total ?? 0,
      segments: {
        NEW: row?.NEW ?? 0,
        RECURRING: row?.RECURRING ?? 0,
        AT_RISK: row?.AT_RISK ?? 0,
        LOST: row?.LOST ?? 0,
      },
    };
  }

  // ---- detail -------------------------------------------------------------------------

  async findOne(user: AuthenticatedRequestUser, id: string) {
    const customer = await this.loadCustomer(user, id);
    const orderWhere = await this.orderScope(user, id);
    const [grouped, topProducts] = await Promise.all([
      this.prisma.order.groupBy({
        by: ['status'],
        where: orderWhere,
        orderBy: { status: 'asc' },
        _count: { _all: true },
        _sum: { totalCents: true },
        _min: { createdAt: true },
        _max: { createdAt: true },
      }),
      this.topProducts(user.tenantId, orderWhere),
    ]);
    const groups: StatusGroup[] = grouped.map((g) => ({
      status: g.status,
      count: typeof g._count === 'object' ? (g._count._all ?? 0) : 0,
      totalCents: g._sum?.totalCents ?? 0,
      firstOrderAt: g._min?.createdAt ?? null,
      lastOrderAt: g._max?.createdAt ?? null,
    }));
    const metrics = buildMetrics(groups);
    return {
      ...toCustomerView(customer),
      metrics,
      segments: classifyCustomer(metrics, segmentBoundaries(new Date())),
      topProducts,
    };
  }

  // What this customer buys the most, by quantity: two queries whatever the history size (one
  // grouped over the order items, one for the product names). Cancelled orders never count.
  // `totalCents` is the value of the items at the price charged, before any order discount.
  private async topProducts(tenantId: string, orderWhere: Prisma.OrderWhereInput) {
    const grouped = await this.prisma.orderItem.groupBy({
      by: ['productId'],
      where: { order: { ...orderWhere, status: { not: 'CANCELLED' } } },
      _sum: { quantity: true, subtotalCents: true },
      _count: { _all: true },
      // Total order: a tie on quantity is broken by the id, so the ranking never flickers.
      orderBy: [{ _sum: { quantity: 'desc' } }, { productId: 'asc' }],
      take: TOP_PRODUCTS_LIMIT,
    });
    if (grouped.length === 0) return [];
    const products = await this.prisma.product.findMany({
      where: { tenantId, id: { in: grouped.map((group) => group.productId) } },
      select: { id: true, name: true },
    });
    const nameById = new Map(products.map((product) => [product.id, product.name]));
    return grouped.map((group) => ({
      productId: group.productId,
      name: nameById.get(group.productId) ?? 'Produto removido',
      quantity: group._sum.quantity ?? 0,
      totalCents: group._sum.subtotalCents ?? 0,
      // Order lines, which is the number of orders unless a product was typed twice in one.
      timesOrdered: group._count._all,
    }));
  }

  // ---- order history ------------------------------------------------------------------

  async orders(user: AuthenticatedRequestUser, id: string, query: ListCustomerOrdersQueryDto) {
    await this.loadCustomer(user, id);
    if (query.branchId) await this.branchAccess.assertAccess(user, query.branchId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;

    const scope = await this.orderScope(user, id);
    const where: Prisma.OrderWhereInput = {
      ...scope,
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          orderNumber: true,
          status: true,
          source: true,
          fulfillmentType: true,
          paymentMethod: true,
          totalCents: true,
          createdAt: true,
          branch: { select: { id: true, name: true } },
          _count: { select: { items: true } },
        },
      }),
    ]);
    return {
      data: rows.map((row) => ({
        id: row.id,
        orderNumber: row.orderNumber,
        status: row.status,
        counted: isBillableOrderStatus(row.status),
        source: row.source,
        fulfillmentType: row.fulfillmentType,
        paymentMethod: row.paymentMethod,
        totalCents: row.totalCents,
        itemCount: row._count.items,
        branch: row.branch,
        createdAt: row.createdAt,
      })),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  // ---- create / update ----------------------------------------------------------------

  async create(user: AuthenticatedRequestUser, dto: CreateCustomerDto) {
    const phone = normalizePhone(dto.phone) as string;
    const cpf = dto.cpf ? (normalizeCpf(dto.cpf) as string) : null;

    const created = await this.guarded(user.tenantId, phone, cpf, undefined, () =>
      this.prisma.$transaction(async (tx) => {
        await this.assertAvailable(tx, user.tenantId, { phone, cpf });
        const customer = await tx.customer.create({
          data: {
            tenantId: user.tenantId,
            name: dto.name,
            phone,
            email: dto.email ? normalizeEmail(dto.email) : null,
            cpf,
            notes: dto.notes ?? null,
          },
        });
        // The trail names WHAT happened, never the personal data itself.
        await this.audit.recordTx(tx, {
          tenantId: user.tenantId,
          userId: user.userId,
          action: 'CUSTOMER_CREATED',
          entity: 'Customer',
          entityId: customer.id,
          afterData: { fields: ['name', 'phone', ...(customer.email ? ['email'] : []), ...(cpf ? ['cpf'] : [])] },
        });
        return customer;
      }, TRANSACTION_OPTIONS),
    );
    return toCustomerView(created);
  }

  async update(user: AuthenticatedRequestUser, id: string, dto: UpdateCustomerDto) {
    const current = await this.loadCustomer(user, id);

    const next = {
      name: dto.name ?? current.name,
      phone: dto.phone !== undefined ? (normalizePhone(dto.phone) as string) : current.phone,
      email: dto.email !== undefined ? (dto.email ? normalizeEmail(dto.email) : null) : current.email,
      cpf: dto.cpf !== undefined ? (dto.cpf ? (normalizeCpf(dto.cpf) as string) : null) : current.cpf,
      notes: dto.notes !== undefined ? (dto.notes ?? null) : current.notes,
      active: dto.active ?? current.active,
    };
    const changed = (Object.keys(next) as (keyof typeof next)[]).filter((key) => next[key] !== current[key]);
    if (changed.length === 0) return toCustomerView(current);

    const updated = await this.guarded(user.tenantId, next.phone, next.cpf, id, () =>
      this.prisma.$transaction(async (tx) => {
        // Re-read inside the transaction: the row may have changed since the pre-read above.
        const locked = await tx.customer.findFirst({ where: { id, tenantId: user.tenantId } });
        if (!locked) throw customerNotFound();
        const phoneMayClash = next.active && (next.phone !== locked.phone || !locked.active);
        await this.assertAvailable(tx, user.tenantId, {
          phone: phoneMayClash ? next.phone : null,
          cpf: next.cpf !== locked.cpf ? next.cpf : null,
          exceptId: id,
        });
        const customer = await tx.customer.update({
          where: { id },
          data: {
            name: next.name,
            phone: next.phone,
            email: next.email,
            cpf: next.cpf,
            notes: next.notes,
            active: next.active,
          },
        });
        const fields = changed.filter((key) => key !== 'active');
        if (fields.length > 0) {
          await this.audit.recordTx(tx, {
            tenantId: user.tenantId,
            userId: user.userId,
            action: 'CUSTOMER_UPDATED',
            entity: 'Customer',
            entityId: id,
            afterData: { fields },
          });
        }
        if (changed.includes('active')) {
          await this.audit.recordTx(tx, {
            tenantId: user.tenantId,
            userId: user.userId,
            action: next.active ? 'CUSTOMER_REACTIVATED' : 'CUSTOMER_DEACTIVATED',
            entity: 'Customer',
            entityId: id,
            beforeData: { active: current.active },
            afterData: { active: next.active },
          });
        }
        return customer;
      }, TRANSACTION_OPTIONS),
    );
    return toCustomerView(updated);
  }

  // ---- helpers ------------------------------------------------------------------------

  // Tenant-scoped lookup: another tenant's customer is a plain 404.
  private async loadCustomer(user: AuthenticatedRequestUser, id: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!customer) throw customerNotFound();
    return customer;
  }

  // Orders the caller may see for this customer: same tenant, and - unless OWNER/ADMIN - only
  // the branches they are linked to. The customer itself is tenant-wide; a branch-limited user
  // just sees (and is measured on) their own branches' orders.
  private async orderScope(user: AuthenticatedRequestUser, customerId: string): Promise<Prisma.OrderWhereInput> {
    const allowed = await this.branchAccess.accessibleBranchIds(user);
    return { tenantId: user.tenantId, customerId, ...(allowed ? { branchId: { in: allowed } } : {}) };
  }

  // FROM clause shared by the list and the segment counters: every customer (alias c) with the
  // totals of its billable orders (alias s, NULL columns when there is none). The orders are
  // those of the caller's tenant and, for a branch-limited user, of the branches they can see.
  private async customersWithStats(user: AuthenticatedRequestUser): Promise<Prisma.Sql> {
    const allowed = await this.branchAccess.accessibleBranchIds(user);
    const branchFilter =
      allowed === null
        ? Prisma.empty
        : allowed.length > 0
          ? Prisma.sql`AND o."branchId" IN (${Prisma.join(allowed)})`
          : Prisma.sql`AND FALSE`;
    return Prisma.sql`
      FROM "customers" c
      LEFT JOIN (
        SELECT o."customerId" AS "customerId",
               COUNT(*)::int AS "ordersCount",
               SUM(o."totalCents")::bigint AS "totalSpentCents",
               MIN(o."createdAt") AS "firstOrderAt",
               MAX(o."createdAt") AS "lastOrderAt"
          FROM "orders" o
         WHERE o."tenantId" = ${user.tenantId}
           AND o."customerId" IS NOT NULL
           AND o."status" <> 'CANCELLED'
           ${branchFilter}
         GROUP BY o."customerId"
      ) s ON s."customerId" = c."id"`;
  }

  // Same fields and the same matching as before the list moved to SQL: name and e-mail by
  // case-insensitive "contains"; phone and CPF by their digits. LIKE wildcards are escaped.
  private searchFilter(raw: string | undefined): Prisma.Sql {
    const terms = searchTerms(raw);
    if (!terms) return Prisma.empty;
    const text = `%${escapeLike(terms.text)}%`;
    const digits = terms.digits ? `%${escapeLike(terms.digits)}%` : null;
    return Prisma.sql`AND (
      c."name" ILIKE ${text} OR c."email" ILIKE ${text}
      ${digits ? Prisma.sql`OR c."phone" LIKE ${digits} OR c."cpf" LIKE ${digits}` : Prisma.empty}
    )`;
  }

  // The SQL twin of classifyCustomer(): same rules, same boundaries (customer-segments.ts).
  private segmentPredicate(segment: CustomerSegment, bounds: SegmentBoundaries): Prisma.Sql {
    switch (segment) {
      case 'NEW':
        return Prisma.sql`s."firstOrderAt" >= ${timestamp(bounds.newSince)}`;
      case 'RECURRING':
        return Prisma.sql`(s."ordersCount" >= 2 AND s."lastOrderAt" >= ${timestamp(bounds.recentSince)})`;
      case 'AT_RISK':
        return Prisma.sql`(s."lastOrderAt" < ${timestamp(bounds.recentSince)} AND s."lastOrderAt" >= ${timestamp(bounds.lostBefore)})`;
      case 'LOST':
        return Prisma.sql`(s."customerId" IS NULL OR s."lastOrderAt" < ${timestamp(bounds.lostBefore)})`;
    }
  }

  // Always a total order (name, then id, break every tie), so pages never overlap or skip.
  private ordering(sort: CustomerSort): Prisma.Sql {
    const tieBreak = Prisma.sql`c."name" ASC, c."id" ASC`;
    switch (sort) {
      case 'spent':
        return Prisma.sql`COALESCE(s."totalSpentCents", 0) DESC, ${tieBreak}`;
      case 'ticket':
        return Prisma.sql`COALESCE(s."totalSpentCents"::numeric / NULLIF(s."ordersCount", 0), 0) DESC, ${tieBreak}`;
      case 'orders':
        return Prisma.sql`COALESCE(s."ordersCount", 0) DESC, ${tieBreak}`;
      case 'recent':
        return Prisma.sql`s."lastOrderAt" DESC NULLS LAST, ${tieBreak}`;
      case 'name':
        return tieBreak;
    }
  }

  // Friendly errors from a pre-check; the partial unique indexes are what actually guarantee
  // uniqueness when two requests race, and that case is translated below.
  private async assertAvailable(
    tx: Tx,
    tenantId: string,
    check: { phone: string | null; cpf: string | null; exceptId?: string },
  ) {
    const notSelf = check.exceptId ? { id: { not: check.exceptId } } : {};
    if (check.phone) {
      const clash = await tx.customer.findFirst({
        where: { tenantId, phone: check.phone, active: true, ...notSelf },
        select: { id: true },
      });
      if (clash) throw customerPhoneTaken(clash.id);
    }
    if (check.cpf) {
      const clash = await tx.customer.findFirst({ where: { tenantId, cpf: check.cpf, ...notSelf }, select: { id: true } });
      if (clash) throw customerCpfTaken(clash.id);
    }
  }

  // A race between two requests is settled by the unique index (P2002); find out which rule was
  // hit so the answer is the same friendly 409 as the pre-check.
  private async guarded<T>(tenantId: string, phone: string, cpf: string | null, exceptId: string | undefined, work: () => Promise<T>) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const notSelf = exceptId ? { id: { not: exceptId } } : {};
        const byCpf = cpf
          ? await this.prisma.customer.findFirst({ where: { tenantId, cpf, ...notSelf }, select: { id: true } })
          : null;
        if (byCpf) throw customerCpfTaken(byCpf.id);
        const byPhone = await this.prisma.customer.findFirst({
          where: { tenantId, phone, active: true, ...notSelf },
          select: { id: true },
        });
        throw customerPhoneTaken(byPhone?.id);
      }
      throw error;
    }
  }
}
