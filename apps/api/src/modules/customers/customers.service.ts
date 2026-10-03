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
  CreateCustomerDto,
  ListCustomerOrdersQueryDto,
  ListCustomersQueryDto,
  UpdateCustomerDto,
} from './dto/customers.dto';

const TRANSACTION_OPTIONS = { timeout: 20_000, maxWait: 10_000 };
const DEFAULT_PAGE_SIZE = 20;

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

@Injectable()
export class CustomersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  // ---- list ---------------------------------------------------------------------------

  async list(user: AuthenticatedRequestUser, query: ListCustomersQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const status = query.status ?? 'active';

    // Every filter except the active/inactive tab, so the tab counters describe the same search.
    const terms = searchTerms(query.search);
    const base: Prisma.CustomerWhereInput = {
      tenantId: user.tenantId,
      ...(terms
        ? {
            OR: [
              { name: { contains: escapeLike(terms.text), mode: 'insensitive' } },
              { email: { contains: escapeLike(terms.text), mode: 'insensitive' } },
              ...(terms.digits
                ? [{ phone: { contains: terms.digits } }, { cpf: { contains: terms.digits } }]
                : []),
            ],
          }
        : {}),
    };
    const where: Prisma.CustomerWhereInput = {
      ...base,
      ...(status === 'all' ? {} : { active: status === 'active' }),
    };

    const [total, rows, grouped] = await this.prisma.$transaction([
      this.prisma.customer.count({ where }),
      this.prisma.customer.findMany({
        where,
        // Total order: a name tie is broken by id, so pages never overlap or skip.
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        // The list omits cpf and notes (data minimization); the detail has them.
        select: { id: true, name: true, phone: true, email: true, active: true, createdAt: true },
      }),
      this.prisma.customer.groupBy({ by: ['active'], where: base, orderBy: { active: 'asc' }, _count: { _all: true } }),
    ]);

    // One grouped query for the whole page (no N+1).
    const stats = await this.pageStats(user, rows.map((row) => row.id));
    const summary = { active: 0, inactive: 0 };
    for (const group of grouped) {
      const counted = typeof group._count === 'object' ? (group._count._all ?? 0) : 0;
      if (group.active) summary.active = counted;
      else summary.inactive = counted;
    }
    return {
      data: rows.map((row) => ({ ...row, ...(stats.get(row.id) ?? { ordersCount: 0, totalSpentCents: 0, lastOrderAt: null }) })),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      summary,
    };
  }

  // ---- detail -------------------------------------------------------------------------

  async findOne(user: AuthenticatedRequestUser, id: string) {
    const customer = await this.loadCustomer(user, id);
    const orderWhere = await this.orderScope(user, id);
    const grouped = await this.prisma.order.groupBy({
      by: ['status'],
      where: orderWhere,
      orderBy: { status: 'asc' },
      _count: { _all: true },
      _sum: { totalCents: true },
      _min: { createdAt: true },
      _max: { createdAt: true },
    });
    const groups: StatusGroup[] = grouped.map((g) => ({
      status: g.status,
      count: typeof g._count === 'object' ? (g._count._all ?? 0) : 0,
      totalCents: g._sum?.totalCents ?? 0,
      firstOrderAt: g._min?.createdAt ?? null,
      lastOrderAt: g._max?.createdAt ?? null,
    }));
    return { ...toCustomerView(customer), metrics: buildMetrics(groups) };
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

  private async pageStats(user: AuthenticatedRequestUser, ids: string[]) {
    const stats = new Map<string, { ordersCount: number; totalSpentCents: number; lastOrderAt: Date | null }>();
    if (ids.length === 0) return stats;
    const allowed = await this.branchAccess.accessibleBranchIds(user);
    const grouped = await this.prisma.order.groupBy({
      by: ['customerId'],
      where: {
        tenantId: user.tenantId,
        customerId: { in: ids },
        status: { not: 'CANCELLED' },
        ...(allowed ? { branchId: { in: allowed } } : {}),
      },
      orderBy: { customerId: 'asc' },
      _count: { _all: true },
      _sum: { totalCents: true },
      _max: { createdAt: true },
    });
    for (const group of grouped) {
      if (!group.customerId) continue;
      stats.set(group.customerId, {
        ordersCount: typeof group._count === 'object' ? (group._count._all ?? 0) : 0,
        totalSpentCents: group._sum?.totalCents ?? 0,
        lastOrderAt: group._max?.createdAt ?? null,
      });
    }
    return stats;
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
