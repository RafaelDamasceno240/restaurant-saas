import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { applyTrustProxy } from '../src/common/http/trust-proxy';
import { hashToken } from '../src/modules/auth/token.util';
// The frontend's own function (plain JS, no build): the tests below feed the API exactly what
// the web server sends, so they hold the two sides to the same contract.
import { appendForwardedFor } from '../../web/server/forwarded-for';
import { createTestApp, getPrisma, uniqueDocument, uniqueSuffix } from './test-app.util';

// The client address feeds the rate limiter, the audit log and
// refresh_tokens.ip. Behind a reverse proxy it has to come from
// X-Forwarded-For — but only from the entries a trusted proxy wrote.
describe('Client address behind a reverse proxy (e2e)', () => {
  const previousLimit = process.env.AUTH_RATE_LIMIT_PER_MINUTE;

  afterAll(() => {
    process.env.AUTH_RATE_LIMIT_PER_MINUTE = previousLimit;
  });
  // The tests that exercise the limit lower it themselves; everything else registers freely.
  beforeEach(() => {
    process.env.AUTH_RATE_LIMIT_PER_MINUTE = '10000';
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

  // ---------------------------------------------------------------------------------------
  // Through the web server (apps/web/server). The browser never calls the API: it calls the
  // frontend, whose server appends the address of the browser's socket to whatever
  // X-Forwarded-For arrived, and Next's /api rewrite forwards that header. `throughWeb` is
  // that header: (address the web saw, what the client itself put in the header).
  // ---------------------------------------------------------------------------------------
  const throughWeb = (clientAddress: string, sentByClient?: string) => appendForwardedFor(sentByClient, clientAddress);

  describe('behind the web server (one trusted hop)', () => {
    let app: INestApplication;
    beforeAll(async () => {
      app = await appWithHops(1);
    });
    afterAll(async () => {
      await app.close();
    });

    it('records each device by the address the web saw', async () => {
      expect(await recordedIp(app, throughWeb('203.0.113.31'))).toBe('203.0.113.31');
      expect(await recordedIp(app, throughWeb('203.0.113.32'))).toBe('203.0.113.32');
      // The same device over a dual-stack socket is the same device.
      expect(await recordedIp(app, throughWeb('::ffff:203.0.113.31'))).toBe('203.0.113.31');
    });

    it('records the real address of a client that forged the header', async () => {
      for (const forged of ['6.6.6.6', '6.6.6.6, 7.7.7.7', '127.0.0.1', '203.0.113.31', 'unknown']) {
        expect(await recordedIp(app, throughWeb('203.0.113.66', forged))).toBe('203.0.113.66');
      }
    });

    it('limits one device, leaves the others alone, and a forged header changes neither', async () => {
      process.env.AUTH_RATE_LIMIT_PER_MINUTE = '3';
      const device = '203.0.113.40';
      await failedLogin(app, throughWeb(device)).expect(401);
      await failedLogin(app, throughWeb(device)).expect(401);
      await failedLogin(app, throughWeb(device)).expect(401);
      await failedLogin(app, throughWeb(device)).expect(429);
      // Another device of the same restaurant keeps its own allowance.
      await failedLogin(app, throughWeb('203.0.113.41')).expect(401);
      // The limited device cannot buy a new allowance by forging, whatever it forges.
      await failedLogin(app, throughWeb(device, '198.51.100.1')).expect(429);
      await failedLogin(app, throughWeb(device, '198.51.100.2, 198.51.100.3')).expect(429);
      await failedLogin(app, throughWeb(device, '203.0.113.41')).expect(429);
      // And nobody can spend another device's allowance by forging its address.
      const impostor = '203.0.113.42';
      await failedLogin(app, throughWeb(impostor, '203.0.113.41')).expect(401);
      await failedLogin(app, throughWeb(impostor, '203.0.113.41')).expect(401);
      await failedLogin(app, throughWeb(impostor, '203.0.113.41')).expect(401);
      await failedLogin(app, throughWeb(impostor, '203.0.113.41')).expect(429);
      await failedLogin(app, throughWeb('203.0.113.41')).expect(401);
    });
  });

  // A TLS terminator or a platform load balancer in front of the frontend: it appends the
  // browser, then the web server appends it. Two hops to trust.
  describe('with a proxy in front of the web server (two trusted hops)', () => {
    const frontProxy = '10.0.0.2';
    const throughProxyAndWeb = (clientAddress: string, sentByClient?: string) =>
      appendForwardedFor(appendForwardedFor(sentByClient, clientAddress), frontProxy);

    let app: INestApplication;
    beforeAll(async () => {
      app = await appWithHops(2);
    });
    afterAll(async () => {
      await app.close();
    });

    it('records the client the front proxy saw, not the proxy', async () => {
      expect(await recordedIp(app, throughProxyAndWeb('203.0.113.51'))).toBe('203.0.113.51');
      expect(await recordedIp(app, throughProxyAndWeb('203.0.113.52'))).toBe('203.0.113.52');
    });

    it('records the real address of a client that forged the header', async () => {
      expect(await recordedIp(app, throughProxyAndWeb('203.0.113.66', '6.6.6.6'))).toBe('203.0.113.66');
      expect(await recordedIp(app, throughProxyAndWeb('203.0.113.66', '6.6.6.6, 10.0.0.2'))).toBe('203.0.113.66');
    });

    it('limits each client on its own, forged headers included', async () => {
      process.env.AUTH_RATE_LIMIT_PER_MINUTE = '3';
      const client = '203.0.113.53';
      await failedLogin(app, throughProxyAndWeb(client)).expect(401);
      await failedLogin(app, throughProxyAndWeb(client)).expect(401);
      await failedLogin(app, throughProxyAndWeb(client)).expect(401);
      await failedLogin(app, throughProxyAndWeb(client)).expect(429);
      await failedLogin(app, throughProxyAndWeb('203.0.113.54')).expect(401);
      await failedLogin(app, throughProxyAndWeb(client, '198.51.100.9')).expect(429);
    });
  });

  // TRUST_PROXY_HOPS has to be the exact number of proxies between the browser and the API.
  // These pin down what each mistake costs, so the documentation can say it plainly.
  describe('when TRUST_PROXY_HOPS does not match the proxies really in front', () => {
    it('too low is safe but coarse: every device behind the web is one address', async () => {
      const app = await appWithHops(0);
      try {
        const first = await recordedIp(app, throughWeb('203.0.113.61'));
        const second = await recordedIp(app, throughWeb('203.0.113.62', '6.6.6.6'));
        expect(first).toMatch(/127\.0\.0\.1|::1/);
        expect(second).toBe(first);
      } finally {
        await app.close();
      }
    });

    it('too high is unsafe: the API believes an entry the client wrote', async () => {
      // One real proxy (the web), but the API was told to trust two.
      const app = await appWithHops(2);
      try {
        expect(await recordedIp(app, throughWeb('203.0.113.66', '6.6.6.6'))).toBe('6.6.6.6');
      } finally {
        await app.close();
      }
    });

    it('a caller that reaches the API directly, past the web, can forge its address', async () => {
      // Nothing appended the real address: the header is entirely the caller's. This is why
      // the API must only be reachable through the proxies it was told to trust.
      const app = await appWithHops(1);
      try {
        expect(await recordedIp(app, '6.6.6.6')).toBe('6.6.6.6');
      } finally {
        await app.close();
      }
    });
  });
});
