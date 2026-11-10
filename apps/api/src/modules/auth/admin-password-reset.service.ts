import { Injectable } from '@nestjs/common';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SessionRevocationService } from './session-revocation.service';

export interface AdminPasswordResetResult {
  // Sessions that were still valid (unexpired refresh tokens) and ended with the reset.
  sessionsEnded: number;
  // Whether the access-token cut-off could be read back from Redis (see reset()).
  accessTokensCut: boolean;
}

// Sets a new password on an account whose owner no longer knows the current one, for the cases
// the panel cannot cover (the OWNER, or a restaurant with nobody left to reset it). Only the local
// CLI calls this (src/cli/reset-password.ts): no route does, so it always takes someone who holds
// DATABASE_URL. Roles, restaurant and platform administration are not touched.
@Injectable()
export class AdminPasswordResetService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly revocations: SessionRevocationService,
  ) {}

  activeSessions(userId: string): Promise<number> {
    return this.prisma.refreshToken.count({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  // Same steps as the manager's reset (UsersService.resetPassword): every session ends, so
  // whoever knew the old password is out.
  async reset(
    userId: string,
    password: string,
    actor: string,
    userAgent: string,
  ): Promise<AdminPasswordResetResult> {
    const passwordHash = await argon2.hash(password);

    const ended = await this.prisma.$transaction(async (tx) => {
      const user = await tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: { tenantId: true, email: true },
      });
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      // Expired tokens never marked revoked are revoked too, but are not sessions anymore.
      const now = new Date();
      const count = await tx.refreshToken.count({
        where: { userId, revokedAt: null, expiresAt: { gt: now } },
      });
      await tx.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId,
        action: 'ADMIN_PASSWORD_RESET',
        entity: 'User',
        entityId: userId,
        afterData: { email: user.email, resetBy: actor, sessionsEnded: count },
        userAgent,
      });
      return count;
    });

    const at = Date.now();
    await this.revocations.revokeUser(userId, at);
    // A refresh that was already past its own checks when the transaction committed may have
    // written a new refresh token since: this second pass takes it too.
    const late = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });
    // The denylist swallows a failed write (a logout must not fail because of it); the operator
    // must know. Read the mark back through the same check the API runs on every request.
    const accessTokensCut = await this.revocations.isRevoked({ userId, issuedAtMs: at });
    return { sessionsEnded: ended + late.count, accessTokensCut };
  }
}
