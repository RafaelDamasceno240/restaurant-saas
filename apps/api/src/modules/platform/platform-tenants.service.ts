import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TenantStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SessionRevocationService } from '../auth/session-revocation.service';
import { ProvisionTenantDto } from '../tenants/dto/provision-tenant.dto';
import { TenantProvisioningService } from '../tenants/tenant-provisioning.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { findAccountsByLoginEmail } from '../../common/util/login-email.util';
import { ListPlatformTenantsQueryDto, PLATFORM_PAGE_SIZE } from './dto/platform.dto';

export interface PlatformRequestMeta {
  ip?: string;
  userAgent?: string;
}

// What a suspension may start from, and what it goes back to. The status column is the one the
// whole API already obeys (isTenantBlocked: SUSPENDED and CANCELLED are refused at login, at
// refresh and on every public route); nothing here adds a parallel flag.
const SUSPENDABLE: TenantStatus[] = ['ACTIVE', 'TRIAL'];

// The platform's own audit actions. TENANT_PROVISIONED (written by the provisioning service) is
// shown with them in a restaurant's history.
export const PLATFORM_ACTIONS = [
  'TENANT_PROVISIONED',
  'PLATFORM_TENANT_CREATED',
  'PLATFORM_TENANT_SUSPENDED',
  'PLATFORM_TENANT_REACTIVATED',
] as const;

// CNPJ 12.***.***/****-99, CPF ***.***.***-99: enough to tell two customers apart on a call,
// not enough to copy the document out of the panel.
export function maskDocument(document: string): string {
  const digits = document.replace(/\D/g, '');
  if (digits.length === 14) return `${digits.slice(0, 2)}.***.***/****-${digits.slice(12)}`;
  if (digits.length === 11) return `***.***.***-${digits.slice(9)}`;
  return digits.length > 2 ? `${'*'.repeat(digits.length - 2)}${digits.slice(-2)}` : '**';
}

const OWNER_EMAIL = {
  where: { role: { name: 'OWNER' as const } },
  orderBy: { createdAt: 'asc' as const },
  take: 1,
  select: { user: { select: { email: true } } },
};

