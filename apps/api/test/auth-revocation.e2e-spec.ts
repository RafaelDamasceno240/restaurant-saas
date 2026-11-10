import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import request from 'supertest';
import { hashToken } from '../src/modules/auth/token.util';
import {
  createTestApp,
  getPrisma,
  provisionAndSignInE2E,
  registerTenantE2E,
  uniqueDocument,
  uniqueSuffix,
} from './test-app.util';

// An access token is a stateless JWT: ending the session in the database is not enough to stop
// it. These cover the denylist that does (logout, stolen refresh token) and what a login is
// allowed to reveal about an account.
describe('Auth revocation and login disclosure (e2e)', () => {
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
  const claims = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  const me = (token: string) => request(server).get('/v1/auth/me').set('Authorization', `Bearer ${token}`);

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

  const login = (email: string, password: string) => request(server).post('/v1/auth/login').send({ email, password });

  describe('logout ends the access token too', () => {
    it('rejects the access token of the session right after logout', async () => {
      const session = await registerSession();
      await me(session.accessToken).expect(200);

      await request(server).post('/v1/auth/logout').set('Cookie', session.cookie).expect(204);

      const after = await me(session.accessToken).expect(401);
      expect(after.body.code).toBe('SESSION_REVOKED');
      // Not only /auth/me: every protected route goes through the same check.
      await request(server).get('/v1/orders').set('Authorization', `Bearer ${session.accessToken}`).expect(401);
      await request(server)
        .get('/v1/branches/accessible')
        .set('Authorization', `Bearer ${session.accessToken}`)
        .expect(401);
    });

    it('leaves the other sessions of the same user alone', async () => {
      const session = await registerSession();
      const other = await login(session.payload.email, session.payload.password).expect(200);

      await request(server).post('/v1/auth/logout').set('Cookie', session.cookie).expect(204);

      await me(session.accessToken).expect(401);
      await me(other.body.accessToken).expect(200);
    });

    it('keeps one session id across rotations, so every access token of the session dies', async () => {
      const session = await registerSession();
      const rotated = await request(server).post('/v1/auth/refresh').set('Cookie', session.cookie).expect(200);
      const rotatedAgain = await request(server).post('/v1/auth/refresh').set('Cookie', cookieOf(rotated)).expect(200);

      const sid = claims(session.accessToken).sid;
      expect(typeof sid).toBe('string');
      expect(claims(rotated.body.accessToken).sid).toBe(sid);
      expect(claims(rotatedAgain.body.accessToken).sid).toBe(sid);
      await me(session.accessToken).expect(200);
      await me(rotatedAgain.body.accessToken).expect(200);

      await request(server).post('/v1/auth/logout').set('Cookie', cookieOf(rotatedAgain)).expect(204);

      await me(session.accessToken).expect(401);
      await me(rotated.body.accessToken).expect(401);
      await me(rotatedAgain.body.accessToken).expect(401);
    });

    it('gives a different session id to each login', async () => {
      const session = await registerSession();
      const second = await login(session.payload.email, session.payload.password).expect(200);
      expect(claims(second.body.accessToken).sid).not.toBe(claims(session.accessToken).sid);
    });

    it('lets the user sign in again: the new session is not affected by the old logout', async () => {
      const session = await registerSession();
      await request(server).post('/v1/auth/logout').set('Cookie', session.cookie).expect(204);

      const again = await login(session.payload.email, session.payload.password).expect(200);
      await me(again.body.accessToken).expect(200);
      await me(session.accessToken).expect(401);
    });

    it('revokes nothing when the logout itself ends nothing', async () => {
      const session = await registerSession();
      // An already rotated refresh token no longer identifies a live session.
      const rotated = await request(server).post('/v1/auth/refresh').set('Cookie', session.cookie).expect(200);
      await request(server).post('/v1/auth/logout').set('Cookie', session.cookie).expect(204);
      await request(server).post('/v1/auth/logout').expect(204);

      await me(rotated.body.accessToken).expect(200);
    });
  });

  describe('a stolen refresh token', () => {
    it('reuse after the grace window kills every access token the user holds, but not a later login', async () => {
      const session = await registerSession();
      const second = await login(session.payload.email, session.payload.password).expect(200);
      const rotated = await request(server).post('/v1/auth/refresh').set('Cookie', session.cookie).expect(200);
      await getPrisma(app).refreshToken.update({
        where: { tokenHash: hashToken(session.cookie.split('=')[1]) },
        data: { revokedAt: new Date(Date.now() - 60_000) },
      });

      await request(server).post('/v1/auth/refresh').set('Cookie', session.cookie).expect(401);

      await me(session.accessToken).expect(401);
      await me(rotated.body.accessToken).expect(401);
      await me(second.body.accessToken).expect(401);

      // The cutoff is an instant, not a ban: signing in again works straight away.
      await new Promise((resolve) => setTimeout(resolve, 5));
      const again = await login(session.payload.email, session.payload.password).expect(200);
      await me(again.body.accessToken).expect(200);
    });

    it('does not touch another user', async () => {
      const victim = await registerSession();
      const bystander = await registerSession();
      await request(server).post('/v1/auth/refresh').set('Cookie', victim.cookie).expect(200);
      await getPrisma(app).refreshToken.update({
        where: { tokenHash: hashToken(victim.cookie.split('=')[1]) },
        data: { revokedAt: new Date(Date.now() - 60_000) },
      });
      await request(server).post('/v1/auth/refresh').set('Cookie', victim.cookie).expect(401);

      await me(bystander.accessToken).expect(200);
    });
  });

  describe('tokens issued before sessions had an id', () => {
    it('are still accepted while valid', async () => {
      const session = await registerSession();
      const legacy = await signer.signAsync(
        { sub: session.userId, tenantId: session.tenantId, email: session.payload.email, roles: ['OWNER'], permissions: [] },
        { secret: jwt.accessSecret, expiresIn: 60 },
      );
      await me(legacy).expect(200);
    });
  });

  describe('what a login reveals', () => {
    it('says nothing about a blocked account to someone without its password', async () => {
      const session = await registerSession();
      await getPrisma(app).user.update({ where: { id: session.userId }, data: { status: 'BLOCKED' } });

      const wrong = await login(session.payload.email, 'not-the-password').expect(401);
      expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
      const unknown = await login(`nobody-${uniqueSuffix()}@example.com`, 'not-the-password').expect(401);
      expect(unknown.body.code).toBe('INVALID_CREDENTIALS');
      expect(wrong.body.message).toBe(unknown.body.message);

      // Only the owner of the password learns the account is blocked.
      const right = await login(session.payload.email, session.payload.password).expect(401);
      expect(right.body.code).toBe('USER_NOT_ACTIVE');
    });

    it('says nothing about a suspended restaurant to someone without the password', async () => {
      const session = await registerSession();
      await getPrisma(app).tenant.update({ where: { id: session.tenantId }, data: { status: 'SUSPENDED' } });

      const wrong = await login(session.payload.email, 'not-the-password').expect(401);
      expect(wrong.body.code).toBe('INVALID_CREDENTIALS');
      const right = await login(session.payload.email, session.payload.password).expect(403);
      expect(right.body.code).toBe('TENANT_NOT_ACTIVE');
    });

    it('still records a failed attempt against a real account, and none for an unknown e-mail', async () => {
      const session = await registerSession();
      const failures = () => getPrisma(app).auditLog.count({ where: { userId: session.userId, action: 'LOGIN_FAILED' } });

      await login(session.payload.email, 'not-the-password').expect(401);
      expect(await failures()).toBe(1);
      await login(`nobody-${uniqueSuffix()}@example.com`, 'not-the-password').expect(401);
      expect(await failures()).toBe(1);
    });
  });

  describe('order list filtered by a branch of another restaurant', () => {
    it('is "branch not found" for an owner, like every other module, and still works for own branches', async () => {
      const mine = await registerTenantE2E(server);
      const theirs = await registerTenantE2E(server);
      const auth = { Authorization: `Bearer ${mine.accessToken}` };

      const foreign = await request(server).get(`/v1/orders?branchId=${theirs.branchId}`).set(auth).expect(404);
      expect(foreign.body.code).toBe('BRANCH_NOT_FOUND');
      await request(server).get(`/v1/orders?branchId=${mine.branchId}`).set(auth).expect(200);

      // The history of a deactivated branch of the tenant stays readable.
      await getPrisma(app).branch.update({ where: { id: mine.branchId }, data: { status: 'INACTIVE' } });
      await request(server).get(`/v1/orders?branchId=${mine.branchId}`).set(auth).expect(200);
    });
  });
});
