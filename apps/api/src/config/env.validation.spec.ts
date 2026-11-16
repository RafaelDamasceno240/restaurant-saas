import { validateEnv } from './env.validation';

const base = {
  DATABASE_URL: 'postgresql://user:pass@localhost:5432/db?schema=public',
  REDIS_URL: 'redis://localhost:6379',
  JWT_ACCESS_SECRET: 'a'.repeat(32),
  JWT_REFRESH_SECRET: 'b'.repeat(32),
};

describe('validateEnv', () => {
  it('trusts no proxy unless told to', () => {
    expect(validateEnv(base).TRUST_PROXY_HOPS).toBe(0);
  });

  it('accepts a hop count', () => {
    expect(validateEnv({ ...base, TRUST_PROXY_HOPS: '2' }).TRUST_PROXY_HOPS).toBe(2);
  });

  // "true" would make Express believe the whole X-Forwarded-For header, i.e. whatever the
  // client typed. Only an explicit number of proxies is accepted.
  it.each(['true', '-1', '1.5', '9', 'loopback'])('rejects TRUST_PROXY_HOPS=%s', (value) => {
    expect(() => validateEnv({ ...base, TRUST_PROXY_HOPS: value })).toThrow(/TRUST_PROXY_HOPS/);
  });

  it('defaults NODE_ENV to development, so production must be set explicitly', () => {
    expect(validateEnv(base).NODE_ENV).toBe('development');
    expect(validateEnv({ ...base, NODE_ENV: 'production' }).NODE_ENV).toBe('production');
  });

  it('refuses to boot without the secrets and the connection strings', () => {
    expect(() => validateEnv({ ...base, JWT_ACCESS_SECRET: 'short' })).toThrow(/JWT_ACCESS_SECRET/);
    expect(() => validateEnv({ ...base, DATABASE_URL: undefined })).toThrow(/DATABASE_URL/);
    expect(() => validateEnv({ ...base, REDIS_URL: undefined })).toThrow(/REDIS_URL/);
  });
});
