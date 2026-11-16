import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, getPrisma, registerTenantE2E, uniqueSuffix } from './test-app.util';

type Json = Record<string, unknown>;

// Passwords: the manager resets a staff password, and anyone changes their own. Both end
// every session of the account.
describe('Users passwords (e2e)', () => {
  let app: INestApplication;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let server: any;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });
  afterAll(async () => {
    await app.close();
  });

  const PASSWORD = 'Sup3rSecret!';
  const NEW_PASSWORD = 'N0vaSenha!2026';
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) => request(server).get(path).set(auth(token));
  const post = (token: string, path: string, body: Json = {}) => request(server).post(path).set(auth(token)).send(body);
  const prisma = () => getPrisma(app);
  const cookieOf = (res: request.Response) => (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  const tryLogin = (email: string, password: string) => request(server).post('/v1/auth/login').send({ email, password });
  const login = async (email: string, password = PASSWORD) => {
    const res = await tryLogin(email, password).expect(200);
    return { accessToken: res.body.accessToken as string, cookie: cookieOf(res) };
  };
  const createStaff = async (token: string, role: string) => {
    const email = `${role.toLowerCase()}-${uniqueSuffix()}@example.com`;
    const res = await post(token, '/v1/users', { name: `Pessoa ${role}`, email, password: PASSWORD, role }).expect(201);
    return { id: res.body.id as string, email };
  };

  type Ctx = Awaited<ReturnType<typeof registerTenantE2E>>;
  let ctx: Ctx;
  beforeAll(async () => {
    ctx = await registerTenantE2E(server);
  });

  describe('reset by the manager', () => {
    it('sets the new password and ends every session of the account', async () => {
      const staff = await createStaff(ctx.accessToken, 'CASHIER');
      const first = await login(staff.email);
      const second = await login(staff.email);

      await post(ctx.accessToken, `/v1/users/${staff.id}/reset-password`, { password: NEW_PASSWORD }).expect(204);

      await get(first.accessToken, '/v1/auth/me').expect(401);
      await get(second.accessToken, '/v1/auth/me').expect(401);
      await request(server).post('/v1/auth/refresh').set('Cookie', first.cookie).expect(401);
      await request(server).post('/v1/auth/refresh').set('Cookie', second.cookie).expect(401);
      await tryLogin(staff.email, PASSWORD).expect(401);
      const fresh = await login(staff.email, NEW_PASSWORD);
      await get(fresh.accessToken, '/v1/auth/me').expect(200);

      const entries = await prisma().auditLog.findMany({
        where: { tenantId: ctx.tenantId, action: 'USER_PASSWORD_RESET', entityId: staff.id },
      });
      expect(entries).toHaveLength(1);
      expect(JSON.stringify(entries[0])).not.toContain(NEW_PASSWORD);
      const row = await prisma().user.findUniqueOrThrow({ where: { id: staff.id } });
      expect(row.passwordHash).not.toContain(NEW_PASSWORD);
      expect(row.passwordHash.startsWith('$argon2')).toBe(true);
    });

    it('refuses a weak password, an unknown field, yourself and staff without the permission', async () => {
      const staff = await createStaff(ctx.accessToken, 'CASHIER');
      const session = await login(staff.email);
      const ownerId = JSON.parse(Buffer.from(ctx.accessToken.split('.')[1], 'base64url').toString('utf8')).sub;

      await post(ctx.accessToken, `/v1/users/${staff.id}/reset-password`, { password: 'curta' }).expect(400);
      await post(ctx.accessToken, `/v1/users/${staff.id}/reset-password`, {
        password: NEW_PASSWORD,
        email: 'outro@example.com',
      }).expect(400);
      const self = await post(ctx.accessToken, `/v1/users/${ownerId}/reset-password`, { password: NEW_PASSWORD }).expect(403);
      expect(self.body.code).toBe('CANNOT_MANAGE_SELF');
      await post(session.accessToken, `/v1/users/${staff.id}/reset-password`, { password: NEW_PASSWORD }).expect(403);

      // Nothing changed: the original password still works.
      await login(staff.email);
    });
  });

  describe('changing your own password', () => {
    it('needs the current password and a different new one', async () => {
      const staff = await createStaff(ctx.accessToken, 'WAITER');
      const session = await login(staff.email);

      const wrong = await post(session.accessToken, '/v1/auth/change-password', {
        currentPassword: 'SenhaErrada1!',
        newPassword: NEW_PASSWORD,
      }).expect(400);
      expect(wrong.body.code).toBe('INVALID_CURRENT_PASSWORD');
      const same = await post(session.accessToken, '/v1/auth/change-password', {
        currentPassword: PASSWORD,
        newPassword: PASSWORD,
      }).expect(400);
      expect(same.body.code).toBe('PASSWORD_UNCHANGED');
      await post(session.accessToken, '/v1/auth/change-password', {
        currentPassword: PASSWORD,
        newPassword: 'curta',
      }).expect(400);
      await request(server)
        .post('/v1/auth/change-password')
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD })
        .expect(401);

      // Still the old password, still signed in.
      await get(session.accessToken, '/v1/auth/me').expect(200);
      await login(staff.email);
      expect(
        await prisma().auditLog.count({ where: { tenantId: ctx.tenantId, action: 'PASSWORD_CHANGE_FAILED', entityId: staff.id } }),
      ).toBe(1);
    });

    it('changes it, clears the session cookie and ends every session of the account', async () => {
      const staff = await createStaff(ctx.accessToken, 'CASHIER');
      const here = await login(staff.email);
      const elsewhere = await login(staff.email);

      const res = await post(here.accessToken, '/v1/auth/change-password', {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(204);
      const cleared = (res.headers['set-cookie'] as unknown as string[])[0];
      expect(cleared).toMatch(/^refresh_token=;/);

      await get(here.accessToken, '/v1/auth/me').expect(401);
      await get(elsewhere.accessToken, '/v1/auth/me').expect(401);
      await request(server).post('/v1/auth/refresh').set('Cookie', here.cookie).expect(401);
      await request(server).post('/v1/auth/refresh').set('Cookie', elsewhere.cookie).expect(401);
      await tryLogin(staff.email, PASSWORD).expect(401);
      const fresh = await login(staff.email, NEW_PASSWORD);
      await get(fresh.accessToken, '/v1/auth/me').expect(200);

      const entries = await prisma().auditLog.findMany({
        where: { tenantId: ctx.tenantId, action: 'PASSWORD_CHANGED', entityId: staff.id },
      });
      expect(entries).toHaveLength(1);
      expect(JSON.stringify(entries[0])).not.toContain(NEW_PASSWORD);
    });

    it('works for the owner too, who has no one to reset it for them', async () => {
      const other = await registerTenantE2E(server);
      await post(other.accessToken, '/v1/auth/change-password', {
        currentPassword: PASSWORD,
        newPassword: NEW_PASSWORD,
      }).expect(204);
      await get(other.accessToken, '/v1/auth/me').expect(401);
    });
  });
});
