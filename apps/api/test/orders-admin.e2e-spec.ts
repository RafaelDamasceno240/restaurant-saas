import { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import { RoleName } from '@prisma/client';
import request from 'supertest';
import { createTestApp, getPrisma, uniqueSuffix, uniqueDocument } from './test-app.util';

describe('Admin orders panel (e2e)', () => {
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

  async function registerTenant() {
    const suffix = uniqueSuffix();
    const slug = `tenant-${suffix}`;
    const payload = {
      tenantName: `Restaurante ${suffix}`,
      legalName: `Restaurante LTDA ${suffix}`,
      document: uniqueDocument(),
      slug,
      branchName: 'Matriz',
      userName: `Owner ${suffix}`,
      email: `owner-${suffix}@example.com`,
      password: 'Sup3rSecret!',
    };
    const res = await request(server).post('/v1/auth/register').send(payload).expect(201);
    return {
      accessToken: res.body.accessToken as string,
      slug,
      tenantId: res.body.user.tenantId as string,
    };
  }

  async function createActiveProduct(token: string, name: string, price: number) {
    const category = await request(server)
      .post('/v1/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Categoria ${name}` })
      .expect(201);
    const product = await request(server)
      .post('/v1/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ categoryId: category.body.id, name, price })
      .expect(201);
    return product.body as { id: string };
  }

  async function placeOrder(slug: string, productId: string, quantity = 1) {
    const res = await request(server)
      .post('/v1/public/orders')
      .send({
        restaurantSlug: slug,
        items: [{ productId, quantity }],
        customer: { name: 'Cliente Teste', phone: '11987654321' },
        fulfillmentType: 'PICKUP',
        paymentMethod: 'CASH',
      })
      .expect(201);
    return res.body as { id: string; status: string };
  }

  // Bypasses the API on purpose: there is no user-invite endpoint yet in
  // this MVP (register() always creates an OWNER), so a direct Prisma
  // insert + a real /auth/login is the only way to get a token for a
  // limited-permission role to test the PermissionsGuard actually blocking
  // someone — filling exactly the gap noted as a limitation in Phase 01.
  async function createStaffAndLogin(tenantId: string, roleName: RoleName) {
    const prisma = getPrisma(app);
    const suffix = uniqueSuffix();
    const email = `staff-${suffix}@example.com`;
    const password = 'Sup3rSecret!';
    const passwordHash = await argon2.hash(password);
    const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
    const user = await prisma.user.create({
      data: { tenantId, name: `Staff ${roleName}`, email, passwordHash, status: 'ACTIVE' },
    });
    await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, tenantId } });
    const branches = await prisma.branch.findMany({ where: { tenantId }, select: { id: true } });
    for (const branch of branches) {
      await prisma.userBranch.create({ data: { userId: user.id, branchId: branch.id } });
    }

    const login = await request(server).post('/v1/auth/login').send({ email, password }).expect(200);
    return login.body.accessToken as string;
  }

  it('lists orders for the authenticated tenant, newest first', async () => {
    const { accessToken, slug } = await registerTenant();
    const product = await createActiveProduct(accessToken, 'Produto', 10);
    const first = await placeOrder(slug, product.id);
    const second = await placeOrder(slug, product.id);

    const res = await request(server)
      .get('/v1/orders')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.data.map((o: { id: string }) => o.id)).toEqual([second.id, first.id]);
    expect(res.body.meta.total).toBe(2);
    expect(res.body.data[0].itemCount).toBe(1);
    // Added in fatia 06 (KDS needs items without an extra request per
    // card) — additive to the fatia 05 list response, itemCount unaffected.
    expect(res.body.data[0].items).toHaveLength(1);
    expect(res.body.data[0].items[0]).toMatchObject({ name: 'Produto', quantity: 1 });
    expect(res.body.data[0]).toHaveProperty('notes');
  });

  it('filters orders by status', async () => {
    const { accessToken, slug } = await registerTenant();
    const product = await createActiveProduct(accessToken, 'Produto', 10);
    const order = await placeOrder(slug, product.id);
    await placeOrder(slug, product.id); // stays PENDING

    await request(server)
      .patch(`/v1/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'CONFIRMED' })
      .expect(200);

    const confirmed = await request(server)
      .get('/v1/orders?status=CONFIRMED')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(confirmed.body.data).toHaveLength(1);
    expect(confirmed.body.data[0].id).toBe(order.id);

    const pending = await request(server)
      .get('/v1/orders?status=PENDING')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(pending.body.data).toHaveLength(1);
  });

  it('paginates the order list', async () => {
    const { accessToken, slug } = await registerTenant();
    const product = await createActiveProduct(accessToken, 'Produto', 10);
    await placeOrder(slug, product.id);
    await placeOrder(slug, product.id);
    await placeOrder(slug, product.id);

    const page1 = await request(server)
      .get('/v1/orders?page=1&pageSize=2')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.meta).toMatchObject({ page: 1, pageSize: 2, total: 3, totalPages: 2 });

    const page2 = await request(server)
      .get('/v1/orders?page=2&pageSize=2')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(page2.body.data).toHaveLength(1);
  });

  it('returns full order detail from OrderItem snapshots, not a fresh Product lookup', async () => {
    const { accessToken, slug } = await registerTenant();
    const product = await createActiveProduct(accessToken, 'Produto Original', 20);
    const order = await placeOrder(slug, product.id, 2);

    // Change the product's price/name AFTER the order — the detail must
    // keep showing what was actually paid, not the current product state.
    await request(server)
      .patch(`/v1/products/${product.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Produto Renomeado', price: 999 })
      .expect(200);

    const detail = await request(server)
      .get(`/v1/orders/${order.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(detail.body.items[0].name).toBe('Produto Original');
    expect(detail.body.items[0].unitPrice).toBe(20);
    expect(detail.body.customerPhone).toBe('11987654321'); // staff view DOES include it
  });

  it('walks the full valid status flow PENDING -> CONFIRMED -> PREPARING -> READY -> COMPLETED', async () => {
    const { accessToken, slug } = await registerTenant();
    const product = await createActiveProduct(accessToken, 'Produto', 10);
    const order = await placeOrder(slug, product.id);

    for (const status of ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED']) {
      const res = await request(server)
        .patch(`/v1/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ status })
        .expect(200);
      expect(res.body.status).toBe(status);
    }
  });

  it('rejects an invalid jump (PENDING -> COMPLETED) and a transition out of a terminal status', async () => {
    const { accessToken, slug } = await registerTenant();
    const product = await createActiveProduct(accessToken, 'Produto', 10);
    const order = await placeOrder(slug, product.id);

    await request(server)
      .patch(`/v1/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'COMPLETED' })
      .expect(409);

    await request(server)
      .patch(`/v1/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'CANCELLED' })
      .expect(200);

    // CANCELLED is terminal — nothing moves it anywhere else.
    await request(server)
      .patch(`/v1/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'CONFIRMED' })
      .expect(409);
  });

  it('records an audit log entry when the status changes', async () => {
    const { accessToken, slug, tenantId } = await registerTenant();
    const product = await createActiveProduct(accessToken, 'Produto', 10);
    const order = await placeOrder(slug, product.id);

    await request(server)
      .patch(`/v1/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ status: 'CONFIRMED' })
      .expect(200);

    const prisma = getPrisma(app);
    const log = await prisma.auditLog.findFirst({
      where: { tenantId, entity: 'Order', entityId: order.id, action: 'ORDER_STATUS_CHANGED' },
      orderBy: { createdAt: 'desc' },
    });
    expect(log).not.toBeNull();
    expect(log?.beforeData).toMatchObject({ status: 'PENDING' });
    expect(log?.afterData).toMatchObject({ status: 'CONFIRMED' });
  });

  it("tenant A cannot list, read or update tenant B's orders", async () => {
    const tenantA = await registerTenant();
    const tenantB = await registerTenant();
    const productB = await createActiveProduct(tenantB.accessToken, 'Produto B', 10);
    const orderB = await placeOrder(tenantB.slug, productB.id);

    const listA = await request(server)
      .get('/v1/orders')
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .expect(200);
    expect(listA.body.data.map((o: { id: string }) => o.id)).not.toContain(orderB.id);

    await request(server)
      .get(`/v1/orders/${orderB.id}`)
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .expect(404);

    await request(server)
      .patch(`/v1/orders/${orderB.id}/status`)
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .send({ status: 'CONFIRMED' })
      .expect(404);
  });

  it('a WAITER (orders.read but not orders.update) can list orders but cannot change status', async () => {
    const { accessToken, slug, tenantId } = await registerTenant();
    const product = await createActiveProduct(accessToken, 'Produto', 10);
    const order = await placeOrder(slug, product.id);
    const waiterToken = await createStaffAndLogin(tenantId, 'WAITER');

    await request(server)
      .get('/v1/orders')
      .set('Authorization', `Bearer ${waiterToken}`)
      .expect(200);

    await request(server)
      .patch(`/v1/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${waiterToken}`)
      .send({ status: 'CONFIRMED' })
      .expect(403);
  });

  it('a MANAGER can update status AND cancel (has orders.update and orders.cancel)', async () => {
    const { accessToken, slug, tenantId } = await registerTenant();
    // Fixtures created with the OWNER token (guaranteed full permissions);
    // only the actual status-change assertion below uses the MANAGER token.
    const product = await createActiveProduct(accessToken, 'Produto', 10);
    const order = await placeOrder(slug, product.id);
    const managerToken = await createStaffAndLogin(tenantId, 'MANAGER');

    const res = await request(server)
      .patch(`/v1/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${managerToken}`)
      .send({ status: 'CANCELLED' })
      .expect(200);
    expect(res.body.status).toBe('CANCELLED');
  });
});
