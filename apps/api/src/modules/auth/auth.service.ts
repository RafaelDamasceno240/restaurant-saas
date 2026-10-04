import {
  ConflictException,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RoleName, User } from '@prisma/client';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { AppConfig } from '../../config/configuration';
import { AuditService } from '../audit/audit.service';
import { isTenantBlocked } from '../../common/util/tenant-status.util';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { durationToMs, hashToken } from './token.util';
import { AccessTokenPayload } from './strategies/jwt.strategy';
import { SessionRevocationService } from './session-revocation.service';

const REFRESH_REUSE_GRACE_MS = 10_000;

// Hash of a password nobody has. A login for an unknown e-mail verifies against it, so "no such
// account" costs the same argon2 work as "wrong password" and the response time does not tell
// the two apart. Computed once, on first use.
let unknownAccountHash: Promise<string> | null = null;
const hashForUnknownAccount = (): Promise<string> => (unknownAccountHash ??= argon2.hash(randomUUID()));

// `sid` ties the refresh token to its session; refresh tokens issued before it existed lack it.
interface RefreshTokenPayload {
  sub: string;
  jti: string;
  sid?: string;
}

export interface RequestMeta {
  ip?: string;
  userAgent?: string;
}

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  accessExpiresInSeconds: number;
  refreshExpiresAt: Date;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  refreshExpiresAt: Date;
  expiresIn: number;
  user: {
    id: string;
    tenantId: string;
    name: string;
    email: string;
    roles: RoleName[];
  };
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<AppConfig, true>,
    private readonly audit: AuditService,
    private readonly revocations: SessionRevocationService,
  ) {}

  async register(dto: RegisterDto, meta: RequestMeta): Promise<AuthResult> {
    const [existingTenant, existingUser] = await Promise.all([
      this.prisma.tenant.findFirst({
        where: { OR: [{ slug: dto.slug }, { document: dto.document }] },
      }),
      this.prisma.user.findUnique({ where: { email: dto.email } }),
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

    // Tenant + Branch + User + OWNER role assignment + UserBranch must all
    // succeed together or not at all.
    const { user, tenantId } = await this.prisma.$transaction(async (tx) => {
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
        },
      });

      const createdUser = await tx.user.create({
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
        data: { userId: createdUser.id, roleId: ownerRole.id, tenantId: tenant.id },
      });

      await tx.userBranch.create({
        data: { userId: createdUser.id, branchId: branch.id },
      });

      return { user: createdUser, tenantId: tenant.id };
    });

    await this.audit.record({
      tenantId,
      userId: user.id,
      action: 'TENANT_REGISTERED',
      entity: 'Tenant',
      entityId: tenantId,
      afterData: { slug: dto.slug, ownerEmail: dto.email },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return this.issueTokensFor(user, meta);
  }

  async login(dto: LoginDto, meta: RequestMeta): Promise<AuthResult> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
      include: { tenant: { select: { status: true } } },
    });

    // Same error for "no such user" and "wrong password" to avoid
    // user-enumeration.
    const invalidCredentials = () =>
      new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'E-mail ou senha inválidos.' });

    if (!user) {
      await argon2.verify(await hashForUnknownAccount(), dto.password);
      throw invalidCredentials();
    }

    // The password is checked BEFORE anything is said about the account: whether it exists, is
    // blocked or belongs to a suspended restaurant is only told to someone who proved to own it.
    const passwordValid = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordValid) {
      await this.audit.record({
        tenantId: user.tenantId,
        userId: user.id,
        action: 'LOGIN_FAILED',
        entity: 'User',
        entityId: user.id,
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      throw invalidCredentials();
    }

    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        code: 'USER_NOT_ACTIVE',
        message: 'Esta conta não está ativa.',
      });
    }

    if (isTenantBlocked(user.tenant.status)) {
      throw new ForbiddenException({ code: 'TENANT_NOT_ACTIVE', message: 'Este restaurante está suspenso.' });
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.id,
      action: 'LOGIN_SUCCEEDED',
      entity: 'User',
      entityId: user.id,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return this.issueTokensFor(user, meta);
  }

  async refresh(rawRefreshToken: string, meta: RequestMeta): Promise<AuthResult> {
    const invalid = () =>
      new UnauthorizedException({ code: 'INVALID_REFRESH_TOKEN', message: 'Sessão inválida ou expirada.' });

    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync(rawRefreshToken, {
        secret: this.config.get('jwt', { infer: true }).refreshSecret,
      });
    } catch {
      throw invalid();
    }

    const tokenHash = hashToken(rawRefreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.expiresAt < new Date() || stored.userId !== payload.sub) {
      throw invalid();
    }

    if (stored.revokedAt) {
      if (Date.now() - stored.revokedAt.getTime() > REFRESH_REUSE_GRACE_MS) {
        await this.prisma.refreshToken.updateMany({
          where: { userId: stored.userId, revokedAt: null },
          data: { revokedAt: new Date() },
        });
        // Whoever holds the stolen token may also hold an access token bought with it: every
        // access token the user has right now dies with the refresh tokens.
        await this.revocations.revokeUser(stored.userId);
        await this.audit.record({
          userId: stored.userId,
          action: 'REFRESH_TOKEN_REUSE_DETECTED',
          entity: 'User',
          entityId: stored.userId,
          ip: meta.ip,
          userAgent: meta.userAgent,
        });
      }
      throw invalid();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: stored.userId },
      include: { tenant: { select: { status: true } } },
    });
    if (!user || user.status !== 'ACTIVE' || isTenantBlocked(user.tenant.status)) {
      throw invalid();
    }

    const claimed = await this.prisma.refreshToken.updateMany({
      where: { id: stored.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (claimed.count === 0) {
      throw invalid();
    }

    // Rotation renews the tokens, not the session: the same `sid` goes on.
    const result = await this.issueTokensFor(user, meta, payload.sid);
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { replacedBy: hashToken(result.refreshToken) },
    });

    return result;
  }

  // Ends the session the refresh token belongs to. The token itself is the
  // credential: it is signed with the refresh secret and matched by hash to a
  // row of its own user, so the caller cannot choose whose session ends — and
  // no access token is needed, which keeps logout working after it expired.
  // Anything else (no cookie, bad signature, expired, already revoked) ends
  // nothing and says nothing.
  async logout(rawRefreshToken: string | undefined, meta: RequestMeta): Promise<void> {
    if (!rawRefreshToken) {
      return;
    }

    let payload: RefreshTokenPayload;
    try {
      payload = await this.jwt.verifyAsync(rawRefreshToken, {
        secret: this.config.get('jwt', { infer: true }).refreshSecret,
      });
    } catch {
      return;
    }

    const revoked = await this.prisma.refreshToken.updateMany({
      where: { tokenHash: hashToken(rawRefreshToken), userId: payload.sub, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (revoked.count === 0) {
      return;
    }

    // The refresh token is dead; this makes the access token of the same session die with it
    // instead of staying valid until it expires.
    if (payload.sid) {
      await this.revocations.revokeSession(payload.sid);
    }

    await this.audit.record({
      userId: payload.sub,
      action: 'LOGOUT',
      entity: 'User',
      entityId: payload.sub,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      include: {
        tenant: true,
        userRoles: { include: { role: true } },
      },
    });
    return {
      id: user.id,
      tenantId: user.tenantId,
      tenant: { id: user.tenant.id, name: user.tenant.name, slug: user.tenant.slug },
      name: user.name,
      email: user.email,
      status: user.status,
      roles: user.userRoles.map((ur) => ur.role.name),
    };
  }

  // `sessionId` is passed only by refresh(), to keep the session it is renewing; login and
  // register start a new one.
  private async issueTokensFor(
    user: User,
    meta: RequestMeta,
    sessionId: string = randomUUID(),
  ): Promise<AuthResult> {
    const { roles, permissions } = await this.loadRolesAndPermissions(user.id, user.tenantId);
    const jwtConfig = this.config.get('jwt', { infer: true });

    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      roles,
      permissions,
      jti: randomUUID(),
      sid: sessionId,
      iatMs: Date.now(),
    };
    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: jwtConfig.accessSecret,
      expiresIn: jwtConfig.accessExpiresIn,
    });

    const refreshPayload: RefreshTokenPayload = { sub: user.id, jti: randomUUID(), sid: sessionId };
    const refreshToken = await this.jwt.signAsync(refreshPayload, {
      secret: jwtConfig.refreshSecret,
      expiresIn: jwtConfig.refreshExpiresIn,
    });
    const refreshExpiresAt = new Date(Date.now() + durationToMs(jwtConfig.refreshExpiresIn));

    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        expiresAt: refreshExpiresAt,
        ip: meta.ip,
        userAgent: meta.userAgent,
      },
    });

    return {
      accessToken,
      refreshToken,
      refreshExpiresAt,
      expiresIn: Math.floor(durationToMs(jwtConfig.accessExpiresIn) / 1000),
      user: {
        id: user.id,
        tenantId: user.tenantId,
        name: user.name,
        email: user.email,
        roles,
      },
    };
  }

  private async loadRolesAndPermissions(
    userId: string,
    tenantId: string,
  ): Promise<{ roles: RoleName[]; permissions: string[] }> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId, tenantId },
      include: { role: { include: { rolePermissions: { include: { permission: true } } } } },
    });

    const roles = userRoles.map((ur) => ur.role.name);
    const permissions = Array.from(
      new Set(
        userRoles.flatMap((ur) => ur.role.rolePermissions.map((rp) => rp.permission.key)),
      ),
    );
    return { roles, permissions };
  }
}
