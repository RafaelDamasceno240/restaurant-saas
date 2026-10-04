import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';
import { AppConfig } from '../../config/configuration';
import { SessionRevocationService } from './session-revocation.service';

// An in-memory stand-in for the two commands the service uses.
function fakeRedis() {
  const store = new Map<string, string>();
  const ttl = new Map<string, number>();
  return {
    store,
    ttl,
    set: jest.fn(async (key: string, value: string, _mode: string, seconds: number) => {
      store.set(key, value);
      ttl.set(key, seconds);
      return 'OK';
    }),
    mget: jest.fn(async (...keys: string[]) => keys.map((key) => store.get(key) ?? null)),
  };
}

const config = (accessExpiresIn: string) =>
  ({ get: () => ({ accessExpiresIn }) }) as unknown as ConfigService<AppConfig, true>;

function build(accessExpiresIn = '15m') {
  const redis = fakeRedis();
  const service = new SessionRevocationService(redis as unknown as Redis, config(accessExpiresIn));
  return { redis, service };
}

describe('SessionRevocationService', () => {
  it('accepts a token nobody revoked', async () => {
    const { service } = build();
    expect(await service.isRevoked({ userId: 'u1', sessionId: 's1', issuedAtMs: 1000 })).toBe(false);
  });

  it('revokes only the session that logged out', async () => {
    const { service } = build();
    await service.revokeSession('s1');
    expect(await service.isRevoked({ userId: 'u1', sessionId: 's1', issuedAtMs: 1000 })).toBe(true);
    expect(await service.isRevoked({ userId: 'u1', sessionId: 's2', issuedAtMs: 1000 })).toBe(false);
  });

  it('revokes every token of the user issued up to the cutoff, and none issued after it', async () => {
    const { service } = build();
    await service.revokeUser('u1', 5000);
    expect(await service.isRevoked({ userId: 'u1', sessionId: 's1', issuedAtMs: 4999 })).toBe(true);
    expect(await service.isRevoked({ userId: 'u1', sessionId: 's1', issuedAtMs: 5000 })).toBe(true);
    expect(await service.isRevoked({ userId: 'u1', sessionId: 's9', issuedAtMs: 5001 })).toBe(false);
    expect(await service.isRevoked({ userId: 'u2', sessionId: 's1', issuedAtMs: 1 })).toBe(false);
  });

  it('still checks the user cutoff for a token without a session id', async () => {
    const { service, redis } = build();
    await service.revokeUser('u1', 5000);
    expect(await service.isRevoked({ userId: 'u1', issuedAtMs: 100 })).toBe(true);
    expect(redis.mget).toHaveBeenLastCalledWith('auth:revoked:user:u1');
  });

  it('keeps each mark for the access token lifetime plus a margin', async () => {
    const { service, redis } = build('15m');
    await service.revokeSession('s1');
    await service.revokeUser('u1');
    expect(redis.ttl.get('auth:revoked:session:s1')).toBe(15 * 60 + 60);
    expect(redis.ttl.get('auth:revoked:user:u1')).toBe(15 * 60 + 60);
  });

  it('fails open when Redis cannot answer: the token is accepted', async () => {
    const { service, redis } = build();
    redis.mget.mockRejectedValueOnce(new Error('Connection is closed.'));
    expect(await service.isRevoked({ userId: 'u1', sessionId: 's1', issuedAtMs: 1 })).toBe(false);
  });

  it('never turns a failed write into an error', async () => {
    const { service, redis } = build();
    redis.set.mockRejectedValue(new Error('Connection is closed.'));
    await expect(service.revokeSession('s1')).resolves.toBeUndefined();
    await expect(service.revokeUser('u1')).resolves.toBeUndefined();
  });
});
