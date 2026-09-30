import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { hashToken } from '../src/modules/auth/token.util';
import {
  createActiveProductE2E,
  createStaffAndLoginE2E,
  createTestApp,
  getPrisma,
  registerTenantE2E,
  uniqueDocument,
  uniqueSuffix,
} from './test-app.util';

describe('Security hardening (e2e)', () => {
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

  function sell(token: string, body: Record<string, unknown>) {
    return request(server).post('/v1/pos/orders').set(auth(token)).send(body);
  }

  describe('orders are scoped to the caller branches', () => {
    async function setup() {
      const tenant = await registerTenantE2E(server);
      const branchB = await getPrisma(app).branch.create({
        data: { tenantId: tenant.tenantId, name: 'Filial', code: 'FILIAL' },
      });
      const product = await createActiveProductE2E(server, tenant.accessToken, 'X-Burger', 20);
      const manager = await createStaffAndLoginE2E(app, server, tenant.tenantId, 'MANAGER', [tenant.branchId]);
      const orderA = await sell(tenant.accessToken, {
        branchId: tenant.branchId,
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: 'PIX',
      }).expect(201);
      const orderB = await sell(tenant.accessToken, {
        branchId: branchB.id,
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: 'PIX',
      }).expect(201);
      return { ...tenant, branchB, manager, orderA: orderA.body, orderB: orderB.body };
    }

    it('lists only orders of the branches the user is linked to', async () => {
      const { manager, accessToken, orderA, orderB } = await setup();

      const scoped = await request(server).get('/v1/orders').set(auth(manager)).expect(200);
      const scopedIds = scoped.body.data.map((o: { id: string }) => o.id);
      expect(scopedIds).toContain(orderA.id);
      expect(scopedIds).not.toContain(orderB.id);

      const all = await request(server).get('/v1/orders').set(auth(accessToken)).expect(200);
      const allIds = all.body.data.map((o: { id: string }) => o.id);
      expect(allIds).toEqual(expect.arrayContaining([orderA.id, orderB.id]));
    });

    it('rejects filtering by a branch the user cannot access', async () => {
      const { manager, branchB } = await setup();
      const res = await request(server).get(`/v1/orders?branchId=${branchB.id}`).set(auth(manager)).expect(403);
      expect(res.body.code).toBe('BRANCH_ACCESS_DENIED');
    });

    it('hides the detail of an order from another branch', async () => {
      const { manager, orderA, orderB } = await setup();
      await request(server).get(`/v1/orders/${orderA.id}`).set(auth(manager)).expect(200);
      await request(server).get(`/v1/orders/${orderB.id}`).set(auth(manager)).expect(404);
    });

    it('does not let the user change the status of an order from another branch', async () => {
      const { manager, accessToken, orderA, orderB } = await setup();
      await request(server)
        .patch(`/v1/orders/${orderB.id}/status`)
        .set(auth(manager))
        .send({ status: 'CONFIRMED' })
        .expect(404);
      await request(server)
        .patch(`/v1/orders/${orderA.id}/status`)
        .set(auth(manager))
        .send({ status: 'CONFIRMED' })
        .expect(200);
      const untouched = await request(server).get(`/v1/orders/${orderB.id}`).set(auth(accessToken)).expect(200);
      expect(untouched.body.status).toBe('PENDING');
    });
  });

  describe('order creation is idempotent', () => {
    it('PDV: the same key returns the same order and creates a single one', async () => {
      const { accessToken, branchId, tenantId } = await registerTenantE2E(server);
      const product = await createActiveProductE2E(server, accessToken, 'X-Burger', 20);
      const key = `pos-${uniqueSuffix()}`;
      const body = { branchId, items: [{ productId: product.id, quantity: 2 }], paymentMethod: 'PIX', idempotencyKey: key };

      const first = await sell(accessToken, body).expect(201);
      const second = await sell(accessToken, body).expect(201);

      expect(second.body.id).toBe(first.body.id);
      expect(await getPrisma(app).order.count({ where: { tenantId, idempotencyKey: key } })).toBe(1);
    });

    it('PDV: concurrent submissions with the same key create a single order', async () => {
      const { accessToken, branchId, tenantId } = await registerTenantE2E(server);
      const product = await createActiveProductE2E(server, accessToken, 'X-Burger', 20);
      const key = `pos-${uniqueSuffix()}`;
      const body = { branchId, items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'PIX', idempotencyKey: key };

      const results = await Promise.all([sell(accessToken, body), sell(accessToken, body), sell(accessToken, body)]);

      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(await getPrisma(app).order.count({ where: { tenantId, idempotencyKey: key } })).toBe(1);
    });

    it('PDV: reusing a key for a different sale is rejected', async () => {
      const { accessToken, branchId } = await registerTenantE2E(server);
      const product = await createActiveProductE2E(server, accessToken, 'X-Burger', 20);
      const key = `pos-${uniqueSuffix()}`;

      await sell(accessToken, {
        branchId,
        items: [{ productId: product.id, quantity: 1 }],
        paymentMethod: 'PIX',
        idempotencyKey: key,
      }).expect(201);
      const conflict = await sell(accessToken, {
        branchId,
        items: [{ productId: product.id, quantity: 3 }],
        paymentMethod: 'PIX',
        idempotencyKey: key,
      }).expect(409);
      expect(conflict.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('public checkout: the same key returns the same order', async () => {
      const { accessToken, slug, tenantId } = await registerTenantE2E(server);
      const product = await createActiveProductE2E(server, accessToken, 'X-Burger', 20);
      const key = `web-${uniqueSuffix()}`;
      const body = {
        restaurantSlug: slug,
        items: [{ productId: product.id, quantity: 1 }],
        customer: { name: 'Maria', phone: '11987654321' },
        fulfillmentType: 'PICKUP',
        paymentMethod: 'PIX',
        idempotencyKey: key,
      };

      const first = await request(server).post('/v1/public/orders').send(body).expect(201);
      const second = await request(server).post('/v1/public/orders').send(body).expect(201);

      expect(second.body.id).toBe(first.body.id);
      expect(await getPrisma(app).order.count({ where: { tenantId, idempotencyKey: key } })).toBe(1);
    });

    it('public checkout: a key used by another customer payload is rejected', async () => {
      const { accessToken, slug } = await registerTenantE2E(server);
      const product = await createActiveProductE2E(server, accessToken, 'X-Burger', 20);
      const key = `web-${uniqueSuffix()}`;
      const body = {
        restaurantSlug: slug,
        items: [{ productId: product.id, quantity: 1 }],
        customer: { name: 'Maria', phone: '11987654321' },
        fulfillmentType: 'PICKUP',
        paymentMethod: 'PIX',
        idempotencyKey: key,
      };
      await request(server).post('/v1/public/orders').send(body).expect(201);
      await request(server)
        .post('/v1/public/orders')
        .send({ ...body, customer: { name: 'Outra Pessoa', phone: '11900000000' } })
        .expect(409);
    });

    it('orders without a key keep working and are never merged', async () => {
      const { accessToken, branchId } = await registerTenantE2E(server);
      const product = await createActiveProductE2E(server, accessToken, 'X-Burger', 20);
      const body = { branchId, items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'PIX' };
      const first = await sell(accessToken, body).expect(201);
      const second = await sell(accessToken, body).expect(201);
      expect(second.body.id).not.toBe(first.body.id);
    });
  });

  describe('suspended restaurants', () => {
    async function registerWithCookie() {
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
      const res = await request(server).post('/v1/auth/register').send(payload).expect(201);
      const cookie = (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
      return { payload, cookie, tenantId: res.body.user.tenantId as string };
    }

    it.each(['SUSPENDED', 'CANCELLED'] as const)('%s tenants cannot log in, refresh or be reached publicly', async (status) => {
      const { payload, cookie, tenantId } = await registerWithCookie();
      await request(server).get(`/v1/public/menu/${payload.slug}`).expect(200);

      await getPrisma(app).tenant.update({ where: { id: tenantId }, data: { status } });

      const login = await request(server)
        .post('/v1/auth/login')
        .send({ email: payload.email, password: payload.password })
        .expect(403);
      expect(login.body.code).toBe('TENANT_NOT_ACTIVE');
      await request(server).post('/v1/auth/refresh').set('Cookie', cookie).expect(401);
      await request(server).get(`/v1/public/menu/${payload.slug}`).expect(404);
      await request(server)
        .post('/v1/public/orders')
        .send({
          restaurantSlug: payload.slug,
          items: [{ productId: '00000000-0000-0000-0000-000000000000', quantity: 1 }],
          customer: { name: 'Maria', phone: '11987654321' },
          fulfillmentType: 'PICKUP',
          paymentMethod: 'PIX',
        })
        .expect(404);
    });

    it('TRIAL tenants keep working', async () => {
      const { payload } = await registerWithCookie();
      await request(server).post('/v1/auth/login').send({ email: payload.email, password: payload.password }).expect(200);
    });
  });

  describe('refresh token rotation', () => {
    async function registerWithCookie() {
      const suffix = uniqueSuffix();
      const res = await request(server)
        .post('/v1/auth/register')
        .send({
          tenantName: `Restaurante ${suffix}`,
          legalName: `Restaurante LTDA ${suffix}`,
          document: uniqueDocument(),
          slug: `tenant-${suffix}`,
          branchName: 'Matriz',
          userName: `Owner ${suffix}`,
          email: `owner-${suffix}@example.com`,
          password: 'Sup3rSecret!',
        })
        .expect(201);
      return (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
    }

    const cookieOf = (res: request.Response) => (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];

    it('only one of two concurrent refreshes with the same token wins', async () => {
      const cookie = await registerWithCookie();
      const [a, b] = await Promise.all([
        request(server).post('/v1/auth/refresh').set('Cookie', cookie),
        request(server).post('/v1/auth/refresh').set('Cookie', cookie),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 401]);
    });

    it('a rotated token replayed right away is rejected without killing the new session', async () => {
      const cookie = await registerWithCookie();
      const rotated = await request(server).post('/v1/auth/refresh').set('Cookie', cookie).expect(200);
      await request(server).post('/v1/auth/refresh').set('Cookie', cookie).expect(401);
      await request(server).post('/v1/auth/refresh').set('Cookie', cookieOf(rotated)).expect(200);
    });

    it('a token reused after the grace window revokes every session of the user', async () => {
      const cookie = await registerWithCookie();
      const rotated = await request(server).post('/v1/auth/refresh').set('Cookie', cookie).expect(200);
      const oldToken = cookie.split('=')[1];
      await getPrisma(app).refreshToken.update({
        where: { tokenHash: hashToken(oldToken) },
        data: { revokedAt: new Date(Date.now() - 60_000) },
      });

      await request(server).post('/v1/auth/refresh').set('Cookie', cookie).expect(401);
      await request(server).post('/v1/auth/refresh').set('Cookie', cookieOf(rotated)).expect(401);
    });
  });

  describe('login rate limit', () => {
    it('answers 429 after too many attempts from the same client', async () => {
      const limited = await createTestApp();
      const previous = process.env.AUTH_RATE_LIMIT_PER_MINUTE;
      process.env.AUTH_RATE_LIMIT_PER_MINUTE = '3';
      try {
        const limitedServer = limited.getHttpServer();
        const attempt = () =>
          request(limitedServer).post('/v1/auth/login').send({ email: 'nobody@example.com', password: 'wrong-password' });
        await attempt().expect(401);
        await attempt().expect(401);
        await attempt().expect(401);
        await attempt().expect(429);
      } finally {
        process.env.AUTH_RATE_LIMIT_PER_MINUTE = previous;
        await limited.close();
      }
    });
  });
});
