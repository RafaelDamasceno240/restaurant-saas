import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';

export const PLATFORM_ADMIN_REQUIRED = {
  code: 'PLATFORM_ADMIN_REQUIRED',
  message: 'Acesso restrito à administração da plataforma.',
};

// The only door to the routes that cross tenants (/platform/*). It runs after the global
// JwtAuthGuard, so an anonymous request is already a 401 here. Nothing in the token decides it:
// not the roles (OWNER and ADMIN administer ONE restaurant), not the permissions, not a claim.
// The platform_admins table is read on every request, so a grant revoked by the CLI takes
// effect on the next call, and an account that stopped being ACTIVE loses it with its status.
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const user = context.switchToHttp().getRequest().user as AuthenticatedRequestUser | undefined;
    if (!user?.userId) throw new ForbiddenException(PLATFORM_ADMIN_REQUIRED);

    const grant = await this.prisma.platformAdmin.findUnique({
      where: { userId: user.userId },
      select: { user: { select: { status: true } } },
    });
    if (!grant || grant.user.status !== 'ACTIVE')
      throw new ForbiddenException(PLATFORM_ADMIN_REQUIRED);
    return true;
  }
}
