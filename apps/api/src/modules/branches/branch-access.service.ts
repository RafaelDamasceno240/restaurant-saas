import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Branch } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';

// Single source of truth (fatia 08) for "may this user operate this branch?".
// The active branch is passed explicitly per request (never trusted, never
// stored in the JWT) and ALWAYS re-validated here:
//   1. the branch must belong to the caller's tenant (from the JWT) and be ACTIVE;
//   2. OWNER/ADMIN may operate any branch of their tenant;
//   3. everyone else needs an explicit UserBranch link.
@Injectable()
export class BranchAccessService {
  constructor(private readonly prisma: PrismaService) {}

  private isTenantWide(user: AuthenticatedRequestUser): boolean {
    return user.roles.includes('OWNER') || user.roles.includes('ADMIN');
  }

  async assertAccess(user: AuthenticatedRequestUser, branchId: string): Promise<Branch> {
    const branch = await this.prisma.branch.findFirst({
      where: { id: branchId, tenantId: user.tenantId, status: 'ACTIVE' },
    });
    // Same 404 for "doesn't exist" and "another tenant's branch" — never
    // reveal cross-tenant existence.
    if (!branch) {
      throw new NotFoundException({ code: 'BRANCH_NOT_FOUND', message: 'Unidade não encontrada.' });
    }
    if (this.isTenantWide(user)) return branch;

    const link = await this.prisma.userBranch.findUnique({
      where: { userId_branchId: { userId: user.userId, branchId } },
    });
    if (!link) {
      throw new ForbiddenException({
        code: 'BRANCH_ACCESS_DENIED',
        message: 'Você não tem acesso a esta unidade.',
      });
    }
    return branch;
  }

  async accessibleBranchIds(user: AuthenticatedRequestUser): Promise<string[] | null> {
    if (this.isTenantWide(user)) return null;
    const links = await this.prisma.userBranch.findMany({
      where: { userId: user.userId, branch: { tenantId: user.tenantId, status: 'ACTIVE' } },
      select: { branchId: true },
    });
    return links.map((link) => link.branchId);
  }

  listAccessible(user: AuthenticatedRequestUser) {
    return this.prisma.branch.findMany({
      where: {
        tenantId: user.tenantId,
        status: 'ACTIVE',
        ...(this.isTenantWide(user) ? {} : { userBranches: { some: { userId: user.userId } } }),
      },
      select: { id: true, name: true, code: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  // Online checkout (public, no user) has no branch choice yet in the MVP:
  // orders go to the tenant's oldest ACTIVE branch (the "MATRIZ" created at
  // registration). Documented simplification — see CASH_REGISTER_PLAN.md.
  async getDefaultBranchId(tenantId: string): Promise<string> {
    const branch = await this.prisma.branch.findFirst({
      where: { tenantId, status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    if (!branch) {
      throw new NotFoundException({
        code: 'BRANCH_NOT_FOUND',
        message: 'Restaurante sem unidade ativa para receber pedidos.',
      });
    }
    return branch.id;
  }
}
