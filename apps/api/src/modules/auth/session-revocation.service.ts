import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppConfig } from '../../config/configuration';
import { REDIS_CLIENT } from '../../redis/redis.module';
import { durationToMs } from './token.util';

// What an access token says about itself, as far as revocation is concerned.
export interface AccessTokenIdentity {
  userId: string;
  // Absent on tokens issued before sessions carried an id; those can only be revoked per user.
  sessionId?: string;
  issuedAtMs: number;
}

// Clock skew and the JWT library's own tolerance: the mark outlives the token by this much.
const TTL_MARGIN_SECONDS = 60;

const sessionKey = (sessionId: string) => `auth:revoked:session:${sessionId}`;
const userKey = (userId: string) => `auth:revoked:user:${userId}`;

// Access tokens are stateless JWTs, so ending a session in the database (the refresh token)
// would still leave its access token valid until it expires. This denylist closes that window:
//   - revokeSession(): logout. Kills the access tokens of ONE session (same `sid`).
//   - revokeUser():    refresh-token reuse detected. Kills every access token of the user issued
//                      up to that instant; tokens from a later login are not affected.
// A mark only needs to live as long as the longest-lived access token it can match, so Redis
// expires it by itself and the set never grows.
//
// Decision: reads FAIL OPEN. If Redis cannot answer, the token is accepted as before this
// denylist existed (bounded by its own expiry, 15 min by default) instead of locking every
// cashier out of the system because a cache is away. The failure is logged.
@Injectable()
export class SessionRevocationService {
  private readonly logger = new Logger(SessionRevocationService.name);
  private readonly ttlSeconds: number;

  constructor(
    @Inject(REDIS_CLIENT) private readonly redis: Redis,
    config: ConfigService<AppConfig, true>,
  ) {
    const accessMs = durationToMs(config.get('jwt', { infer: true }).accessExpiresIn);
    this.ttlSeconds = Math.ceil(accessMs / 1000) + TTL_MARGIN_SECONDS;
  }

  async revokeSession(sessionId: string): Promise<void> {
    await this.write(sessionKey(sessionId), '1');
  }

  async revokeUser(userId: string, at: number = Date.now()): Promise<void> {
    await this.write(userKey(userId), String(at));
  }

  async isRevoked(token: AccessTokenIdentity): Promise<boolean> {
    try {
      const keys = [userKey(token.userId), ...(token.sessionId ? [sessionKey(token.sessionId)] : [])];
      const [userCutoff, sessionMark] = await this.redis.mget(...keys);
      if (sessionMark) return true;
      return userCutoff !== null && token.issuedAtMs <= Number(userCutoff);
    } catch (error) {
      this.logger.error(`Session denylist unavailable, accepting the token: ${(error as Error).message}`);
      return false;
    }
  }

  // A failed write must not turn a logout into an error: the refresh token is already revoked in
  // the database, so the session cannot be renewed; only its current access token outlives it.
  private async write(key: string, value: string): Promise<void> {
    try {
      await this.redis.set(key, value, 'EX', this.ttlSeconds);
    } catch (error) {
      this.logger.error(`Could not record a session revocation: ${(error as Error).message}`);
    }
  }
}
