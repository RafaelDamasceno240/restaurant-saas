import { BadRequestException, ForbiddenException, Injectable } from '@nestjs/common';
import { Coupon, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { couponCodeTaken, couponNotFound } from './coupon-errors';
import { escapeLike, normalizeCouponCode } from './coupon-input';
import { couponAvailability, CouponShape, validateCouponShape } from './coupon-validation';
import { CreateCouponDto, ListCouponsQueryDto, UpdateCouponDto } from './dto/coupons.dto';

const TRANSACTION_OPTIONS = { timeout: 20_000, maxWait: 10_000 };
const DEFAULT_PAGE_SIZE = 20;

type CouponWithBranch = Coupon & { branch: { id: string; name: string } | null };

const WITH_BRANCH = { branch: { select: { id: true, name: true } } } as const;

// Administrative view. Nothing personal lives on a coupon; `availability` is derived here from
// the same fields the order flow uses, never stored.
export function toCouponView(coupon: CouponWithBranch, now: Date = new Date()) {
  return {
    id: coupon.id,
    code: coupon.code,
    description: coupon.description,
    discountType: coupon.discountType,
    value: coupon.value,
    minOrderCents: coupon.minOrderCents,
    maxDiscountCents: coupon.maxDiscountCents,
    startsAt: coupon.startsAt,
    endsAt: coupon.endsAt,
    active: coupon.active,
    availability: couponAvailability(coupon, now),
    usageLimit: coupon.usageLimit,
    usageCount: coupon.usageCount,
    perCustomerLimit: coupon.perCustomerLimit,
    branch: coupon.branch,
    createdAt: coupon.createdAt,
    updatedAt: coupon.updatedAt,
  };
}

function assertShape(shape: CouponShape) {
  const issues = validateCouponShape(shape);
  if (issues.length > 0) {
    throw new BadRequestException({
      code: 'COUPON_INVALID_INPUT',
      message: issues[0].message,
      details: { issues },
    });
  }
}

const sameInstant = (a: Date | null, b: Date | null) =>
  a === null || b === null ? a === b : a.getTime() === b.getTime();

@Injectable()
export class CouponsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  // ---- list ---------------------------------------------------------------------------

  async list(user: AuthenticatedRequestUser, query: ListCouponsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const status = query.status ?? 'active';
    const search = query.search ? normalizeCouponCode(query.search) : '';

    // Every filter except the active/inactive tab, so the tab counters describe the same search.
    const base: Prisma.CouponWhereInput = {
      ...(await this.visibility(user)),
      ...(search ? { code: { contains: escapeLike(search) } } : {}),
    };
    const where: Prisma.CouponWhereInput = {
      ...base,
      ...(status === 'all' ? {} : { active: status === 'active' }),
    };

    const [total, rows, grouped] = await this.prisma.$transaction([
      this.prisma.coupon.count({ where }),
      this.prisma.coupon.findMany({
        where,
        // Total order: ties on createdAt are broken by id, so pages never overlap or skip.
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: WITH_BRANCH,
      }),
      this.prisma.coupon.groupBy({
        by: ['active'],
        where: base,
        orderBy: { active: 'asc' },
        _count: { _all: true },
      }),
    ]);

    const summary = { active: 0, inactive: 0 };
    for (const group of grouped) {
      const counted = typeof group._count === 'object' ? (group._count._all ?? 0) : 0;
      if (group.active) summary.active = counted;
      else summary.inactive = counted;
    }
    const now = new Date();
    return {
      data: rows.map((row) => toCouponView(row, now)),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      summary,
    };
  }

  async findOne(user: AuthenticatedRequestUser, id: string) {
    return toCouponView(await this.load(user, id));
  }

  // ---- create / update / (de)activate ---------------------------------------------------

  async create(user: AuthenticatedRequestUser, dto: CreateCouponDto) {
    const allowed = await this.branchAccess.accessibleBranchIds(user);
    const branchId = dto.branchId ?? null;
    if (allowed !== null && branchId === null) {
      // A branch-limited user cannot create a coupon that works at branches they do not manage.
      throw this.branchForbidden();
    }
    if (branchId !== null) await this.branchAccess.assertAccess(user, branchId); // tenant + active + link

    const shape: CouponShape = {
      discountType: dto.discountType,
      value: dto.value,
      minOrderCents: dto.minOrderCents ?? 0,
      maxDiscountCents: dto.maxDiscountCents ?? null,
      startsAt: dto.startsAt ?? null,
      endsAt: dto.endsAt ?? null,
      usageLimit: dto.usageLimit ?? null,
      perCustomerLimit: dto.perCustomerLimit ?? null,
    };
    assertShape(shape);

    const created = await this.guarded(user.tenantId, dto.code, undefined, () =>
      this.prisma.$transaction(async (tx) => {
        await this.assertCodeFree(tx, user.tenantId, dto.code);
        const coupon = await tx.coupon.create({
          data: {
            tenantId: user.tenantId,
            branchId,
            code: dto.code,
            description: dto.description ?? null,
            ...shape,
          },
          include: WITH_BRANCH,
        });
        await this.audit.recordTx(tx, {
          tenantId: user.tenantId,
          userId: user.userId,
          action: 'COUPON_CREATED',
          entity: 'Coupon',
          entityId: coupon.id,
          afterData: {
            code: coupon.code,
            discountType: coupon.discountType,
            value: coupon.value,
            branchId,
          },
        });
        return coupon;
      }, TRANSACTION_OPTIONS),
    );
    return toCouponView(created);
  }

  async update(user: AuthenticatedRequestUser, id: string, dto: UpdateCouponDto) {
    const visible = await this.load(user, id);
    await this.assertCanManage(user, visible);

    return this.prisma.$transaction(async (tx) => {
      // Serialized with the order flow: a redemption in flight cannot slip between the
      // "usageLimit >= usageCount" check below and the write.
      const current = await this.lockOwn(tx, user, id);
      const next = {
        description:
          dto.description !== undefined ? (dto.description ?? null) : current.description,
        discountType: dto.discountType ?? current.discountType,
        value: dto.value ?? current.value,
        minOrderCents: dto.minOrderCents ?? current.minOrderCents,
        maxDiscountCents:
          dto.maxDiscountCents !== undefined
            ? (dto.maxDiscountCents ?? null)
            : current.maxDiscountCents,
        startsAt: dto.startsAt !== undefined ? (dto.startsAt ?? null) : current.startsAt,
        endsAt: dto.endsAt !== undefined ? (dto.endsAt ?? null) : current.endsAt,
        usageLimit: dto.usageLimit !== undefined ? (dto.usageLimit ?? null) : current.usageLimit,
        perCustomerLimit:
          dto.perCustomerLimit !== undefined
            ? (dto.perCustomerLimit ?? null)
            : current.perCustomerLimit,
      };
      assertShape({ ...next });
      if (next.usageLimit !== null && next.usageLimit < current.usageCount) {
        throw new BadRequestException({
          code: 'COUPON_USAGE_LIMIT_BELOW_USED',
          message: `O limite não pode ser menor que as ${current.usageCount} utilizações já realizadas.`,
          details: { usageCount: current.usageCount },
        });
      }

      const changed = (Object.keys(next) as (keyof typeof next)[]).filter((key) => {
        const a = next[key];
        const b = current[key];
        return a instanceof Date || b instanceof Date
          ? !sameInstant(a as Date | null, b as Date | null)
          : a !== b;
      });
      if (changed.length === 0) return toCouponView({ ...current, branch: visible.branch });

      const updated = await tx.coupon.update({ where: { id }, data: next, include: WITH_BRANCH });
      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'COUPON_UPDATED',
        entity: 'Coupon',
        entityId: id,
        afterData: { code: current.code, fields: changed },
      });
      return toCouponView(updated);
    }, TRANSACTION_OPTIONS);
  }

  activate(user: AuthenticatedRequestUser, id: string) {
    return this.setActive(user, id, true);
  }

  deactivate(user: AuthenticatedRequestUser, id: string) {
    return this.setActive(user, id, false);
  }

  private async setActive(user: AuthenticatedRequestUser, id: string, active: boolean) {
    const visible = await this.load(user, id);
    await this.assertCanManage(user, visible);

    return this.guarded(user.tenantId, visible.code, id, () =>
      this.prisma.$transaction(async (tx) => {
        const current = await this.lockOwn(tx, user, id);
        if (current.active === active) return toCouponView({ ...current, branch: visible.branch }); // idempotent
        // Reactivating an old coupon while another ACTIVE one has the same code is a conflict.
        if (active) await this.assertCodeFree(tx, user.tenantId, current.code, id);
        const updated = await tx.coupon.update({
          where: { id },
          data: { active },
          include: WITH_BRANCH,
        });
        await this.audit.recordTx(tx, {
          tenantId: user.tenantId,
          userId: user.userId,
          action: active ? 'COUPON_ACTIVATED' : 'COUPON_DEACTIVATED',
          entity: 'Coupon',
          entityId: id,
          beforeData: { active: current.active },
          afterData: { code: current.code, active },
        });
        return toCouponView(updated);
      }, TRANSACTION_OPTIONS),
    );
  }

  // ---- helpers ------------------------------------------------------------------------

  // Who sees what: OWNER/ADMIN every coupon of the tenant; everyone else the tenant-wide ones
  // plus those of the branches they are linked to.
  private async visibility(user: AuthenticatedRequestUser): Promise<Prisma.CouponWhereInput> {
    const allowed = await this.branchAccess.accessibleBranchIds(user);
    return {
      tenantId: user.tenantId,
      ...(allowed !== null ? { OR: [{ branchId: null }, { branchId: { in: allowed } }] } : {}),
    };
  }

  // Tenant-scoped lookup: another tenant's coupon (or another branch's, for a branch-limited
  // user) is a plain 404.
  private async load(user: AuthenticatedRequestUser, id: string): Promise<CouponWithBranch> {
    const coupon = await this.prisma.coupon.findFirst({
      where: { id, ...(await this.visibility(user)) },
      include: WITH_BRANCH,
    });
    if (!coupon) throw couponNotFound();
    return coupon;
  }

  // Changing a coupon needs the same reach as creating one: a branch-limited user manages only
  // the coupons of their own branches, never the tenant-wide ones.
  private async assertCanManage(user: AuthenticatedRequestUser, coupon: Coupon) {
    const allowed = await this.branchAccess.accessibleBranchIds(user);
    if (allowed !== null && (coupon.branchId === null || !allowed.includes(coupon.branchId))) {
      throw this.branchForbidden();
    }
  }

  private branchForbidden() {
    return new ForbiddenException({
      code: 'COUPON_BRANCH_FORBIDDEN',
      message: 'Você só pode gerenciar cupons das unidades às quais tem acesso.',
    });
  }

  // Row lock, then re-read inside the transaction (tenant-scoped).
  private async lockOwn(
    tx: Prisma.TransactionClient,
    user: AuthenticatedRequestUser,
    id: string,
  ): Promise<Coupon> {
    await tx.$queryRaw`SELECT "id" FROM "coupons" WHERE "id" = ${id} AND "tenantId" = ${user.tenantId} FOR UPDATE`;
    const coupon = await tx.coupon.findFirst({ where: { id, tenantId: user.tenantId } });
    if (!coupon) throw couponNotFound();
    return coupon;
  }

  // Friendly 409 from a pre-check; the partial unique index is what really guarantees it when
  // two requests race, and that case is translated in guarded().
  private async assertCodeFree(
    tx: Prisma.TransactionClient,
    tenantId: string,
    code: string,
    exceptId?: string,
  ) {
    const clash = await tx.coupon.findFirst({
      where: { tenantId, code, active: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
      select: { id: true },
    });
    if (clash) throw couponCodeTaken(clash.id);
  }

  private async guarded<T>(
    tenantId: string,
    code: string,
    exceptId: string | undefined,
    work: () => Promise<T>,
  ) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const clash = await this.prisma.coupon.findFirst({
          where: { tenantId, code, active: true, ...(exceptId ? { id: { not: exceptId } } : {}) },
          select: { id: true },
        });
        throw couponCodeTaken(clash?.id);
      }
      throw error;
    }
  }
}
