import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, getPrisma, registerTenantE2E, uniqueSuffix } from './test-app.util';

type Json = Record<string, unknown>;

// Staff accounts: who may create and change them, what a role or status change does to the
// sessions of the account, and tenant isolation. Passwords live in users-password.e2e-spec.ts
// (own rate-limit window).
describe('Users management (e2e)', () => {
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
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) => request(server).get(path).set(auth(token));
  const post = (token: string, path: string, body: Json = {}) => request(server).post(path).set(auth(token)).send(body);
  const patch = (token: string, path: string, body: Json) => request(server).patch(path).set(auth(token)).send(body);
  const prisma = () => getPrisma(app);
  const email = (label: string) => `${label}-${uniqueSuffix()}@example.com`;
  const claims = (token: string) => JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  const cookieOf = (res: request.Response) => (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];

  type Ctx = Awaited<ReturnType<typeof registerTenantE2E>>;
  const staffBody = (role: string, extra: Json = {}) => ({
    name: `Pessoa ${role}`,
    email: email(role.toLowerCase()),
    password: PASSWORD,
    role,
    ...extra,
  });
  const createStaff = async (token: string, role: string, extra: Json = {}) => {
    const body = staffBody(role, extra);
    const res = await post(token, '/v1/users', body).expect(201);
    return { id: res.body.id as string, email: body.email, body: res.body };
  };
  const login = async (userEmail: string, password = PASSWORD) => {
    const res = await request(server).post('/v1/auth/login').send({ email: userEmail, password }).expect(200);
    return { accessToken: res.body.accessToken as string, cookie: cookieOf(res) };
  };
  const audits = (tenantId: string, action: string) =>
    prisma().auditLog.findMany({ where: { tenantId, action }, orderBy: { createdAt: 'asc' } });

  describe('create', () => {
    let ctx: Ctx;
    beforeAll(async () => {
      ctx = await registerTenantE2E(server);
    });

    it('creates a cashier in the only branch, who can sign in and work there', async () => {
      const body = staffBody('CASHIER', { name: '  Ana Caixa  ' });
      const res = await post(ctx.accessToken, '/v1/users', body).expect(201);
      expect(res.body).toMatchObject({
        name: 'Ana Caixa',
        email: body.email,
        status: 'ACTIVE',
        roles: ['CASHIER'],
        branchIds: [ctx.branchId],
        tenantId: ctx.tenantId,
      });
      expect(JSON.stringify(res.body)).not.toMatch(/password/i);

      const session = await login(body.email);
      expect(claims(session.accessToken).roles).toEqual(['CASHIER']);
      expect(claims(session.accessToken).permissions).toContain('pos.create');
      expect(claims(session.accessToken).permissions).not.toContain('users.create');
      const branches = await get(session.accessToken, '/v1/branches/accessible').expect(200);
      expect(branches.body.map((b: { id: string }) => b.id)).toEqual([ctx.branchId]);

      const listed = await get(ctx.accessToken, '/v1/users').expect(200);
      expect(listed.body.map((u: { id: string }) => u.id)).toContain(res.body.id);
    });

    it('audits the creation with the access granted and nothing personal', async () => {
      const staff = await createStaff(ctx.accessToken, 'WAITER');
      const entries = (await audits(ctx.tenantId, 'USER_CREATED')).filter((e) => e.entityId === staff.id);
      expect(entries).toHaveLength(1);
      expect(entries[0].afterData).toEqual({ role: 'WAITER', status: 'ACTIVE', branchIds: [ctx.branchId] });
      expect(JSON.stringify(entries[0])).not.toContain(staff.email);
      expect(JSON.stringify(entries[0])).not.toContain(PASSWORD);
    });

    it('refuses an e-mail that already has an account, in this or another restaurant', async () => {
      const staff = await createStaff(ctx.accessToken, 'KITCHEN');
      const again = await post(ctx.accessToken, '/v1/users', staffBody('WAITER', { email: staff.email })).expect(409);
      expect(again.body.code).toBe('EMAIL_ALREADY_EXISTS');

      const other = await registerTenantE2E(server);
      const cross = await post(other.accessToken, '/v1/users', staffBody('WAITER', { email: staff.email })).expect(409);
      expect(cross.body.code).toBe('EMAIL_ALREADY_EXISTS');
    });

    it('lets only one of two simultaneous creations with the same e-mail through', async () => {
      const body = staffBody('CASHIER');
      const results = await Promise.all([
        post(ctx.accessToken, '/v1/users', body),
        post(ctx.accessToken, '/v1/users', body),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await prisma().user.count({ where: { email: body.email } })).toBe(1);
    });

    it('validates the payload: no OWNER, no weak password, no field it does not know', async () => {
      await post(ctx.accessToken, '/v1/users', staffBody('OWNER')).expect(400);
      await post(ctx.accessToken, '/v1/users', staffBody('CASHIER', { password: '1234567' })).expect(400);
      await post(ctx.accessToken, '/v1/users', staffBody('CASHIER', { email: 'nao-e-email' })).expect(400);
      await post(ctx.accessToken, '/v1/users', staffBody('CASHIER', { tenantId: ctx.tenantId })).expect(400);
      await post(ctx.accessToken, '/v1/users', staffBody('CASHIER', { status: 'BLOCKED' })).expect(400);
    });

    it('refuses a branch that does not exist or belongs to another restaurant', async () => {
      const other = await registerTenantE2E(server);
      const res = await post(
        ctx.accessToken,
        '/v1/users',
        staffBody('CASHIER', { branchIds: [other.branchId] }),
      ).expect(404);
      expect(res.body.code).toBe('BRANCH_NOT_FOUND');
      const mixed = staffBody('CASHIER', { branchIds: [ctx.branchId, other.branchId] });
      await post(ctx.accessToken, '/v1/users', mixed).expect(404);
      expect(await prisma().user.count({ where: { email: mixed.email } })).toBe(0);
    });

    it('asks which branch when the restaurant has more than one', async () => {
      const multi = await registerTenantE2E(server);
      const second = await prisma().branch.create({
        data: { tenantId: multi.tenantId, name: 'Filial', code: `FILIAL-${uniqueSuffix()}` },
      });

      const missing = await post(multi.accessToken, '/v1/users', staffBody('CASHIER')).expect(400);
      expect(missing.body.code).toBe('BRANCHES_REQUIRED');
      const empty = await post(multi.accessToken, '/v1/users', staffBody('CASHIER', { branchIds: [] })).expect(400);
      expect(empty.body.code).toBe('BRANCHES_REQUIRED');

      const chosen = await createStaff(multi.accessToken, 'CASHIER', { branchIds: [second.id] });
      expect(chosen.body.branchIds).toEqual([second.id]);
      // An ADMIN works every branch: none has to be named.
      const admin = await createStaff(multi.accessToken, 'ADMIN');
      expect(admin.body.branchIds).toEqual([]);
    });
  });

  describe('who may manage whom', () => {
    let ctx: Ctx;
    let ownerId: string;
    let admin: { id: string; token: string };
    let manager: { id: string; token: string };
    let cashier: { id: string; token: string };

    beforeAll(async () => {
      ctx = await registerTenantE2E(server);
      ownerId = claims(ctx.accessToken).sub;
      const make = async (role: string) => {
        const staff = await createStaff(ctx.accessToken, role);
        return { id: staff.id, token: (await login(staff.email)).accessToken };
      };
      admin = await make('ADMIN');
      manager = await make('MANAGER');
      cashier = await make('CASHIER');
    });

    it('keeps staff without users.create or users.update out', async () => {
      await post(cashier.token, '/v1/users', staffBody('WAITER')).expect(403);
      await get(cashier.token, '/v1/users').expect(403);
      // The manager sees the team (users.read) but does not change it.
      await get(manager.token, '/v1/users').expect(200);
      await post(manager.token, '/v1/users', staffBody('WAITER')).expect(403);
      await patch(manager.token, `/v1/users/${cashier.id}`, { name: 'Outro Nome' }).expect(403);
      await post(manager.token, `/v1/users/${cashier.id}/reset-password`, { password: PASSWORD }).expect(403);
    });

    it('lets an ADMIN manage the operational staff but never mint or touch an ADMIN', async () => {
      const waiter = await createStaff(admin.token, 'WAITER');
      await patch(admin.token, `/v1/users/${waiter.id}`, { role: 'KITCHEN' }).expect(200);

      const mint = await post(admin.token, '/v1/users', staffBody('ADMIN')).expect(403);
      expect(mint.body.code).toBe('ROLE_NOT_ASSIGNABLE');
      const promote = await patch(admin.token, `/v1/users/${waiter.id}`, { role: 'ADMIN' }).expect(403);
      expect(promote.body.code).toBe('ROLE_NOT_ASSIGNABLE');

      const peer = await createStaff(ctx.accessToken, 'ADMIN');
      const touch = await patch(admin.token, `/v1/users/${peer.id}`, { active: false }).expect(403);
      expect(touch.body.code).toBe('USER_PROTECTED');
    });

    it('protects the owner account from everyone and nobody from changing themselves', async () => {
      const byAdmin = await patch(admin.token, `/v1/users/${ownerId}`, { active: false }).expect(403);
      expect(byAdmin.body.code).toBe('USER_PROTECTED');
      const reset = await post(admin.token, `/v1/users/${ownerId}/reset-password`, { password: PASSWORD }).expect(403);
      expect(reset.body.code).toBe('USER_PROTECTED');

      const ownerSelf = await patch(ctx.accessToken, `/v1/users/${ownerId}`, { role: 'CASHIER' }).expect(403);
      expect(ownerSelf.body.code).toBe('CANNOT_MANAGE_SELF');
      const adminSelf = await patch(admin.token, `/v1/users/${admin.id}`, { active: false }).expect(403);
      expect(adminSelf.body.code).toBe('CANNOT_MANAGE_SELF');

      const owner = await get(ctx.accessToken, `/v1/users/${ownerId}`).expect(200);
      expect(owner.body).toMatchObject({ status: 'ACTIVE', roles: ['OWNER'] });
    });

    it('answers 404 for a user of another restaurant, without changing anything', async () => {
      const other = await registerTenantE2E(server);
      await patch(other.accessToken, `/v1/users/${cashier.id}`, { active: false }).expect(404);
      await post(other.accessToken, `/v1/users/${cashier.id}/reset-password`, { password: 'OutraSenha1!' }).expect(404);
      await patch(other.accessToken, '/v1/users/not-a-uuid', { active: false }).expect(400);

      const still = await get(ctx.accessToken, `/v1/users/${cashier.id}`).expect(200);
      expect(still.body.status).toBe('ACTIVE');
      await get(cashier.token, '/v1/auth/me').expect(200);
    });
  });

  describe('update', () => {
    let ctx: Ctx;
    beforeAll(async () => {
      ctx = await registerTenantE2E(server);
    });

    it('changes the role and ends the sessions that still carried the old one', async () => {
      const staff = await createStaff(ctx.accessToken, 'CASHIER');
      const before = await login(staff.email);
      await get(before.accessToken, '/v1/auth/me').expect(200);

      const res = await patch(ctx.accessToken, `/v1/users/${staff.id}`, { role: 'WAITER' }).expect(200);
      expect(res.body.roles).toEqual(['WAITER']);
      expect(res.body.branchIds).toEqual([ctx.branchId]);

      const stale = await get(before.accessToken, '/v1/auth/me').expect(401);
      expect(stale.body.code).toBe('SESSION_REVOKED');
      await request(server).post('/v1/auth/refresh').set('Cookie', before.cookie).expect(401);

      const after = await login(staff.email);
      expect(claims(after.accessToken).roles).toEqual(['WAITER']);
      expect(claims(after.accessToken).permissions).toContain('tabs.create');
      expect(claims(after.accessToken).permissions).not.toContain('pos.create');
      expect(await prisma().userRole.count({ where: { userId: staff.id } })).toBe(1);

      const entries = (await audits(ctx.tenantId, 'USER_UPDATED')).filter((e) => e.entityId === staff.id);
      expect(entries).toHaveLength(1);
      expect(entries[0].beforeData).toMatchObject({ roles: ['CASHIER'], status: 'ACTIVE' });
      expect(entries[0].afterData).toMatchObject({ roles: ['WAITER'], status: 'ACTIVE' });
    });

    it('inactivates an account (no more sign-in, sessions ended) and reactivates it', async () => {
      const staff = await createStaff(ctx.accessToken, 'CASHIER');
      const before = await login(staff.email);

      const off = await patch(ctx.accessToken, `/v1/users/${staff.id}`, { active: false }).expect(200);
      expect(off.body.status).toBe('INACTIVE');
      await get(before.accessToken, '/v1/auth/me').expect(401);
      await request(server).post('/v1/auth/refresh').set('Cookie', before.cookie).expect(401);
      const refused = await request(server)
        .post('/v1/auth/login')
        .send({ email: staff.email, password: PASSWORD })
        .expect(401);
      expect(refused.body.code).toBe('USER_NOT_ACTIVE');

      const on = await patch(ctx.accessToken, `/v1/users/${staff.id}`, { active: true }).expect(200);
      expect(on.body.status).toBe('ACTIVE');
      await login(staff.email);
    });

    it('renames and moves between branches without ending the session', async () => {
      const second = await prisma().branch.create({
        data: { tenantId: ctx.tenantId, name: 'Filial', code: `FILIAL-${uniqueSuffix()}` },
      });
      const staff = await createStaff(ctx.accessToken, 'CASHIER', { branchIds: [ctx.branchId] });
      const session = await login(staff.email);

      const res = await patch(ctx.accessToken, `/v1/users/${staff.id}`, {
        name: 'Nome Novo',
        branchIds: [second.id],
      }).expect(200);
      expect(res.body).toMatchObject({ name: 'Nome Novo', branchIds: [second.id], roles: ['CASHIER'] });

      // Same token: the branch links are re-read on every request.
      const branches = await get(session.accessToken, '/v1/branches/accessible').expect(200);
      expect(branches.body.map((b: { id: string }) => b.id)).toEqual([second.id]);

      const none = await patch(ctx.accessToken, `/v1/users/${staff.id}`, { branchIds: [] }).expect(400);
      expect(none.body.code).toBe('BRANCHES_REQUIRED');
    });

    it('changes nothing and audits nothing when the values are the same', async () => {
      // ctx has two active branches by now (previous test), so the branch is named.
      const staff = await createStaff(ctx.accessToken, 'KITCHEN', { branchIds: [ctx.branchId] });
      const session = await login(staff.email);
      const res = await patch(ctx.accessToken, `/v1/users/${staff.id}`, {
        name: staff.body.name,
        role: 'KITCHEN',
        active: true,
        branchIds: [ctx.branchId],
      }).expect(200);
      expect(res.body.roles).toEqual(['KITCHEN']);
      await get(session.accessToken, '/v1/auth/me').expect(200);
      const entries = (await audits(ctx.tenantId, 'USER_UPDATED')).filter((e) => e.entityId === staff.id);
      expect(entries).toHaveLength(0);
    });

    it('gives a branch to an ADMIN demoted to a role that needs one', async () => {
      const staff = await createStaff(ctx.accessToken, 'ADMIN');
      expect(staff.body.branchIds).toEqual([]);
      // ctx has two active branches by now (previous test), so the branch has to be named.
      const missing = await patch(ctx.accessToken, `/v1/users/${staff.id}`, { role: 'CASHIER' }).expect(400);
      expect(missing.body.code).toBe('BRANCHES_REQUIRED');
      const res = await patch(ctx.accessToken, `/v1/users/${staff.id}`, {
        role: 'CASHIER',
        branchIds: [ctx.branchId],
      }).expect(200);
      expect(res.body).toMatchObject({ roles: ['CASHIER'], branchIds: [ctx.branchId] });
    });
  });
});
