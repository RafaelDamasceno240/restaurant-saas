import { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import { RoleName } from '@prisma/client';
import request from 'supertest';
import { createTestApp, getPrisma, uniqueSuffix, uniqueDocument } from './test-app.util';

// This slice (KDS) reuses GET /v1/orders and PATCH /v1/orders/:id/status
// verbatim — no new endpoints. Tenant isolation and invalid-transition
// rejection on those two routes are already proven, endpoint-wide (not
// role-specific), by apps/api/test/orders-admin.e2e-spec.ts — repeating
// them here would just re-test the same guard/service code path. What's
// actually new in this slice is: (1) the list response now carries `items`
// (covered by an assertion added to orders-admin.e2e-spec.ts), and (2) a
// KITCHEN-role account, which no prior test had exercised, can drive the
// whole operational flow through those same endpoints.
describe('KDS (kitchen role access) (e2e)', () => {
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

  async function placeOrder(slug: string, productId: string, notes?: string) {
    const res = await request(server)
      .post('/v1/public/orders')
      .send({
        restaurantSlug: slug,
        items: [{ productId, quantity: 2 }],
        customer: { name: 'Cliente Cozinha', phone: '11987654321' },
        fulfillmentType: 'PICKUP',
        paymentMethod: 'CASH',
        notes,
      })
      .expect(201);
    return res.body as { id: string };
  }

  // Same bypass used in fatia 05's tests: no user-invite endpoint exists
  // yet, so a limited-role account is created directly via Prisma and then
  // logged in for real through /auth/login.
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

  it('a KITCHEN user can list orders by status (with items) and drive the full flow to COMPLETED', async () => {
    const { accessToken, slug, tenantId } = await registerTenant();
    const product = await createActiveProduct(accessToken, 'X-Burger', 24.9);
    const order = await placeOrder(slug, product.id, 'Sem cebola');
    const kitchenToken = await createStaffAndLogin(tenantId, 'KITCHEN');

    // KDS-style call: filtered list, same shape the cozinha page uses.
    const pendingList = await request(server)
      .get('/v1/orders?status=PENDING&pageSize=50')
      .set('Authorization', `Bearer ${kitchenToken}`)
      .expect(200);
    const found = pendingList.body.data.find((o: { id: string }) => o.id === order.id);
    expect(found).toBeDefined();
    expect(found.items).toEqual([expect.objectContaining({ name: 'X-Burger', quantity: 2 })]);
    expect(found.notes).toBe('Sem cebola');

    for (const status of ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED']) {
      const res = await request(server)
        .patch(`/v1/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${kitchenToken}`)
        .send({ status })
        .expect(200);
      expect(res.body.status).toBe(status);
    }
  });

  it('a KITCHEN user cannot cancel (has orders.update but not orders.cancel)', async () => {
    const { accessToken, slug, tenantId } = await registerTenant();
    const product = await createActiveProduct(accessToken, 'Produto', 10);
    const order = await placeOrder(slug, product.id);
    const kitchenToken = await createStaffAndLogin(tenantId, 'KITCHEN');

    await request(server)
      .patch(`/v1/orders/${order.id}/status`)
      .set('Authorization', `Bearer ${kitchenToken}`)
      .send({ status: 'CANCELLED' })
      .expect(403);
  });
});
