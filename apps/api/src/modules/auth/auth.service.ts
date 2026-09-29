import {
  ConflictException,
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
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { durationToMs, hashToken } from './token.util';
import { AccessTokenPayload } from './strategies/jwt.strategy';

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
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });

    // Same error for "no such user" and "wrong password" to avoid
    // user-enumeration.
    const invalidCredentials = () =>
      new UnauthorizedException({ code: 'INVALID_CREDENTIALS', message: 'E-mail ou senha inválidos.' });

    if (!user) {
      throw invalidCredentials();
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException({
        code: 'USER_NOT_ACTIVE',
        message: 'Esta conta não está ativa.',
      });
    }

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

    let payload: { sub: string; jti: string };
    try {
      payload = await this.jwt.verifyAsync(rawRefreshToken, {
        secret: this.config.get('jwt', { infer: true }).refreshSecret,
      });
    } catch {
      throw invalid();
    }

    const tokenHash = hashToken(rawRefreshToken);
    const stored = await this.prisma.refreshToken.findUnique({ where: { tokenHash } });

    if (!stored || stored.revokedAt || stored.expiresAt < new Date() || stored.userId !== payload.sub) {
      throw invalid();
    }

    const user = await this.prisma.user.findUnique({ where: { id: stored.userId } });
    if (!user || user.status !== 'ACTIVE') {
      throw invalid();
    }

    // Rotation: the presented token is single-use. Revoke it and mint a new
    // pair, linking them via `replacedBy` for forensic traceability.
    const result = await this.issueTokensFor(user, meta);
    const newTokenHash = hashToken(result.refreshToken);
    await this.prisma.refreshToken.update({
      where: { id: stored.id },
      data: { revokedAt: new Date(), replacedBy: newTokenHash },
    });

    return result;
  }

  async logout(userId: string, rawRefreshToken: string | undefined, meta: RequestMeta): Promise<void> {
    if (rawRefreshToken) {
      const tokenHash = hashToken(rawRefreshToken);
      await this.prisma.refreshToken.updateMany({
        where: { tokenHash, userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await this.audit.record({
      userId,
      action: 'LOGOUT',
      entity: 'User',
      entityId: userId,
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

  private async issueTokensFor(user: User, meta: RequestMeta): Promise<AuthResult> {
    const { roles, permissions } = await this.loadRolesAndPermissions(user.id, user.tenantId);
    const jwtConfig = this.config.get('jwt', { infer: true });

    const accessPayload: AccessTokenPayload = {
      sub: user.id,
      tenantId: user.tenantId,
      email: user.email,
      roles,
      permissions,
      jti: randomUUID(),
    };
    const accessToken = await this.jwt.signAsync(accessPayload, {
      secret: jwtConfig.accessSecret,
      expiresIn: jwtConfig.accessExpiresIn,
    });

    const jti = randomUUID();
    const refreshToken = await this.jwt.signAsync(
      { sub: user.id, jti },
      { secret: jwtConfig.refreshSecret, expiresIn: jwtConfig.refreshExpiresIn },
    );
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
