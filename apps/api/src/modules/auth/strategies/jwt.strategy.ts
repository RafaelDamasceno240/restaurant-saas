import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { RoleName } from '@prisma/client';
import { AppConfig } from '../../../config/configuration';
import { AuthenticatedRequestUser } from '../../../common/types/authenticated-request-user';

export interface AccessTokenPayload {
  sub: string;
  tenantId: string;
  email: string;
  roles: RoleName[];
  permissions: string[];
  // Only exists so two tokens issued for the same user within the same
  // second (iat has 1s resolution) don't sign to the exact same string —
  // not used for revocation.
  jti: string;
}

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(config: ConfigService<AppConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('jwt', { infer: true }).accessSecret,
    });
  }

  // Return value becomes `req.user`. Kept in sync with
  // AuthenticatedRequestUser so every guard/decorator downstream has a
  // single, typed shape to rely on.
  validate(payload: AccessTokenPayload): AuthenticatedRequestUser {
    if (!payload.sub || !payload.tenantId) {
      throw new UnauthorizedException({ code: 'UNAUTHORIZED', message: 'Token inválido.' });
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
