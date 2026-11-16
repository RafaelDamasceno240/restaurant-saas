import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RoleName } from '@prisma/client';
import { AppConfig } from '../../../config/configuration';
import { AuthenticatedRequestUser } from '../../../common/types/authenticated-request-user';
import { SessionRevocationService } from '../session-revocation.service';

export interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  email: string;
  roles: RoleName[];
  permissions: string[];
  // Only exists so two tokens issued for the same user within the same
  // second (iat has 1s resolution) don't sign to the exact same string.
  jti: string;
  // The session this token belongs to: shared with the refresh token and kept across
  // rotations, so a logout can revoke the access tokens of that session and only those.
  sid: string;
  // Issue time in milliseconds. `iat` (added by the JWT library) only has 1s resolution, which
  // cannot tell a token issued just before a user-wide revocation from one issued just after.
  iatMs: number;
}

// What actually arrives: tokens issued before `sid`/`iatMs` existed lack them.
type VerifiedAccessToken = Omit<AccessTokenPayload, 'sid' | 'iatMs'> &
  Partial<Pick<AccessTokenPayload, 'sid' | 'iatMs'>> & { iat?: number };

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(
    config: ConfigService<AppConfig, true>,
    private readonly revocations: SessionRevocationService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('jwt', { infer: true }).accessSecret,
    });
  }

  // Return value becomes `req.user`. Kept in sync with
  // AuthenticatedRequestUser so every guard/decorator downstream has a
  // single, typed shape to rely on.
  async validate(payload: VerifiedAccessToken): Promise<AuthenticatedRequestUser> {
    if (!payload.sub || !payload.tenantId) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Token inválido.' });
    }
    // Signature and expiry are fine, but the session may have been ended since (logout, or a
    // stolen refresh token detected). Same 401 as an expired token: the client just refreshes,
    // and that refresh is what gets refused.
    const revoked = await this.revocations.isRevoked({
      userId: payload.sub,
      // A suspended restaurant: every token of its accounts dies at once (PlatformTenantsService).
      tenantId: payload.tenantId,
      sessionId: payload.sid,
      issuedAtMs: payload.iatMs ?? (payload.iat ?? 0) * 1000,
    });
    if (revoked) {
      throw new UnauthorizedException({ code: 'SESSION_REVOKED', message: 'Sessão encerrada.' });
    }
    return {
      userId: payload.sub,
      tenantId: payload.tenantId,
      email: payload.email,
      roles: payload.roles,
      permissions: payload.permissions,
    };
  }
}
