import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { applyTrustProxy } from '../src/common/http/trust-proxy';
import { hashToken } from '../src/modules/auth/token.util';
import { createTestApp, getPrisma, uniqueDocument, uniqueSuffix } from './test-app.util';

// The client address feeds the rate limiter, the audit log and
// refresh_tokens.ip. Behind a reverse proxy it has to come from
// X-Forwarded-For — but only from the entries a trusted proxy wrote.
describe('Client address behind a reverse proxy (e2e)', () => {
  const previousLimit = process.env.AUTH_RATE_LIMIT_PER_MINUTE;

  afterAll(() => {
    process.env.AUTH_RATE_LIMIT_PER_MINUTE = previousLimit;
  });

  async function appWithHops(hops: number): Promise<INestApplication> {
    const app = await createTestApp();
    applyTrustProxy(app as NestExpressApplication, hops);
    return app;
  }

  function registerPayload() {
    const suffix = uniqueSuffix();
    return {
      tenantName: `Restaurante ${suffix}`,
      legalName: `Restaurante LTDA ${suffix}`,
      document: uniqueDocument(),
      slug: `tenant-${suffix}`,
      branchName: 'Matriz',
      userName: `Owner ${suffix}`,
      email: `owner-${suffix}@example.com`,
      password: 'Sup3rSecret!',
    };
  }

  // Registers through the given X-Forwarded-For and returns the address the API recorded.
  async function recordedIp(app: INestApplication, forwardedFor: string): Promise<string | null> {
    const res = await request(app.getHttpServer())
      .post('/v1/auth/register')
      .set('X-Forwarded-For', forwardedFor)
      .send(registerPayload())
      .expect(201);
    const token = (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0].split('=')[1];
    const stored = await getPrisma(app).refreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(token) } });
    return stored.ip;
  }

  const failedLogin = (app: INestApplication, forwardedFor: string) =>
    request(app.getHttpServer())
      .post('/v1/auth/login')
      .set('X-Forwarded-For', forwardedFor)
      .send({ email: 'nobody@example.com', password: 'wrong-password' });

  describe('with no trusted proxy (the default)', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await appWithHops(0);
    });
    afterAll(async () => {
      await app.close();
    });

    it('ignores X-Forwarded-For and records the socket address', async () => {
      const ip = await recordedIp(app, '203.0.113.7');
      expect(ip).not.toBe('203.0.113.7');
      expect(ip).toMatch(/127\.0\.0\.1|::1/);
    });

    it('does not let a caller escape the login rate limit by inventing addresses', async () => {
      process.env.AUTH_RATE_LIMIT_PER_MINUTE = '3';
      await failedLogin(app, '198.51.100.1').expect(401);
      await failedLogin(app, '198.51.100.2').expect(401);
      await failedLogin(app, '198.51.100.3').expect(401);
      await failedLogin(app, '198.51.100.4').expect(429);
    });
  });

  describe('with one trusted proxy', () => {
    let app: INestApplication;
    beforeAll(async () => {
      process.env.AUTH_RATE_LIMIT_PER_MINUTE = '10000';
      app = await appWithHops(1);
    });
    afterAll(async () => {
      await app.close();
    });

    it('records the address the proxy reported', async () => {
      expect(await recordedIp(app, '203.0.113.7')).toBe('203.0.113.7');
    });

    it('takes the entry written by the proxy, not one the client prepended', async () => {
      expect(await recordedIp(app, '10.66.66.66, 203.0.113.9')).toBe('203.0.113.9');
    });

    it('rate limits each client on its own instead of all of them together', async () => {
      process.env.AUTH_RATE_LIMIT_PER_MINUTE = '3';
      await failedLogin(app, '203.0.113.20').expect(401);
      await failedLogin(app, '203.0.113.20').expect(401);
      await failedLogin(app, '203.0.113.20').expect(401);
      await failedLogin(app, '203.0.113.20').expect(429);
      // Another client behind the same proxy is not affected.
      await failedLogin(app, '203.0.113.21').expect(401);
      // Prepending a fake address does not buy the first client a new bucket.
      await failedLogin(app, '10.66.66.66, 203.0.113.20').expect(429);
    });
  });
});
