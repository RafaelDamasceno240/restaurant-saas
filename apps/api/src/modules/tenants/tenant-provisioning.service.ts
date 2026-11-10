import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { validationException } from '../../common/validation/validation-messages';
import { findAccountsByLoginEmail } from '../../common/util/login-email.util';
import { ProvisionTenantDto } from './dto/provision-tenant.dto';

// Who asked for it, recorded with the audit entry. The CLI (src/cli/provision-tenant.ts) and the
// platform panel (PlatformTenantsService) fill it; no field of it comes from a request body.
export interface ProvisionMeta {
  ip?: string;
  userAgent?: string;
  actor?: string;
  // The platform administrator who created it from /super-admin: their own audit entry,
  // PLATFORM_TENANT_CREATED, goes in the same transaction.
  platformAdminUserId?: string;
}

export interface ProvisionedTenant {
  tenantId: string;
  branchId: string;
  ownerUserId: string;
}

// Creates a restaurant: the Tenant, its first Branch and the OWNER account. The service is not
// self-service (2026-10-28): a restaurant exists because it was sold, never because a visitor
// filled a form, so no public route reaches it. Its callers are the administrative CLI
// (src/cli/provision-tenant.ts, run by whoever holds DATABASE_URL), the platform panel
// (POST /platform/tenants, platform administrators only) and the e2e helpers. It signs nobody in:
// the owner logs in through POST /auth/login like any other account.
@Injectable()
export class TenantProvisioningService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async provision(input: ProvisionTenantDto, meta: ProvisionMeta = {}): Promise<ProvisionedTenant> {
    // The same rules a request body would get, whoever the caller is.
    const dto = plainToInstance(ProvisionTenantDto, input);
    const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    if (errors.length > 0) {
      throw validationException(errors);
    }

    const [existingTenant, existingUser] = await Promise.all([
      this.prisma.tenant.findFirst({
        where: { OR: [{ slug: dto.slug }, { document: dto.document }] },
      }),
      // In any case: "Ana@x.com" and "ana@x.com" are the same login (login-email.util.ts).
      findAccountsByLoginEmail(this.prisma, dto.email).then((accounts) => accounts[0] ?? null),
    ]);

    if (existingTenant) {
      throw new ConflictException({
        code: 'TENANT_ALREADY_EXISTS',
        message: 'Já existe um restaurante com este slug ou documento.',
      });
    }
    if (existingUser) {
      throw new ConflictException({
        code: 'EMAIL_ALREADY_EXISTS',
        message: 'Já existe uma conta com este e-mail.',
      });
    }

    const passwordHash = await argon2.hash(dto.password);

    // Tenant + Branch + User + OWNER role assignment + UserBranch + the audit entry must all
    // succeed together or not at all.
    const provisioned = await this.prisma
      .$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name: dto.tenantName,
            legalName: dto.legalName,
            document: dto.document,
            slug: dto.slug,
            status: 'TRIAL',
          },
        });

        const branch = await tx.branch.create({
          data: {
            tenantId: tenant.id,
            name: dto.branchName,
            code: 'MATRIZ',
            // B11 (piloto 2026-10-23): a new restaurant does NOT take delivery orders until the owner
            // sets the fee and the minimum and turns it on (Delivery > Configurações de entrega).
            // Only here: the column default stays true, so no existing branch changes.
            deliveryEnabled: false,
          },
        });

        const owner = await tx.user.create({
          data: {
            tenantId: tenant.id,
            name: dto.userName,
            email: dto.email,
            passwordHash,
            status: 'ACTIVE',
          },
        });

        const ownerRole = await tx.role.findUniqueOrThrow({ where: { name: 'OWNER' } });

        await tx.userRole.create({
          data: { userId: owner.id, roleId: ownerRole.id, tenantId: tenant.id },
        });

        await tx.userBranch.create({
          data: { userId: owner.id, branchId: branch.id },
        });

        await this.audit.recordTx(tx, {
          tenantId: tenant.id,
          userId: owner.id,
          action: 'TENANT_PROVISIONED',
          entity: 'Tenant',
          entityId: tenant.id,
          afterData: {
            slug: dto.slug,
            ownerEmail: dto.email,
            ...(meta.actor ? { provisionedBy: meta.actor } : {}),
          },
          ip: meta.ip,
          userAgent: meta.userAgent,
        });

        if (meta.platformAdminUserId) {
          await this.audit.recordTx(tx, {
            tenantId: tenant.id,
            userId: meta.platformAdminUserId,
            action: 'PLATFORM_TENANT_CREATED',
            entity: 'Tenant',
            entityId: tenant.id,
            afterData: { name: dto.tenantName, slug: dto.slug, ownerEmail: dto.email },
            ip: meta.ip,
            userAgent: meta.userAgent,
          });
        }

        return { tenantId: tenant.id, branchId: branch.id, ownerUserId: owner.id };
      })
      .catch((error: unknown) => {
        // Two provisionings of the same slug, document or e-mail at once both pass the checks
        // above; the unique index stops the second one, and it gets the same answer.
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          const target = String(error.meta?.target ?? '');
          throw new ConflictException(
            target.includes('email')
              ? { code: 'EMAIL_ALREADY_EXISTS', message: 'Já existe uma conta com este e-mail.' }
              : {
                  code: 'TENANT_ALREADY_EXISTS',
                  message: 'Já existe um restaurante com este slug ou documento.',
                },
          );
        }
        throw error;
      });

    return provisioned;
  }
}
