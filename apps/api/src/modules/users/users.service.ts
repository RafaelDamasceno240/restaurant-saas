import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, RoleName, UserStatus } from '@prisma/client';
import * as argon2 from 'argon2';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { AuditService } from '../audit/audit.service';
import { findAccountsByLoginEmail } from '../../common/util/login-email.util';
import { SessionRevocationService } from '../auth/session-revocation.service';
import { CreateUserDto, ResetUserPasswordDto, UpdateUserDto } from './dto/users.dto';
import { canAssignRole, canManageUser, roleNeedsBranch } from './user-rules';

type Tx = Prisma.TransactionClient;

const userInclude = {
  userRoles: { include: { role: true } },
  userBranches: { select: { branchId: true } },
} satisfies Prisma.UserInclude;

type UserWithAccess = Prisma.UserGetPayload<{ include: typeof userInclude }>;

const notFound = () => new NotFoundException({ code: 'NOT_FOUND', message: 'Usuário não encontrado.' });
const emailTaken = () =>
  new ConflictException({ code: 'EMAIL_ALREADY_EXISTS', message: 'Já existe uma conta com este e-mail.' });
const roleNotAssignable = () =>
  new ForbiddenException({
    code: 'ROLE_NOT_ASSIGNABLE',
    message: 'Você não pode atribuir este papel.',
  });
const userProtected = () =>
  new ForbiddenException({
    code: 'USER_PROTECTED',
    message: 'Você não pode alterar esta conta.',
  });
const cannotManageSelf = () =>
  new ForbiddenException({
    code: 'CANNOT_MANAGE_SELF',
    message: 'Você não pode alterar a própria conta por aqui.',
  });
const branchesRequired = () =>
  new BadRequestException({
    code: 'BRANCHES_REQUIRED',
    message: 'Informe ao menos uma unidade para este funcionário.',
  });