// Everything /platform does with restaurants. It deliberately reads ACROSS tenants, so it lives
// only behind PlatformAdminGuard (PlatformController); no tenant-scoped module imports it, and it
// never takes a tenantId from the caller's token. It changes one thing in a restaurant, its
// status, and creates restaurants only through TenantProvisioningService.
@Injectable()
export class PlatformTenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly provisioning: TenantProvisioningService,
    private readonly revocations: SessionRevocationService,
  ) {}

  async overview() {
    const groups = await this.prisma.tenant.groupBy({ by: ['status'], _count: { _all: true } });
    const byStatus = Object.fromEntries(
      Object.values(TenantStatus).map((status) => [
        status,
        groups.find((g) => g.status === status)?._count._all ?? 0,
      ]),
    ) as Record<TenantStatus, number>;
    const total = Object.values(byStatus).reduce((sum, n) => sum + n, 0);
    return { total, byStatus };
  }

  // Paginated, newest first: the database may hold thousands of restaurants.
  async list(query: ListPlatformTenantsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? PLATFORM_PAGE_SIZE;
    const search = query.search?.trim();
    const where: Prisma.TenantWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { slug: { contains: search, mode: 'insensitive' } },
              {
                userRoles: {
                  some: {
                    role: { name: 'OWNER' },
                    user: { email: { contains: search, mode: 'insensitive' } },
                  },
                },
              },
            ],
          }
        : {}),
    };
    const [total, rows] = await Promise.all([
      this.prisma.tenant.count({ where }),
      this.prisma.tenant.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          name: true,
          slug: true,
          status: true,
          createdAt: true,
          _count: { select: { branches: true } },
          userRoles: OWNER_EMAIL,
        },
      }),
    ]);
    return {
      items: rows.map((row) => ({
        id: row.id,
        name: row.name,
        slug: row.slug,
        status: row.status,
        createdAt: row.createdAt,
        branchCount: row._count.branches,
        ownerEmail: row.userRoles[0]?.user.email ?? null,
      })),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  // A restaurant as the platform sees it: identity, units, owners and its platform history.
  // Never the password hash, tokens or the restaurant's business data.
  async detail(id: string) {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        legalName: true,
        document: true,
        slug: true,
        status: true,
        timezone: true,
        createdAt: true,
        updatedAt: true,
        branches: {
          orderBy: { createdAt: 'asc' },
          select: { id: true, name: true, code: true, status: true, deliveryEnabled: true },
        },
        userRoles: {
          where: { role: { name: 'OWNER' } },
          orderBy: { createdAt: 'asc' },
          select: { user: { select: { id: true, name: true, email: true, status: true } } },
        },
        _count: { select: { users: true } },
      },
    });
    if (!tenant) throw tenantNotFound();

    const events = await this.prisma.auditLog.findMany({
      where: { entity: 'Tenant', entityId: id, action: { in: [...PLATFORM_ACTIONS] } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        action: true,
        createdAt: true,
        afterData: true,
        user: { select: { name: true, email: true } },
      },
    });
    const history = events.map((event) => ({
      action: event.action,
      at: event.createdAt,
      by: event.user ? { name: event.user.name, email: event.user.email } : null,
      reason: readString(event.afterData, 'reason'),
    }));
    // The main branch is the first one: the one provisioning created.
    const main = tenant.branches[0] ?? null;

    return {
      id: tenant.id,
      name: tenant.name,
      legalName: tenant.legalName,
      document: maskDocument(tenant.document),
      slug: tenant.slug,
      status: tenant.status,
      timezone: tenant.timezone,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
      branches: tenant.branches,
      mainBranchDeliveryEnabled: main?.deliveryEnabled ?? null,
      owners: tenant.userRoles.map((ur) => ur.user),
      userCount: tenant._count.users,
      suspension:
        tenant.status === 'SUSPENDED'
          ? (history.find((event) => event.action === 'PLATFORM_TENANT_SUSPENDED') ?? null)
          : null,
      history,
    };
  }

  // The same creation as `pnpm tenant:provision`: TenantProvisioningService, nothing else. The
  // checks below only make the answer precise for the form (which field clashes); the service
  // checks again inside and its unique indexes settle a race.
  async create(
    admin: AuthenticatedRequestUser,
    dto: ProvisionTenantDto,
    meta: PlatformRequestMeta,
  ) {
    const [bySlug, byDocument, byEmail] = await Promise.all([
      this.prisma.tenant.count({ where: { slug: dto.slug } }),
      this.prisma.tenant.count({ where: { document: dto.document } }),
      findAccountsByLoginEmail(this.prisma, dto.email).then((accounts) => accounts.length),
    ]);
    if (bySlug)
      throw conflict('SLUG_ALREADY_EXISTS', 'slug', 'Já existe um restaurante com este slug.');
    if (byDocument)
      throw conflict(
        'DOCUMENT_ALREADY_EXISTS',
        'document',
        'Já existe um restaurante com este CNPJ/CPF.',
      );
    if (byEmail)
      throw conflict('EMAIL_ALREADY_EXISTS', 'email', 'Já existe uma conta com este e-mail.');

    const created = await this.provisioning.provision(dto, {
      ip: meta.ip,
      userAgent: meta.userAgent,
      actor: `painel /super-admin (${admin.email})`,
      platformAdminUserId: admin.userId,
    });
    return this.detail(created.tenantId);
  }

  // Nothing of the restaurant is deleted or edited: only its status changes, and every token its
  // accounts hold dies now instead of when it expires. Login, refresh, the public menu and
  // public orders already refuse a SUSPENDED tenant.
  async suspend(
    admin: AuthenticatedRequestUser,
    id: string,
    reason: string,
    meta: PlatformRequestMeta,
  ) {
    // Suspending the restaurant your own account belongs to would lock you out of this panel.
    if (id === admin.tenantId) {
      throw new ConflictException({
        code: 'CANNOT_SUSPEND_OWN_TENANT',
        message: 'Você não pode suspender o restaurante ao qual a sua própria conta pertence.',
      });
    }
    const tenant = await this.prisma.tenant.findUnique({ where: { id }, select: { status: true } });
    if (!tenant) throw tenantNotFound();
    if (!SUSPENDABLE.includes(tenant.status)) {
      throw new ConflictException({
        code: 'TENANT_NOT_SUSPENDABLE',
        message:
          tenant.status === 'SUSPENDED'
            ? 'Este restaurante já está suspenso.'
            : 'Um restaurante cancelado não pode ser suspenso.',
      });
    }

    const suspendedAt = Date.now();
    await this.prisma.$transaction(async (tx) => {
      // Only from the status just read: two admins at once, the second gets a 409.
      const changed = await tx.tenant.updateMany({
        where: { id, status: tenant.status },
        data: { status: 'SUSPENDED' },
      });
      if (changed.count === 0) throw statusChanged();
      await this.audit.recordTx(tx, {
        tenantId: id,
        userId: admin.userId,
        action: 'PLATFORM_TENANT_SUSPENDED',
        entity: 'Tenant',
        entityId: id,
        beforeData: { status: tenant.status },
        afterData: { status: 'SUSPENDED', reason },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
    await this.revocations.revokeTenant(id, suspendedAt);
    return this.detail(id);
  }

  // Back to the status it had before the suspension (TRIAL stays TRIAL), read from the
  // suspension's own audit entry; ACTIVE when that cannot be known. No business data changes.
  async reactivate(admin: AuthenticatedRequestUser, id: string, meta: PlatformRequestMeta) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id }, select: { status: true } });
    if (!tenant) throw tenantNotFound();
    if (tenant.status !== 'SUSPENDED') {
      throw new ConflictException({
        code: 'TENANT_NOT_SUSPENDED',
        message: 'Só um restaurante suspenso pode ser reativado.',
      });
    }
    const lastSuspension = await this.prisma.auditLog.findFirst({
      where: { entity: 'Tenant', entityId: id, action: 'PLATFORM_TENANT_SUSPENDED' },
      orderBy: { createdAt: 'desc' },
      select: { beforeData: true },
    });
    const previous = readString(lastSuspension?.beforeData, 'status') as TenantStatus | null;
    const restored: TenantStatus = previous && SUSPENDABLE.includes(previous) ? previous : 'ACTIVE';

    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.tenant.updateMany({
        where: { id, status: 'SUSPENDED' },
        data: { status: restored },
      });
      if (changed.count === 0) throw statusChanged();
      await this.audit.recordTx(tx, {
        tenantId: id,
        userId: admin.userId,
        action: 'PLATFORM_TENANT_REACTIVATED',
        entity: 'Tenant',
        entityId: id,
        beforeData: { status: 'SUSPENDED' },
        afterData: { status: restored },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    });
    return this.detail(id);
  }
}

function readString(data: Prisma.JsonValue | undefined, key: string): string | null {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const value = (data as Prisma.JsonObject)[key];
  return typeof value === 'string' ? value : null;
}

const tenantNotFound = () =>
  new NotFoundException({ code: 'TENANT_NOT_FOUND', message: 'Restaurante não encontrado.' });

const statusChanged = () =>
  new ConflictException({
    code: 'TENANT_STATUS_CHANGED',
    message: 'A situação deste restaurante acabou de mudar. Recarregue a página.',
  });

const conflict = (code: string, field: string, message: string) =>
  new ConflictException({ code, message, details: [{ field, message }] });
