import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { hashToken } from '../src/modules/auth/token.util';
import {
  createTestApp,
  getPrisma,
  provisionAndSignInE2E,
  uniqueDocument,
  uniqueSuffix,
} from './test-app.util';

// What the session has to survive in a real browser: an access token that
// expired while the user was working, and a logout that arrives after it did.
describe('Auth session (e2e)', () => {
  let app: INestApplication;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let server: any;
  let jwt: { accessSecret: string; refreshSecret: string };
  const signer = new JwtService({});

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    jwt = app.get(ConfigService).getOrThrow('jwt');
  });

  afterAll(async () => {
    await app.close();
  });

  const cookieOf = (res: request.Response) => (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  const tokenOf = (cookie: string) => cookie.split('=')[1];
  const storedToken = (cookie: string) =>
    getPrisma(app).refreshToken.findUniqueOrThrow({ where: { tokenHash: hashToken(tokenOf(cookie)) } });
  const logoutAudits = (userId: string) => getPrisma(app).auditLog.count({ where: { userId, action: 'LOGOUT' } });

  async function registerSession() {
    const suffix = uniqueSuffix();
    const payload = {
      tenantName: `Restaurante ${suffix}`,
      legalName: `Restaurante LTDA ${suffix}`,
      document: uniqueDocument(),
      slug: `tenant-${suffix}`,
      branchName: 'Matriz',
      userName: `Owner ${suffix}`,
      email: `owner-${suffix}@example.com`,
      password: 'Sup3rSecret!',
    };
    const res = await provisionAndSignInE2E(app, payload);
    return {
      payload,
      cookie: cookieOf(res),
      accessToken: res.body.accessToken as string,
      userId: res.body.user.id as string,
      tenantId: res.body.user.tenantId as string,
    };
  }

  // A token the API itself would have issued for this user, already past its expiry.
  function expiredAccessToken(session: { userId: string; tenantId: string; payload: { email: string } }) {
    return signer.signAsync(
      { sub: session.userId, tenantId: session.tenantId, email: session.payload.email, roles: ['OWNER'], permissions: [] },
      { secret: jwt.accessSecret, expiresIn: -60 },
    );
  }

  describe('an access token that expired during the session', () => {
    it('is rejected, and the refresh cookie buys a new one that works', async () => {
      const session = await registerSession();
      const expired = await expiredAccessToken(session);

      await request(server).get('/v1/auth/me').set('Authorization', `Bearer ${expired}`).expect(401);

      const refreshed = await request(server).post('/v1/auth/refresh').set('Cookie', session.cookie).expect(200);
      const me = await request(server)
        .get('/v1/auth/me')
        .set('Authorization', `Bearer ${refreshed.body.accessToken}`)
        .expect(200);
      expect(me.body.email).toBe(session.payload.email);
    });

    it('does not open any protected route by itself', async () => {
      const session = await registerSession();
      const expired = await expiredAccessToken(session);
      const authorization = { Authorization: `Bearer ${expired}` };

      await request(server).get('/v1/orders').set(authorization).expect(401);
      await request(server).get('/v1/customers').set(authorization).expect(401);
      await request(server).get('/v1/coupons').set(authorization).expect(401);
    });
  });

  describe('logout', () => {
    it('ends the session with the refresh cookie alone, without any access token', async () => {
      const session = await registerSession();

      const res = await request(server).post('/v1/auth/logout').set('Cookie', session.cookie).expect(204);

      expect((await storedToken(session.cookie)).revokedAt).not.toBeNull();
      await request(server).post('/v1/auth/refresh').set('Cookie', session.cookie).expect(401);
      expect(await logoutAudits(session.userId)).toBe(1);

      const cleared: string = res.headers['set-cookie'][0];
      expect(cleared).toMatch(/^refresh_token=;/);
      expect(cleared).toMatch(/Path=\//);
      expect(cleared).toMatch(/Expires=Thu, 01 Jan 1970/);
      expect(cleared).toMatch(/HttpOnly/i);
      expect(cleared).toMatch(/SameSite=Lax/i);
    });

    it('still ends the session when the access token sent along has expired', async () => {
      const session = await registerSession();
      const expired = await expiredAccessToken(session);
      await request(server).get('/v1/auth/me').set('Authorization', `Bearer ${expired}`).expect(401);

      await request(server)
        .post('/v1/auth/logout')
        .set('Authorization', `Bearer ${expired}`)
        .set('Cookie', session.cookie)
        .expect(204);

      expect((await storedToken(session.cookie)).revokedAt).not.toBeNull();
      await request(server).post('/v1/auth/refresh').set('Cookie', session.cookie).expect(401);
    });

    it('ends only the session of the cookie, not the other sessions of the same user', async () => {
      const session = await registerSession();
      const second = await request(server)
        .post('/v1/auth/login')
        .send({ email: session.payload.email, password: session.payload.password })
        .expect(200);

      await request(server).post('/v1/auth/logout').set('Cookie', session.cookie).expect(204);

      await request(server).post('/v1/auth/refresh').set('Cookie', session.cookie).expect(401);
      await request(server).post('/v1/auth/refresh').set('Cookie', cookieOf(second)).expect(200);
    });

    it('ignores anything the client puts in the body: nobody chooses whose session ends', async () => {
      const attacker = await registerSession();
      const victim = await registerSession();

      await request(server)
        .post('/v1/auth/logout')
        .set('Cookie', attacker.cookie)
        .send({ userId: victim.userId, refreshToken: tokenOf(victim.cookie), token: tokenOf(victim.cookie) })
        .expect(204);

      expect((await storedToken(victim.cookie)).revokedAt).toBeNull();
      expect(await logoutAudits(victim.userId)).toBe(0);
      await request(server).post('/v1/auth/refresh').set('Cookie', victim.cookie).expect(200);
      await request(server).post('/v1/auth/refresh').set('Cookie', attacker.cookie).expect(401);
    });

    it('does nothing without the cookie, even with a valid access token', async () => {
      const session = await registerSession();

      await request(server).post('/v1/auth/logout').set('Authorization', `Bearer ${session.accessToken}`).expect(204);

      expect((await storedToken(session.cookie)).revokedAt).toBeNull();
      expect(await logoutAudits(session.userId)).toBe(0);
      await request(server).post('/v1/auth/refresh').set('Cookie', session.cookie).expect(200);
    });

    it('does nothing for a cookie this API did not sign', async () => {
      const victim = await registerSession();
      const forged = await signer.signAsync(
        { sub: victim.userId, jti: 'forged' },
        { secret: 'a-secret-the-api-does-not-know-0123456789', expiresIn: '7d' },
      );
      // An access token is signed by the API, but with another secret: it is not a session.
      const accessAsCookie = victim.accessToken;

      await request(server).post('/v1/auth/logout').set('Cookie', `refresh_token=${forged}`).expect(204);
      await request(server).post('/v1/auth/logout').set('Cookie', `refresh_token=${accessAsCookie}`).expect(204);
      await request(server).post('/v1/auth/logout').set('Cookie', 'refresh_token=not-a-jwt').expect(204);

      expect((await storedToken(victim.cookie)).revokedAt).toBeNull();
      expect(await logoutAudits(victim.userId)).toBe(0);
      await request(server).post('/v1/auth/refresh').set('Cookie', victim.cookie).expect(200);
    });

    it('is idempotent: repeating it ends nothing else and records a single logout', async () => {
      const session = await registerSession();

      await request(server).post('/v1/auth/logout').set('Cookie', session.cookie).expect(204);
      await request(server).post('/v1/auth/logout').set('Cookie', session.cookie).expect(204);

      expect(await logoutAudits(session.userId)).toBe(1);
    });

    it('leaves the access token routes protected: logout being public opens nothing else', async () => {
      await request(server).get('/v1/auth/me').expect(401);
      await request(server).get('/v1/orders').expect(401);
    });
  });

  describe('refresh cookie attributes', () => {
    it('is not Secure outside production, so local http keeps working', async () => {
      const res = await provisionAndSignInE2E(app, await registerPayload());
      const setCookie: string = res.headers['set-cookie'][0];
      expect(setCookie).not.toMatch(/Secure/i);
      expect(setCookie).not.toMatch(/Domain=/i);
    });

    it('is HttpOnly, Secure, SameSite=Lax, Path=/ and host-only in production', async () => {
      const previous = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      const production = await createTestApp();
      try {
        const productionServer = production.getHttpServer();
        const res = await provisionAndSignInE2E(production, await registerPayload());
        const setCookie: string = res.headers['set-cookie'][0];
        expect(setCookie).toMatch(/^refresh_token=/);
        expect(setCookie).toMatch(/; HttpOnly/i);
        expect(setCookie).toMatch(/; Secure/i);
        expect(setCookie).toMatch(/; SameSite=Lax/i);
        expect(setCookie).toMatch(/; Path=\/(;|$)/);
        // No Domain attribute: the cookie belongs to the exact host that received it — the
        // frontend's, since the browser reaches the API through the /api rewrite.
        expect(setCookie).not.toMatch(/Domain=/i);

        const refreshed = await request(productionServer)
          .post('/v1/auth/refresh')
          .set('Cookie', setCookie.split(';')[0])
          .expect(200);
        expect(refreshed.headers['set-cookie'][0]).toMatch(/; Secure/i);

        const loggedOut = await request(productionServer)
          .post('/v1/auth/logout')
          .set('Cookie', cookieOf(refreshed))
          .expect(204);
        const cleared: string = loggedOut.headers['set-cookie'][0];
        expect(cleared).toMatch(/^refresh_token=;/);
        expect(cleared).toMatch(/; Secure/i);
        expect(cleared).toMatch(/; HttpOnly/i);
      } finally {
        process.env.NODE_ENV = previous;
        await production.close();
      }
    });

    async function registerPayload() {
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
  });
});
