import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createActiveProductE2E,
  createStaffAndLoginE2E,
  createTestApp,
  getPrisma,
  registerTenantE2E,
} from './test-app.util';

// Rewritten in fatia 08: PDV orders now require a validated branchId, and
// CASH sales require an OPEN cash session for that branch.
describe('PDV (counter orders) (e2e)', () => {
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

  async function setup() {
    const tenant = await registerTenantE2E(server);
    const cashier = await createStaffAndLoginE2E(app, server, tenant.tenantId, 'CASHIER', [tenant.branchId]);
    return { ...tenant, cashier };
  }

  function sell(token: string, body: Record<string, unknown>) {
    return request(server).post('/v1/pos/orders').set('Authorization', `Bearer ${token}`).send(body);
  }

  it('CASHIER sees the catalog via the existing admin endpoints', async () => {
    const { accessToken, cashier } = await setup();
    await createActiveProductE2E(server, accessToken, 'X-Burger', 24.9);
    await request(server).get('/v1/products').set('Authorization', `Bearer ${cashier}`).expect(200);
    await request(server).get('/v1/categories').set('Authorization', `Bearer ${cashier}`).expect(200);
  });

  it('creates a PIX counter order with source=COUNTER, branchId and correct total', async () => {
    const { accessToken, cashier, branchId } = await setup();
    const burger = await createActiveProductE2E(server, accessToken, 'X-Burger', 24.9);
    const fries = await createActiveProductE2E(server, accessToken, 'Batata', 12);

    const res = await sell(cashier, {
      branchId,
      items: [
        { productId: burger.id, quantity: 2 },
        { productId: fries.id, quantity: 1 },
      ],
      paymentMethod: 'PIX',
    }).expect(201);

    expect(res.body.source).toBe('COUNTER');
    expect(res.body.branchId).toBe(branchId);
    expect(res.body.total).toBeCloseTo(61.8);
    expect(res.body.customerName).toBeNull();
  });

  it('accepts optional customer identification', async () => {
    const { accessToken, cashier, branchId } = await setup();
    const product = await createActiveProductE2E(server, accessToken, 'Produto', 10);
    const res = await sell(cashier, {
      branchId,
      items: [{ productId: product.id, quantity: 1 }],
      customerName: 'Cliente Balcão',
      customerPhone: '11987654321',
      paymentMethod: 'CARD',
    }).expect(201);
    expect(res.body.customerName).toBe('Cliente Balcão');
  });

  it('rejects a CASH sale when no cash session is open — and persists no order', async () => {
    const { accessToken, cashier, branchId, tenantId } = await setup();
    const product = await createActiveProductE2E(server, accessToken, 'Produto', 10);

    const res = await sell(cashier, {
      branchId,
      items: [{ productId: product.id, quantity: 1 }],
      paymentMethod: 'CASH',
    }).expect(409);
    expect(res.body.code).toBe('CASH_REGISTER_NOT_OPEN');
    expect(await getPrisma(app).order.count({ where: { tenantId } })).toBe(0);
  });

  it('rejects nonexistent, inactive, or another-tenant products', async () => {
    const a = await setup();
    const b = await registerTenantE2E(server);
    const inactive = await createActiveProductE2E(server, a.accessToken, 'Inativo', 10, false);
    const productB = await createActiveProductE2E(server, b.accessToken, 'Produto B', 10);
    for (const productId of ['00000000-0000-0000-0000-000000000000', inactive.id, productB.id]) {
      await sell(a.cashier, { branchId: a.branchId, items: [{ productId, quantity: 1 }], paymentMethod: 'PIX' }).expect(400);
    }
  });

  it('rejects invalid quantity and an empty cart', async () => {
    const { accessToken, cashier, branchId } = await setup();
    const product = await createActiveProductE2E(server, accessToken, 'Produto', 10);
    await sell(cashier, { branchId, items: [{ productId: product.id, quantity: 0 }], paymentMethod: 'PIX' }).expect(400);
    await sell(cashier, { branchId, items: [], paymentMethod: 'PIX' }).expect(400);
  });

  it('MANDATORY: rejects smuggled priceCents/subtotal/total (strict whitelist → 400)', async () => {
    const { accessToken, cashier, branchId } = await setup();
    const product = await createActiveProductE2E(server, accessToken, 'Produto Caro', 29.9);
    await sell(cashier, {
      branchId,
      items: [{ productId: product.id, quantity: 1, priceCents: 1 }],
      paymentMethod: 'PIX',
      total: 0.01,
    }).expect(400);
  });

  it("rejects another tenant's branch (404) and an unlinked branch of the same tenant (403)", async () => {
    const a = await setup();
    const b = await registerTenantE2E(server);
    const product = await createActiveProductE2E(server, a.accessToken, 'Produto', 10);
    const otherBranch = await getPrisma(app).branch.create({
      data: { tenantId: a.tenantId, name: 'Filial', code: 'FILIAL' },
    });

    await sell(a.cashier, { branchId: b.branchId, items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'PIX' }).expect(404);
    await sell(a.cashier, { branchId: otherBranch.id, items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'PIX' }).expect(403);
  });

  it('a role without pos.create (WAITER) is rejected', async () => {
    const { accessToken, tenantId, branchId } = await setup();
    const product = await createActiveProductE2E(server, accessToken, 'Produto', 10);
    const waiter = await createStaffAndLoginE2E(app, server, tenantId, 'WAITER', [branchId]);
    await sell(waiter, { branchId, items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'PIX' }).expect(403);
  });
});
