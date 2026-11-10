import { INestApplication } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import * as argon2 from 'argon2';
import request from 'supertest';
import {
  createActiveProductE2E,
  createTestApp,
  getPrisma,
  provisionTenantE2E,
  tenantPayloadE2E,
  uniqueDocument,
  uniqueSuffix,
} from './test-app.util';

// Super Admin MVP (2026-10-28): /v1/platform is the only place that reads across tenants, and
// only a platform administrator (platform_admins) gets in. Anonymous 401; every tenant role,
// OWNER and ADMIN included, 403. The tenant routes stay exactly as isolated as before.
describe('Platform administration (e2e)', () => {
  let app: INestApplication;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let server: any;
  const PASSWORD = 'Sup3rSecret!';

  // The platform team's own account: OWNER of its own restaurant, plus the platform grant.
  let admin: { userId: string; tenantId: string; email: string; token: string };
  // A customer restaurant with its owner signed in.
  let customer: {
    tenantId: string;
    branchId: string;
    ownerUserId: string;
    slug: string;
    ownerToken: string;
  };

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();

    const team = tenantPayloadE2E();
    const teamTenant = await provisionTenantE2E(app, {
      ...team,
      tenantName: `Equipe Plataforma ${uniqueSuffix()}`,
    });
    await getPrisma(app).platformAdmin.create({
      data: { userId: teamTenant.ownerUserId, grantedBy: 'e2e' },
    });
    admin = {
      userId: teamTenant.ownerUserId,
      tenantId: teamTenant.tenantId,
      email: team.email,
      token: await login(team.email),
    };

    const payload = tenantPayloadE2E();
    const created = await provisionTenantE2E(app, payload);
    customer = { ...created, slug: payload.slug, ownerToken: await login(payload.email) };
  });

  afterAll(async () => {
    await app.close();
  });

  async function login(email: string, password = PASSWORD): Promise<string> {
    const res = await request(server).post('/v1/auth/login').send({ email, password }).expect(200);
    return res.body.accessToken as string;
  }

  // A staff account of `tenantId` with one role, signed in for real.
  async function staff(tenantId: string, role: RoleName) {
    const prisma = getPrisma(app);
    const email = `staff-${role.toLowerCase()}-${uniqueSuffix()}@example.com`;
    const user = await prisma.user.create({
      data: {
        tenantId,
        name: `Staff ${role}`,
        email,
        passwordHash: await argon2.hash(PASSWORD),
        status: 'ACTIVE',
      },
    });
    const roleRow = await prisma.role.findUniqueOrThrow({ where: { name: role } });
    await prisma.userRole.create({ data: { userId: user.id, roleId: roleRow.id, tenantId } });
    return { userId: user.id, email, token: await login(email) };
  }

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const newTenantBody = (overrides: Record<string, string> = {}) => {
    const suffix = uniqueSuffix();
    return {
      tenantName: `Restaurante Painel ${suffix}`,
      legalName: `Empresa Painel ${suffix} LTDA`,
      document: uniqueDocument(),
      slug: `painel-${suffix}`,
      branchName: 'Matriz Centro',
      userName: `Dono Painel ${suffix}`,
      email: `dono-painel-${suffix}@example.com`,
      password: 'Senha#Painel-2026',
      ...overrides,
    };
  };

  // Every platform route, as a non-admin would try it.
  const platformCalls = () => [
    { method: 'get' as const, path: '/v1/platform/overview' },
    { method: 'get' as const, path: '/v1/platform/tenants' },
    { method: 'get' as const, path: `/v1/platform/tenants/${customer.tenantId}` },
    { method: 'post' as const, path: '/v1/platform/tenants', body: newTenantBody() },
    {
      method: 'post' as const,
      path: `/v1/platform/tenants/${customer.tenantId}/suspend`,
      body: { reason: 'Teste de acesso' },
    },
    { method: 'post' as const, path: `/v1/platform/tenants/${customer.tenantId}/reactivate` },
  ];

  const counts = async () => {
    const prisma = getPrisma(app);
    return {
      tenants: await prisma.tenant.count(),
      users: await prisma.user.count(),
      platformAudits: await prisma.auditLog.count({
        where: { action: { startsWith: 'PLATFORM_' } },
      }),
      customerStatus: (await prisma.tenant.findUniqueOrThrow({ where: { id: customer.tenantId } }))
        .status,
    };
  };

  describe('who gets in', () => {
    it('1. anonymous: 401 on every platform route', async () => {
      for (const call of platformCalls()) {
        const res = await request(server)
          [call.method](call.path)
          .send(call.body ?? {});
        expect([call.path, res.status]).toEqual([call.path, 401]);
      }
    });

    it.each(['CASHIER', 'WAITER', 'KITCHEN', 'VIEWER', 'MANAGER', 'ADMIN', 'OWNER'] as RoleName[])(
      '2-4, 6-8. %s of a restaurant: 403 on every platform route, and nothing changes',
      async (role) => {
        const before = await counts();
        const account =
          role === 'OWNER' ? { token: customer.ownerToken } : await staff(customer.tenantId, role);
        for (const call of platformCalls()) {
          const res = await request(server)
            [call.method](call.path)
            .set(auth(account.token))
            .send(call.body ?? {});
          expect([call.path, res.status, res.body.code]).toEqual([
            call.path,
            403,
            'PLATFORM_ADMIN_REQUIRED',
          ]);
        }
        const after = await counts();
        // A staff account was created for the test itself; nothing else moved.
        expect({ ...after, users: before.users }).toEqual(before);
        expect(after.customerStatus).toBe('TRIAL');
      },
    );

    it('5. the platform administrator gets in', async () => {
      const overview = await request(server)
        .get('/v1/platform/overview')
        .set(auth(admin.token))
        .expect(200);
      expect(overview.body.total).toBeGreaterThanOrEqual(2);
      expect(Object.keys(overview.body.byStatus).sort()).toEqual([
        'ACTIVE',
        'CANCELLED',
        'SUSPENDED',
        'TRIAL',
      ]);
      await request(server)
        .get(`/v1/platform/tenants/${customer.tenantId}`)
        .set(auth(admin.token))
        .expect(200);
    });

    it('a revoked grant stops working on the next request, with the same token', async () => {
      const team = await provisionTenantE2E(app);
      const prisma = getPrisma(app);
      const owner = await prisma.user.findUniqueOrThrow({ where: { id: team.ownerUserId } });
      await prisma.platformAdmin.create({ data: { userId: owner.id } });
      const token = await login(owner.email);
      await request(server).get('/v1/platform/overview').set(auth(token)).expect(200);
      await prisma.platformAdmin.delete({ where: { userId: owner.id } });
      await request(server).get('/v1/platform/overview').set(auth(token)).expect(403);
    });

    it('/auth/me tells the web who may see /super-admin', async () => {
      const me = await request(server).get('/v1/auth/me').set(auth(admin.token)).expect(200);
      expect(me.body.isPlatformAdmin).toBe(true);
      const owner = await request(server)
        .get('/v1/auth/me')
        .set(auth(customer.ownerToken))
        .expect(200);
      expect(owner.body.isPlatformAdmin).toBe(false);
    });

    it('6-7. there is still no tenant route that lists restaurants, and another restaurant stays invisible', async () => {
      await request(server).get('/v1/tenants').set(auth(customer.ownerToken)).expect(404);
      const current = await request(server)
        .get('/v1/tenants/current')
        .set(auth(customer.ownerToken))
        .expect(200);
      expect(current.body.id).toBe(customer.tenantId);
      await request(server)
        .get(`/v1/users/${admin.userId}`)
        .set(auth(customer.ownerToken))
        .expect(404);
    });
  });

  describe('listing and searching', () => {
    const marker = `busca${uniqueSuffix().replace(/[^a-z0-9]/gi, '')}`.toLowerCase();
    const made: { id: string; slug: string; email: string }[] = [];

    beforeAll(async () => {
      for (const i of [1, 2, 3]) {
        const payload = { ...tenantPayloadE2E(), tenantName: `Marcador ${marker} ${i}` };
        const created = await provisionTenantE2E(app, payload);
        made.push({ id: created.tenantId, slug: payload.slug, email: payload.email });
      }
    });

    it('9. lists restaurants of many tenants, with the OWNER e-mail and the number of units', async () => {
      const res = await request(server)
        .get('/v1/platform/tenants')
        .query({ search: marker })
        .set(auth(admin.token))
        .expect(200);
      expect(res.body.meta).toEqual({ page: 1, pageSize: 20, total: 3, totalPages: 1 });
      expect(res.body.items.map((t: { id: string }) => t.id).sort()).toEqual(
        made.map((t) => t.id).sort(),
      );
      for (const item of res.body.items) {
        expect(Object.keys(item).sort()).toEqual(
          ['branchCount', 'createdAt', 'id', 'name', 'ownerEmail', 'slug', 'status'].sort(),
        );
        expect(item.branchCount).toBe(1);
        expect(item.ownerEmail).toBe(made.find((t) => t.id === item.id)?.email);
      }
    });

    it('10. paginates (never the whole table at once)', async () => {
      const page1 = await request(server)
        .get('/v1/platform/tenants')
        .query({ search: marker, pageSize: 2, page: 1 })
        .set(auth(admin.token))
        .expect(200);
      const page2 = await request(server)
        .get('/v1/platform/tenants')
        .query({ search: marker, pageSize: 2, page: 2 })
        .set(auth(admin.token))
        .expect(200);
      expect(page1.body.items).toHaveLength(2);
      expect(page2.body.items).toHaveLength(1);
      expect(page1.body.meta).toMatchObject({ total: 3, totalPages: 2 });
      const ids = [...page1.body.items, ...page2.body.items].map((t: { id: string }) => t.id);
      expect(new Set(ids).size).toBe(3);

      const all = await request(server)
        .get('/v1/platform/tenants')
        .set(auth(admin.token))
        .expect(200);
      expect(all.body.items.length).toBeLessThanOrEqual(20);
      await request(server)
        .get('/v1/platform/tenants')
        .query({ pageSize: 51 })
        .set(auth(admin.token))
        .expect(400);
    });

    it('11. searches by name, by slug and by OWNER e-mail, ignoring case', async () => {
      const search = async (term: string) =>
        (
          await request(server)
            .get('/v1/platform/tenants')
            .query({ search: term })
            .set(auth(admin.token))
            .expect(200)
        ).body.items.map((t: { id: string }) => t.id);
      expect(await search(made[0].slug.toUpperCase())).toEqual([made[0].id]);
      expect(await search(made[1].email.toUpperCase())).toEqual([made[1].id]);
      expect(await search(`MARCADOR ${marker.toUpperCase()} 3`)).toEqual([made[2].id]);
      expect(await search(`nada-${marker}`)).toEqual([]);
    });
  });

  describe('creating a restaurant from the panel', () => {
    it('12-16. goes through the provisioning service: TRIAL, Matriz with delivery OFF, an OWNER, both audit entries, no password anywhere', async () => {
      const body = newTenantBody();
      const res = await request(server)
        .post('/v1/platform/tenants')
        .set(auth(admin.token))
        .send(body)
        .expect(201);

      expect(res.body).toMatchObject({
        name: body.tenantName,
        slug: body.slug,
        status: 'TRIAL',
        timezone: 'America/Sao_Paulo',
        mainBranchDeliveryEnabled: false,
        userCount: 1,
        owners: [
          expect.objectContaining({ email: body.email, name: body.userName, status: 'ACTIVE' }),
        ],
      });
      expect(res.body.document).toMatch(/^\d{2}\.\*{3}\.\*{3}\/\*{4}-\d{2}$/);
      const text = JSON.stringify(res.body);
      expect(text).not.toContain(body.password);
      expect(text).not.toMatch(/passwordHash|tokenHash|\$argon2/);

      const prisma = getPrisma(app);
      const tenant = await prisma.tenant.findUniqueOrThrow({
        where: { slug: body.slug },
        include: { branches: true },
      });
      expect(tenant.branches).toEqual([
        expect.objectContaining({
          name: 'Matriz Centro',
          code: 'MATRIZ',
          deliveryEnabled: false,
          status: 'ACTIVE',
        }),
      ]);
      const owner = await prisma.user.findUniqueOrThrow({
        where: { email: body.email },
        include: { userRoles: { include: { role: true } }, userBranches: true },
      });
      expect(owner.userRoles.map((ur) => ur.role.name)).toEqual(['OWNER']);
      expect(owner.userBranches.map((ub) => ub.branchId)).toEqual([tenant.branches[0].id]);

      const audits = await prisma.auditLog.findMany({
        where: { entityId: tenant.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(audits.map((a) => [a.action, a.userId])).toEqual([
        ['TENANT_PROVISIONED', owner.id],
        ['PLATFORM_TENANT_CREATED', admin.userId],
      ]);
      expect(audits[0].afterData).toMatchObject({
        provisionedBy: expect.stringContaining(admin.email),
      });
      expect(JSON.stringify(audits)).not.toContain(body.password);

      // The new owner signs in like any other account.
      await login(body.email, body.password);
    });

    it('17-19. a slug, a document or an e-mail already in use: 409 naming the field, nothing created', async () => {
      const existing = newTenantBody();
      await request(server)
        .post('/v1/platform/tenants')
        .set(auth(admin.token))
        .send(existing)
        .expect(201);
      const before = await counts();

      for (const [clash, code, field] of [
        [{ slug: existing.slug }, 'SLUG_ALREADY_EXISTS', 'slug'],
        [{ document: existing.document }, 'DOCUMENT_ALREADY_EXISTS', 'document'],
        [{ email: existing.email }, 'EMAIL_ALREADY_EXISTS', 'email'],
      ] as const) {
        const res = await request(server)
          .post('/v1/platform/tenants')
          .set(auth(admin.token))
          .send(newTenantBody(clash))
          .expect(409);
        expect(res.body.code).toBe(code);
        expect(res.body.details).toEqual([expect.objectContaining({ field })]);
      }
      expect(await counts()).toEqual(before);
    });

    it('invalid data: 400, nothing created, and the password is not repeated back', async () => {
      const before = await counts();
      const body = newTenantBody({ slug: 'Slug Inválido', password: 'curta' });
      const res = await request(server)
        .post('/v1/platform/tenants')
        .set(auth(admin.token))
        .send(body)
        .expect(400);
      expect(JSON.stringify(res.body)).not.toContain('curta');
      expect(await counts()).toEqual(before);
      await request(server)
        .post('/v1/platform/tenants')
        .set(auth(admin.token))
        .send({ ...newTenantBody(), tenantId: admin.tenantId })
        .expect(400);
    });
  });

  describe('suspending and reactivating', () => {
    it('20-23, 11. suspends without deleting anything, blocks the restaurant at once, leaves the others alone, and reactivates it', async () => {
      const prisma = getPrisma(app);
      const a = tenantPayloadE2E();
      const b = tenantPayloadE2E();
      const createdA = await provisionTenantE2E(app, a);
      await provisionTenantE2E(app, b);
      const ownerA = await request(server)
        .post('/v1/auth/login')
        .send({ email: a.email, password: a.password })
        .expect(200);
      const tokenA = ownerA.body.accessToken as string;
      const refreshCookieA = ownerA.headers['set-cookie'];
      const tokenB = await login(b.email);
      const productA = await createActiveProductE2E(server, tokenA, 'X-Burger', 20);
      const productB = await createActiveProductE2E(server, tokenB, 'X-Salada', 22);
      const order = (slug: string, productId: string) => ({
        restaurantSlug: slug,
        items: [{ productId, quantity: 1 }],
        customer: { name: 'Cliente Teste', phone: '11987654321' },
        fulfillmentType: 'PICKUP',
        paymentMethod: 'CASH',
      });
      await request(server).post('/v1/public/orders').send(order(a.slug, productA.id)).expect(201);

      const footprint = async () => ({
        users: await prisma.user.count({ where: { tenantId: createdA.tenantId } }),
        branches: await prisma.branch.count({ where: { tenantId: createdA.tenantId } }),
        products: await prisma.product.count({ where: { tenantId: createdA.tenantId } }),
        orders: await prisma.order.count({ where: { tenantId: createdA.tenantId } }),
        categories: await prisma.category.count({ where: { tenantId: createdA.tenantId } }),
      });
      const before = await footprint();

      // A reason is required.
      await request(server)
        .post(`/v1/platform/tenants/${createdA.tenantId}/suspend`)
        .set(auth(admin.token))
        .send({})
        .expect(400);
      // The OWNER cannot do it through the platform API.
      await request(server)
        .post(`/v1/platform/tenants/${createdA.tenantId}/suspend`)
        .set(auth(tokenA))
        .send({ reason: 'Eu mesmo' })
        .expect(403);

      const suspended = await request(server)
        .post(`/v1/platform/tenants/${createdA.tenantId}/suspend`)
        .set(auth(admin.token))
        .send({ reason: '  Pagamento em atraso  ' })
        .expect(200);
      expect(suspended.body.status).toBe('SUSPENDED');
      expect(suspended.body.suspension).toMatchObject({
        action: 'PLATFORM_TENANT_SUSPENDED',
        reason: 'Pagamento em atraso',
        by: { email: admin.email, name: expect.any(String) },
      });

      // 21. Blocked now: the token it already had, the refresh cookie, a new login, the public side.
      await request(server).get('/v1/auth/me').set(auth(tokenA)).expect(401);
      await request(server).get('/v1/products').set(auth(tokenA)).expect(401);
      await request(server).post('/v1/auth/refresh').set('Cookie', refreshCookieA).expect(401);
      const relogin = await request(server)
        .post('/v1/auth/login')
        .send({ email: a.email, password: a.password })
        .expect(403);
      expect(relogin.body.code).toBe('TENANT_NOT_ACTIVE');
      await request(server).get(`/v1/public/menu/${a.slug}`).expect(404);
      await request(server).post('/v1/public/orders').send(order(a.slug, productA.id)).expect(404);

      // 22. Nothing was deleted.
      expect(await footprint()).toEqual(before);

      // 11. The other restaurant keeps working.
      await request(server).get('/v1/auth/me').set(auth(tokenB)).expect(200);
      await request(server).get(`/v1/public/menu/${b.slug}`).expect(200);
      await request(server).post('/v1/public/orders').send(order(b.slug, productB.id)).expect(201);

      // Twice is refused; reactivating something not suspended is refused.
      await request(server)
        .post(`/v1/platform/tenants/${createdA.tenantId}/suspend`)
        .set(auth(admin.token))
        .send({ reason: 'De novo' })
        .expect(409);
      await request(server)
        .post(`/v1/platform/tenants/${customer.tenantId}/reactivate`)
        .set(auth(admin.token))
        .expect(409);

      // 23. Reactivation: back to TRIAL (what it was), same data, access back.
      const reactivated = await request(server)
        .post(`/v1/platform/tenants/${createdA.tenantId}/reactivate`)
        .set(auth(admin.token))
        .expect(200);
      expect(reactivated.body.status).toBe('TRIAL');
      expect(reactivated.body.suspension).toBeNull();
      expect(reactivated.body.history.map((h: { action: string }) => h.action).slice(0, 2)).toEqual(
        ['PLATFORM_TENANT_REACTIVATED', 'PLATFORM_TENANT_SUSPENDED'],
      );
      expect(await footprint()).toEqual(before);
      const back = await login(a.email, a.password);
      await request(server).get('/v1/auth/me').set(auth(back)).expect(200);
      await request(server).get(`/v1/public/menu/${a.slug}`).expect(200);

      const audits = await prisma.auditLog.findMany({
        where: {
          entityId: createdA.tenantId,
          action: { in: ['PLATFORM_TENANT_SUSPENDED', 'PLATFORM_TENANT_REACTIVATED'] },
        },
        orderBy: { createdAt: 'asc' },
      });
      expect(audits.map((x) => [x.action, x.userId, x.tenantId])).toEqual([
        ['PLATFORM_TENANT_SUSPENDED', admin.userId, createdA.tenantId],
        ['PLATFORM_TENANT_REACTIVATED', admin.userId, createdA.tenantId],
      ]);
      expect(audits[0].afterData).toMatchObject({ reason: 'Pagamento em atraso' });
    });

    it('the administrator cannot suspend the restaurant of their own account', async () => {
      const res = await request(server)
        .post(`/v1/platform/tenants/${admin.tenantId}/suspend`)
        .set(auth(admin.token))
        .send({ reason: 'Teste' })
        .expect(409);
      expect(res.body.code).toBe('CANNOT_SUSPEND_OWN_TENANT');
    });
  });

  describe('24. the tenant routes stay tenant-scoped, for the platform administrator too', () => {
    it("the administrator's token only reaches their own restaurant outside /platform", async () => {
      const current = await request(server)
        .get('/v1/tenants/current')
        .set(auth(admin.token))
        .expect(200);
      expect(current.body.id).toBe(admin.tenantId);
      const users = await request(server).get('/v1/users').set(auth(admin.token)).expect(200);
      expect(users.body.every((u: { tenantId: string }) => u.tenantId === admin.tenantId)).toBe(
        true,
      );
      await request(server)
        .get(`/v1/users/${customer.ownerUserId}`)
        .set(auth(admin.token))
        .expect(404);
      await request(server)
        .get('/v1/products')
        .set(auth(admin.token))
        .expect(200)
        .then((res) => {
          const items = Array.isArray(res.body)
            ? res.body
            : (res.body.items ?? res.body.data ?? []);
          expect(
            items.every((p: { tenantId?: string }) => !p.tenantId || p.tenantId === admin.tenantId),
          ).toBe(true);
        });
    });

    it('an owner keeps seeing only their own restaurant', async () => {
      const users = await request(server)
        .get('/v1/users')
        .set(auth(customer.ownerToken))
        .expect(200);
      // The owner plus the staff accounts the role tests above created, all of this restaurant.
      expect(users.body.length).toBeGreaterThan(1);
      expect(new Set(users.body.map((u: { tenantId: string }) => u.tenantId))).toEqual(
        new Set([customer.tenantId]),
      );
    });
  });
});
