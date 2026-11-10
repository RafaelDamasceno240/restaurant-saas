import { Injectable, NotFoundException } from '@nestjs/common';
import { Branch, Prisma, Tenant } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { UpdateRestaurantProfileDto } from './dto/restaurant-profile.dto';
import {
  isOpenAt,
  normalizeOpeningHours,
  OpeningInterval,
  readOpeningHours,
} from './opening-hours';
import {
  normalizeInstagram,
  normalizePhone,
  normalizeState,
  normalizeZipCode,
} from './profile-input';

const TRANSACTION_OPTIONS = { timeout: 20_000, maxWait: 10_000 };

const TENANT_FIELDS = ['name', 'legalName', 'description', 'instagram'] as const;
const BRANCH_FIELDS = [
  'phone',
  'whatsapp',
  'email',
  'address',
  'number',
  'complement',
  'neighborhood',
  'city',
  'state',
  'zipCode',
  'openingHours',
] as const;
type ProfileField = (typeof TENANT_FIELDS)[number] | (typeof BRANCH_FIELDS)[number];
type ProfileValue = string | OpeningInterval[] | null;

export interface RestaurantProfile {
  name: string;
  legalName: string;
  document: string;
  slug: string;
  timezone: string;
  description: string | null;
  instagram: string | null;
  // The branch that receives online orders: its contact, address and hours are the ones the
  // public menu shows.
  branch: {
    id: string;
    name: string;
    phone: string | null;
    whatsapp: string | null;
    email: string | null;
    address: string | null;
    number: string | null;
    complement: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    openingHours: OpeningInterval[] | null;
  };
  // In the restaurant's time zone; null when the hours were never informed.
  openNow: boolean | null;
}