// Every method takes the tenant from the authenticated request (CurrentUser), never from a
// route param, query string or body — this is what keeps tenant A from ever seeing or changing
// tenant B's users.
//
// Staff accounts (create, update, reset-password) follow three rules on top of the
// `users.*` permissions the controller checks:
//   1. who may touch whom is decided by user-rules.ts (OWNER untouchable, ADMIN only by OWNER);
//   2. nobody changes their own account here — the password has /auth/change-password, and a
//      role or status change on yourself is how a restaurant locks itself out;
//   3. an access token carries the roles and permissions it was issued with, so whatever
//      changes what the account may do (role, deactivation, password) ends its sessions: the
//      refresh tokens in the same transaction, the access tokens right after the commit.
@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly revocations: SessionRevocationService,
  ) {}

  async findAllForTenant(tenantId: string) {
    const users = await this.prisma.user.findMany({
      where: { tenantId },
      include: userInclude,
      orderBy: { createdAt: 'asc' },
    });
    return users.map((u) => this.toDto(u));
  }

  async findOneForTenant(tenantId: string, userId: string) {
    const user = await this.prisma.user.findFirst({
      where: { id: userId, tenantId },
      include: userInclude,
    });
    // Same 404 whether the id doesn't exist at all or belongs to another
    // tenant — never reveal cross-tenant existence.
    if (!user) {
      throw notFound();
    }
    return this.toDto(user);
  }

  async create(actor: AuthenticatedRequestUser, dto: CreateUserDto) {
    if (!canAssignRole(actor.roles, dto.role)) throw roleNotAssignable();
    const tenantId = actor.tenantId;
    const passwordHash = await argon2.hash(dto.password);

    let userId: string;
    try {
      userId = await this.prisma.$transaction(async (tx) => {
        const branchIds = await this.resolveBranchIds(tx, tenantId, dto.role, dto.branchIds);
        // E-mail is the login and is unique across restaurants, as in the registration, in any
        // case (login-email.util.ts): the unique index alone would let "Ana@x" in next to "ana@x".
        const existing = await findAccountsByLoginEmail(tx, dto.email);
        if (existing.length > 0) throw emailTaken();

        const role = await tx.role.findUniqueOrThrow({ where: { name: dto.role } });
        const user = await tx.user.create({
          data: { tenantId, name: dto.name, email: dto.email, passwordHash, status: 'ACTIVE' },
        });
        await tx.userRole.create({ data: { userId: user.id, roleId: role.id, tenantId } });
        await this.replaceBranches(tx, tenantId, user.id, branchIds);
        // The trail says what the account may do, never who the person is or the password.
        await this.audit.recordTx(tx, {
          tenantId,
          userId: actor.userId,
          action: 'USER_CREATED',
          entity: 'User',
          entityId: user.id,
          afterData: { role: dto.role, status: 'ACTIVE', branchIds },
        });
        return user.id;
      });
    } catch (error) {
      // Two simultaneous creations with the same e-mail: the unique key settles it.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw emailTaken();
      }
      throw error;
    }
    return this.findOneForTenant(tenantId, userId);
  }

  async update(actor: AuthenticatedRequestUser, userId: string, dto: UpdateUserDto) {
    const tenantId = actor.tenantId;
    if (userId === actor.userId) throw cannotManageSelf();

    const sessionsEnded = await this.prisma.$transaction(async (tx) => {
      const target = await this.lockTarget(tx, actor, userId);
      const currentRoles = target.userRoles.map((ur) => ur.role.name);
      const currentBranchIds = target.userBranches.map((ub) => ub.branchId);

      if (dto.role !== undefined && !canAssignRole(actor.roles, dto.role)) throw roleNotAssignable();
      const roleChanges = dto.role !== undefined && !(currentRoles.length === 1 && currentRoles[0] === dto.role);
      const role: RoleName | null = dto.role ?? currentRoles[0] ?? null;

      // Branches: an explicit list replaces the links; a role change alone keeps them, unless
      // the new role needs a branch and the account has none (e.g. ADMIN -> CASHIER).
      let branchIds = currentBranchIds;
      if (dto.branchIds !== undefined) {
        branchIds = await this.resolveBranchIds(tx, tenantId, role, dto.branchIds);
      } else if (roleChanges && role && roleNeedsBranch(role) && currentBranchIds.length === 0) {
        branchIds = await this.resolveBranchIds(tx, tenantId, role, undefined);
      }
      const branchesChange =
        branchIds.length !== currentBranchIds.length || branchIds.some((id) => !currentBranchIds.includes(id));

      const status: UserStatus = dto.active === undefined ? target.status : dto.active ? 'ACTIVE' : 'INACTIVE';
      const statusChanges = status !== target.status;
      const nameChanges = dto.name !== undefined && dto.name !== target.name;

      if (!roleChanges && !branchesChange && !statusChanges && !nameChanges) return false;

      if (nameChanges || statusChanges) {
        await tx.user.update({ where: { id: userId }, data: { name: dto.name ?? target.name, status } });
      }
      if (roleChanges && dto.role) {
        const newRole = await tx.role.findUniqueOrThrow({ where: { name: dto.role } });
        await tx.userRole.deleteMany({ where: { userId, tenantId } });
        await tx.userRole.create({ data: { userId, roleId: newRole.id, tenantId } });
      }
      if (branchesChange) {
        await this.replaceBranches(tx, tenantId, userId, branchIds);
      }

      // Branch links are re-read on every request, so only a new role or a deactivation
      // leaves a stale access token behind.
      const endSessions = roleChanges || (statusChanges && status !== 'ACTIVE');
      if (endSessions) await this.revokeRefreshTokens(tx, userId);

      await this.audit.recordTx(tx, {
        tenantId,
        userId: actor.userId,
        action: 'USER_UPDATED',
        entity: 'User',
        entityId: userId,
        beforeData: { roles: currentRoles, status: target.status, branchIds: currentBranchIds },
        afterData: {
          roles: roleChanges && dto.role ? [dto.role] : currentRoles,
          status,
          branchIds,
          ...(nameChanges ? { fields: ['name'] } : {}),
        },
      });
      return endSessions;
    });

    if (sessionsEnded) await this.revocations.revokeUser(userId);
    return this.findOneForTenant(tenantId, userId);
  }

  // The manager types the new password and hands it to the person; there is no e-mail flow.
  // Every session of the account ends, so whoever knew the old password is out.
  async resetPassword(actor: AuthenticatedRequestUser, userId: string, dto: ResetUserPasswordDto): Promise<void> {
    const tenantId = actor.tenantId;
    if (userId === actor.userId) throw cannotManageSelf();
    const passwordHash = await argon2.hash(dto.password);

    await this.prisma.$transaction(async (tx) => {
      await this.lockTarget(tx, actor, userId);
      await tx.user.update({ where: { id: userId }, data: { passwordHash } });
      await this.revokeRefreshTokens(tx, userId);
      await this.audit.recordTx(tx, {
        tenantId,
        userId: actor.userId,
        action: 'USER_PASSWORD_RESET',
        entity: 'User',
        entityId: userId,
      });
    });

    await this.revocations.revokeUser(userId);
    // A refresh that was already past its own checks when the transaction committed may have
    // written a new refresh token since: this second pass takes it too.
    await this.prisma.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  // Locks the account row (two managers editing the same person serialize) and applies the
  // "who may touch whom" rule on what is read AFTER the lock.
  private async lockTarget(tx: Tx, actor: AuthenticatedRequestUser, userId: string): Promise<UserWithAccess> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT "id" FROM "users" WHERE "id" = ${userId} AND "tenantId" = ${actor.tenantId} FOR UPDATE`;
    if (rows.length === 0) throw notFound();
    const target = await tx.user.findUniqueOrThrow({ where: { id: userId }, include: userInclude });
    if (
      !canManageUser(
        actor.roles,
        target.userRoles.map((ur) => ur.role.name),
      )
    ) {
      throw userProtected();
    }
    return target;
  }

  // Which branches the account ends up linked to. Every id must be an ACTIVE branch of the
  // caller's tenant (same 404 for "doesn't exist" and "another restaurant's"). When no list
  // is sent, a role that needs a branch gets the restaurant's only one — or is refused when
  // there are several to choose from.
  private async resolveBranchIds(
    tx: Tx,
    tenantId: string,
    role: RoleName | null,
    requested: string[] | undefined,
  ): Promise<string[]> {
    const needsBranch = role !== null && roleNeedsBranch(role);
    if (requested === undefined) {
      if (!needsBranch) return [];
      const active = await tx.branch.findMany({
        where: { tenantId, status: 'ACTIVE' },
        select: { id: true },
        take: 2,
      });
      if (active.length !== 1) throw branchesRequired();
      return [active[0].id];
    }

    const ids = Array.from(new Set(requested));
    if (ids.length === 0) {
      if (needsBranch) throw branchesRequired();
      return [];
    }
    const found = await tx.branch.count({ where: { id: { in: ids }, tenantId, status: 'ACTIVE' } });
    if (found !== ids.length) {
      throw new NotFoundException({ code: 'BRANCH_NOT_FOUND', message: 'Unidade não encontrada.' });
    }
    return ids;
  }

  private async replaceBranches(tx: Tx, tenantId: string, userId: string, branchIds: string[]): Promise<void> {
    await tx.userBranch.deleteMany({ where: { userId, branch: { tenantId } } });
    if (branchIds.length > 0) {
      await tx.userBranch.createMany({ data: branchIds.map((branchId) => ({ userId, branchId })) });
    }
  }

  private async revokeRefreshTokens(tx: Tx, userId: string): Promise<void> {
    await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  private toDto(user: UserWithAccess) {
    return {
      id: user.id,
      tenantId: user.tenantId,
      name: user.name,
      email: user.email,
      status: user.status,
      lastLoginAt: user.lastLoginAt,
      createdAt: user.createdAt,
      roles: user.userRoles.map((ur) => ur.role.name),
      branchIds: user.userBranches.map((ub) => ub.branchId),
    };
  }
}
