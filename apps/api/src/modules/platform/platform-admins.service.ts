import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { findAccountIdByLoginEmail } from '../../common/util/login-email.util';

export interface PlatformAdminCandidate {
  id: string;
  name: string;
  email: string;
  status: string;
  roles: string[];
  tenant: { name: string; slug: string; status: string };
  isPlatformAdmin: boolean;
}

// Grants and revokes platform administration. Only the local CLI calls this
// (src/cli/platform-admin.ts): no route does, so becoming a platform administrator always takes
// someone who holds DATABASE_URL. It never creates an account; the person must already exist.
@Injectable()
export class PlatformAdminsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // In any case, like the login (login-email.util.ts): used by the grant/revoke and the
  // password reset commands.
  async findByEmail(email: string): Promise<PlatformAdminCandidate | null> {
    const id = await findAccountIdByLoginEmail(this.prisma, email);
    if (!id) return null;
    const user = await this.prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        name: true,
        email: true,
        status: true,
        tenant: { select: { name: true, slug: true, status: true } },
        userRoles: { select: { role: { select: { name: true } } } },
        platformAdmin: { select: { id: true } },
      },
    });
    if (!user) return null;
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      status: user.status,
      roles: user.userRoles.map((ur) => ur.role.name),
      tenant: user.tenant,
      isPlatformAdmin: user.platformAdmin !== null,
    };
  }

  count(): Promise<number> {
    return this.prisma.platformAdmin.count();
  }

  // Both return false when there was nothing to do (already granted / not granted): the CLI
  // reports it, and running it twice changes nothing.
  async grant(userId: string, actor: string, userAgent: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { tenantId: true, email: true, platformAdmin: { select: { id: true } } },
      });
      if (user.platformAdmin) return false;
      await tx.platformAdmin.create({ data: { userId, grantedBy: actor } });
      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId,
        action: 'PLATFORM_ADMIN_GRANTED',
        entity: 'User',
        entityId: userId,
        afterData: { email: user.email, grantedBy: actor },
        userAgent,
      });
      return true;
    });
  }

  async revoke(userId: string, actor: string, userAgent: string): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { tenantId: true, email: true },
      });
      const removed = await tx.platformAdmin.deleteMany({ where: { userId } });
      if (removed.count === 0) return false;
      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId,
        action: 'PLATFORM_ADMIN_REVOKED',
        entity: 'User',
        entityId: userId,
        afterData: { email: user.email, revokedBy: actor },
        userAgent,
      });
      return true;
    });
  }
}