@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  // "Current tenant" only — Phase 01 has no cross-tenant admin surface.
  async findCurrent(tenantId: string) {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: tenantId } });
    if (!tenant) {
      throw new NotFoundException({ code: 'NOT_FOUND', message: 'Tenant não encontrado.' });
    }
    return tenant;
  }

  async getProfile(tenantId: string): Promise<RestaurantProfile> {
    const branchId = await this.branchAccess.getDefaultBranchId(tenantId);
    const [tenant, branch] = await Promise.all([
      this.findCurrent(tenantId),
      this.prisma.branch.findFirstOrThrow({ where: { id: branchId, tenantId } }),
    ]);
    return toProfile(tenant, branch);
  }

  // Only the keys sent change. The tenant row is locked first, so two editors are applied one
  // after the other and each audit entry holds exactly what that request changed. Nothing is
  // written (and nothing audited) when every value sent is the one already stored.
  async updateProfile(
    user: AuthenticatedRequestUser,
    dto: UpdateRestaurantProfileDto,
  ): Promise<RestaurantProfile> {
    const branchId = await this.branchAccess.getDefaultBranchId(user.tenantId);
    const sent = normalizeDto(dto);

    const { tenant, branch } = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "tenants" WHERE "id" = ${user.tenantId} FOR UPDATE`;
      const tenantBefore = await tx.tenant.findUniqueOrThrow({ where: { id: user.tenantId } });
      const branchBefore = await tx.branch.findFirstOrThrow({
        where: { id: branchId, tenantId: user.tenantId },
      });

      const before: Partial<Record<ProfileField, ProfileValue>> = {};
      const after: Partial<Record<ProfileField, ProfileValue>> = {};
      for (const [field, value] of Object.entries(sent) as [ProfileField, ProfileValue][]) {
        const current = currentValue(tenantBefore, branchBefore, field);
        if (JSON.stringify(current) === JSON.stringify(value)) continue;
        before[field] = current;
        after[field] = value;
      }
      if (Object.keys(after).length === 0) return { tenant: tenantBefore, branch: branchBefore };

      const tenantData: Prisma.TenantUpdateInput = {};
      const branchData: Prisma.BranchUpdateInput = {};
      for (const [field, value] of Object.entries(after) as [ProfileField, ProfileValue][]) {
        if ((TENANT_FIELDS as readonly string[]).includes(field)) {
          (tenantData as Record<string, unknown>)[field] = value;
        } else if (field === 'openingHours') {
          branchData.openingHours =
            value === null ? Prisma.DbNull : (value as Prisma.InputJsonValue);
        } else {
          (branchData as Record<string, unknown>)[field] = value;
        }
      }
      const tenantAfter = Object.keys(tenantData).length
        ? await tx.tenant.update({ where: { id: user.tenantId }, data: tenantData })
        : tenantBefore;
      const branchAfter = Object.keys(branchData).length
        ? await tx.branch.update({ where: { id: branchId }, data: branchData })
        : branchBefore;

      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'RESTAURANT_PROFILE_UPDATED',
        entity: 'Tenant',
        entityId: user.tenantId,
        beforeData: { ...before, branchId },
        afterData: { ...after, branchId },
      });
      return { tenant: tenantAfter, branch: branchAfter };
    }, TRANSACTION_OPTIONS);

    return toProfile(tenant, branch);
  }
}

// The DTO already refused anything the normalizers reject, so a normalizer never turns a value
// that was sent into null: a null here always comes from an explicit null ("clear the field").
function normalizeDto(
  dto: UpdateRestaurantProfileDto,
): Partial<Record<ProfileField, ProfileValue>> {
  const normalizers: Record<ProfileField, (value: never) => ProfileValue> = {
    name: (v: string) => v,
    legalName: (v: string) => v,
    description: (v: string | null) => v,
    instagram: (v: string | null) => (v === null ? null : normalizeInstagram(v)),
    phone: (v: string | null) => (v === null ? null : normalizePhone(v)),
    whatsapp: (v: string | null) => (v === null ? null : normalizePhone(v)),
    email: (v: string | null) => (v === null ? null : v.toLowerCase()),
    address: (v: string | null) => v,
    number: (v: string | null) => v,
    complement: (v: string | null) => v,
    neighborhood: (v: string | null) => v,
    city: (v: string | null) => v,
    state: (v: string | null) => (v === null ? null : normalizeState(v)),
    zipCode: (v: string | null) => (v === null ? null : normalizeZipCode(v)),
    openingHours: (v: OpeningInterval[] | null) => (v === null ? null : normalizeOpeningHours(v)),
  };
  const sent: Partial<Record<ProfileField, ProfileValue>> = {};
  for (const field of [...TENANT_FIELDS, ...BRANCH_FIELDS]) {
    const value = dto[field];
    if (value !== undefined) sent[field] = normalizers[field](value as never) ?? null;
  }
  return sent;
}

function currentValue(tenant: Tenant, branch: Branch, field: ProfileField): ProfileValue {
  if (field === 'openingHours') return readOpeningHours(branch.openingHours);
  if ((TENANT_FIELDS as readonly string[]).includes(field))
    return tenant[field as (typeof TENANT_FIELDS)[number]];
  return branch[field as Exclude<(typeof BRANCH_FIELDS)[number], 'openingHours'>];
}

function toProfile(tenant: Tenant, branch: Branch, now = new Date()): RestaurantProfile {
  const openingHours = readOpeningHours(branch.openingHours);
  return {
    name: tenant.name,
    legalName: tenant.legalName,
    document: tenant.document,
    slug: tenant.slug,
    timezone: tenant.timezone,
    description: tenant.description,
    instagram: tenant.instagram,
    branch: {
      id: branch.id,
      name: branch.name,
      phone: branch.phone,
      whatsapp: branch.whatsapp,
      email: branch.email,
      address: branch.address,
      number: branch.number,
      complement: branch.complement,
      neighborhood: branch.neighborhood,
      city: branch.city,
      state: branch.state,
      zipCode: branch.zipCode,
      openingHours,
    },
    openNow: isOpenAt(openingHours, now, tenant.timezone),
  };
}
