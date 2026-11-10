import { BadRequestException, ConflictException, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { ProvisionTenantDto } from '../src/modules/tenants/dto/provision-tenant.dto';
import {
  createTestApp,
  getPrisma,
  provisionAndSignInE2E,
  provisionTenantE2E,
  tenantPayloadE2E,
  uniqueSuffix,
} from './test-app.util';

// 2026-10-28: the service is sold, not self-service. A restaurant exists because it was provisioned
// (TenantProvisioningService, no HTTP route), never because someone called the API: the public
// POST /auth/register is gone, with nothing in its place. The e2e specs run one at a time
// (maxWorkers 1), so counting every tenant and every OWNER around a request is reliable here.
describe('No public sign-up (e2e)', () => {
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

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const totals = async () => {
    const prisma = getPrisma(app);
    return {
      tenants: await prisma.tenant.count(),
      branches: await prisma.branch.count(),
      users: await prisma.user.count(),
      owners: await prisma.userRole.count({ where: { role: { name: 'OWNER' } } }),
    };
  };
  const traces = async (payload: ProvisionTenantDto) => {
    const prisma = getPrisma(app);
    return {
      tenants: await prisma.tenant.count({
        where: { OR: [{ slug: payload.slug }, { document: payload.document }] },
      }),
      users: await prisma.user.count({ where: { email: payload.email } }),
    };
  };

  describe('the old sign-up address', () => {
    it('anonymous POST /v1/auth/register answers 404 and creates no restaurant and no owner', async () => {
      const payload = tenantPayloadE2E();
      const before = await totals();

      const res = await request(server).post('/v1/auth/register').send(payload).expect(404);

      expect(res.body).toMatchObject({ code: 'NOT_FOUND' });
      expect(res.headers['set-cookie']).toBeUndefined();
      expect(res.body.accessToken).toBeUndefined();
      expect(await traces(payload)).toEqual({ tenants: 0, users: 0 });
      expect(await totals()).toEqual(before);
    });

    it('a signed-in owner cannot use it to open another restaurant either', async () => {
      const mine = await provisionAndSignInE2E(app);
      const payload = tenantPayloadE2E();
      const before = await totals();

      await request(server)
        .post('/v1/auth/register')
        .set(auth(mine.body.accessToken))
        .send(payload)
        .expect(404);

      expect(await traces(payload)).toEqual({ tenants: 0, users: 0 });
      expect(await totals()).toEqual(before);
    });

    // No other address does it under another name, with or without a session.
    it.each([
      ['POST', '/v1/auth/signup'],
      ['POST', '/v1/auth/sign-up'],
      ['POST', '/v1/auth/registration'],
      ['POST', '/v1/register'],
      ['POST', '/v1/signup'],
      ['POST', '/v1/tenants'],
      ['POST', '/v1/tenants/register'],
      ['POST', '/v1/restaurants'],
      ['POST', '/auth/register'],
      ['PUT', '/v1/auth/register'],
      ['GET', '/v1/auth/register'],
    ] as const)('%s %s creates nothing', async (method, path) => {
      const owner = await provisionAndSignInE2E(app);
      const payload = tenantPayloadE2E();
      const before = await totals();
      const call = (token?: string) => {
        const req =
          method === 'GET'
            ? request(server).get(path)
            : method === 'PUT'
              ? request(server).put(path)
              : request(server).post(path);
        if (token) req.set(auth(token));
        return method === 'GET' ? req : req.send(payload);
      };

      const anonymous = await call();
      const signedIn = await call(owner.body.accessToken);

      expect([anonymous.status, signedIn.status]).toEqual([404, 404]);
      expect(await traces(payload)).toEqual({ tenants: 0, users: 0 });
      expect(await totals()).toEqual(before);
    });
  });

  describe('provisioning (internal service, no route)', () => {
    it('creates the restaurant, its first branch and the OWNER, who then signs in like anyone', async () => {
      const payload = tenantPayloadE2E();
      const { tenantId, branchId, ownerUserId } = await provisionTenantE2E(app, payload);
      const prisma = getPrisma(app);

      expect(await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } })).toMatchObject({
        slug: payload.slug,
        document: payload.document,
        status: 'TRIAL',
      });
      expect(await prisma.branch.findUniqueOrThrow({ where: { id: branchId } })).toMatchObject({
        tenantId,
        code: 'MATRIZ',
        deliveryEnabled: false,
      });
      const roles = await prisma.userRole.findMany({
        where: { userId: ownerUserId },
        include: { role: true },
      });
      expect(roles.map((r) => [r.role.name, r.tenantId])).toEqual([['OWNER', tenantId]]);
      expect(await prisma.userBranch.count({ where: { userId: ownerUserId, branchId } })).toBe(1);
      expect(
        await prisma.auditLog.count({
          where: { tenantId, action: 'TENANT_PROVISIONED', entityId: tenantId },
        }),
      ).toBe(1);
      // Provisioning hands out no session: nothing until the owner signs in.
      expect(await prisma.refreshToken.count({ where: { userId: ownerUserId } })).toBe(0);

      const login = await request(server)
        .post('/v1/auth/login')
        .send({ email: payload.email, password: payload.password })
        .expect(200);
      expect(login.body.user).toMatchObject({ id: ownerUserId, tenantId, roles: ['OWNER'] });
    });

    it('refuses a slug, a document or an e-mail already in use, and leaves nothing behind', async () => {
      const first = tenantPayloadE2E();
      await provisionTenantE2E(app, first);
      const before = await totals();

      const sameSlug = { ...tenantPayloadE2E(), slug: first.slug };
      const sameDocument = { ...tenantPayloadE2E(), document: first.document };
      const sameEmail = { ...tenantPayloadE2E(), email: first.email };
      await expect(provisionTenantE2E(app, sameSlug)).rejects.toBeInstanceOf(ConflictException);
      await expect(provisionTenantE2E(app, sameDocument)).rejects.toBeInstanceOf(ConflictException);
      await expect(provisionTenantE2E(app, sameEmail)).rejects.toMatchObject({
        response: { code: 'EMAIL_ALREADY_EXISTS' },
      });

      expect(await totals()).toEqual(before);
    });

    it('applies the rules a request body would, whoever calls it', async () => {
      const before = await totals();
      for (const bad of [
        { ...tenantPayloadE2E(), slug: 'Com Espaço' },
        { ...tenantPayloadE2E(), document: '123' },
        { ...tenantPayloadE2E(), password: 'curta' },
        { ...tenantPayloadE2E(), email: 'sem-arroba' },
        { ...tenantPayloadE2E(), status: 'ACTIVE' } as ProvisionTenantDto,
      ]) {
        await expect(provisionTenantE2E(app, bad)).rejects.toBeInstanceOf(BadRequestException);
      }
      expect(await totals()).toEqual(before);
    });
  });

  describe('what keeps working', () => {
    it('login, refresh and logout of an existing account', async () => {
      const payload = tenantPayloadE2E();
      await provisionTenantE2E(app, payload);

      await request(server)
        .post('/v1/auth/login')
        .send({ email: payload.email, password: 'senha-errada' })
        .expect(401);
      const login = await request(server)
        .post('/v1/auth/login')
        .send({ email: payload.email, password: payload.password })
        .expect(200);
      const cookie = (login.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
      await request(server).get('/v1/auth/me').set(auth(login.body.accessToken)).expect(200);

      const refreshed = await request(server)
        .post('/v1/auth/refresh')
        .set('Cookie', cookie)
        .expect(200);
      expect(refreshed.body.accessToken).not.toBe(login.body.accessToken);
      await request(server).post('/v1/auth/refresh').set('Cookie', cookie).expect(401);

      const current = (refreshed.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
      await request(server).post('/v1/auth/logout').set('Cookie', current).expect(204);
      await request(server).post('/v1/auth/refresh').set('Cookie', current).expect(401);
      await request(server).get('/v1/auth/me').set(auth(refreshed.body.accessToken)).expect(401);
    });

    it('the owner creates internal staff, who sign in; nobody gets OWNER through the users API', async () => {
      const owner = await provisionAndSignInE2E(app);
      const token = owner.body.accessToken as string;
      const branches = await request(server)
        .get('/v1/branches/accessible')
        .set(auth(token))
        .expect(200);
      const staff = (role: string) => ({
        name: `Equipe ${role}`,
        email: `staff-${uniqueSuffix()}@example.com`,
        password: 'Sup3rSecret!',
        role,
        branchIds: [branches.body[0].id],
      });

      const cashier = staff('CASHIER');
      await request(server).post('/v1/users').set(auth(token)).send(cashier).expect(201);
      const login = await request(server)
        .post('/v1/auth/login')
        .send({ email: cashier.email, password: cashier.password })
        .expect(200);
      expect(login.body.user).toMatchObject({
        tenantId: owner.body.user.tenantId,
        roles: ['CASHIER'],
      });

      const before = await totals();
      await request(server).post('/v1/users').set(auth(token)).send(staff('OWNER')).expect(400);
      await request(server).post('/v1/users').send(staff('CASHIER')).expect(401);
      expect((await totals()).owners).toBe(before.owners);
    });

    it('restaurants stay isolated from each other', async () => {
      const a = await provisionAndSignInE2E(app);
      const b = await provisionAndSignInE2E(app);

      await request(server)
        .get(`/v1/users/${b.body.user.id}`)
        .set(auth(a.body.accessToken))
        .expect(404);
      const users = await request(server)
        .get('/v1/users')
        .set(auth(a.body.accessToken))
        .expect(200);
      expect(JSON.stringify(users.body)).not.toContain(b.body.user.id);
    });
  });
});
