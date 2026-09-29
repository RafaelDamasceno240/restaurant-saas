import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createActiveProductE2E,
  createStaffAndLoginE2E,
  createTestApp,
  getPrisma,
  registerTenantE2E,
  uniqueSuffix,
} from './test-app.util';

// Fatia 10 — POST /v1/tabs/:id/checkout: Tab -> paid Order, atomically and
// idempotently.
describe('Tab checkout (fechamento financeiro) (e2e)', () => {
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
  const newKey = () => `chk-${uniqueSuffix()}`;

  function checkout(token: string, tabId: string, paymentMethod: string, idempotencyKey = newKey()) {
    return request(server)
      .post(`/v1/tabs/${tabId}/checkout`)
      .set(auth(token))
      .send({ paymentMethod, idempotencyKey });
  }

  function openCash(token: string, branchId: string) {
    return request(server)
      .post('/v1/cash/sessions')
      .set(auth(token))
      .send({ branchId, openingBalanceCents: 10000 })
      .expect(201)
      .then((r) => r.body as { id: string });
  }

  // Tenant + table + OPEN tab with the given items already added.
  async function setupTab(items: { name: string; price: number; quantity: number }[] = [{ name: 'X-Burger', price: 29.9, quantity: 2 }]) {
    const tenant = await registerTenantE2E(server);
    const table = (
      await request(server)
        .post('/v1/tables')
        .set(auth(tenant.accessToken))
        .send({ branchId: tenant.branchId, number: 1 })
        .expect(201)
    ).body;
    const tab = (
      await request(server)
        .post('/v1/tabs')
        .set(auth(tenant.accessToken))
        .send({ branchId: tenant.branchId, tableId: table.id, customerName: 'Mesa da janela' })
        .expect(201)
    ).body;
    const products: { id: string }[] = [];
    for (const item of items) {
      const product = await createActiveProductE2E(server, tenant.accessToken, item.name, item.price);
      products.push(product);
      await request(server)
        .post(`/v1/tabs/${tab.id}/items`)
        .set(auth(tenant.accessToken))
        .send({ productId: product.id, quantity: item.quantity })
        .expect(201);
    }
    return { ...tenant, table, tab: tab as { id: string }, products };
  }

  // 1, 2, 4, 7, 10, 11
  it('checks out with CASH: creates the Order, a CONFIRMED payment, a SALE movement, and closes the tab', async () => {
    const { accessToken, branchId, tenantId, tab, table } = await setupTab([
      { name: 'X-Burger', price: 29.9, quantity: 2 },
      { name: 'Suco', price: 8.5, quantity: 1 },
    ]);
    const session = await openCash(accessToken, branchId);

    const res = await checkout(accessToken, tab.id, 'CASH').expect(200);
    expect(res.body.status).toBe('CLOSED');
    expect(res.body.idempotentReplay).toBe(false);
    expect(res.body.order.status).toBe('COMPLETED');
    expect(res.body.order.paymentMethod).toBe('CASH');
    expect(res.body.order.totalCents).toBe(6830); // 2*2990 + 850
    expect(res.body.order.payment).toMatchObject({ status: 'CONFIRMED', method: 'CASH', amountCents: 6830 });

    const prisma = getPrisma(app);
    const order = await prisma.order.findUniqueOrThrow({ where: { tabId: tab.id }, include: { items: true } });
    expect(order).toMatchObject({
      tenantId,
      branchId,
      source: 'TABLE',
      fulfillmentType: 'DINE_IN',
      status: 'COMPLETED',
      paymentMethod: 'CASH',
      subtotalCents: 6830,
      totalCents: 6830,
      customerName: 'Mesa da janela',
    });
    expect(order.items).toHaveLength(2);

    const movements = await prisma.cashMovement.findMany({ where: { orderId: order.id } });
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({ type: 'SALE', amountCents: 6830, sessionId: session.id });

    const tableAfter = await request(server).get(`/v1/tables/${table.id}`).set(auth(accessToken)).expect(200);
    expect(tableAfter.body.status).toBe('AVAILABLE');

    // The sale is a normal Order for the admin screens (no special-casing).
    const adminOrder = await request(server).get(`/v1/orders/${order.id}`).set(auth(accessToken)).expect(200);
    expect(adminOrder.body.source).toBe('TABLE');
    expect(adminOrder.body.total).toBeCloseTo(68.3);
  });

  // 3, 5
  it('prices OrderItems from the TabItem snapshots, even after the product price changed', async () => {
    const { accessToken, tab, products } = await setupTab([{ name: 'X-Burger', price: 29.9, quantity: 1 }]);
    await request(server)
      .patch(`/v1/products/${products[0].id}`)
      .set(auth(accessToken))
      .send({ price: 34.9, name: 'X-Burger Novo' })
      .expect(200);

    const res = await checkout(accessToken, tab.id, 'PIX').expect(200);
    expect(res.body.order.totalCents).toBe(2990);

    const order = await getPrisma(app).order.findUniqueOrThrow({ where: { tabId: tab.id }, include: { items: true } });
    expect(order.items[0]).toMatchObject({
      productId: products[0].id,
      productNameSnapshot: 'X-Burger',
      unitPriceCents: 2990,
      quantity: 1,
      subtotalCents: 2990,
    });
  });

  // 6
  it('requires an OPEN cash session for CASH — rejects and persists nothing', async () => {
    const { accessToken, tab, tenantId } = await setupTab();
    const res = await checkout(accessToken, tab.id, 'CASH').expect(409);
    expect(res.body.code).toBe('CASH_REGISTER_NOT_OPEN');

    const prisma = getPrisma(app);
    expect(await prisma.order.count({ where: { tenantId } })).toBe(0);
    expect(await prisma.payment.count({ where: { tenantId } })).toBe(0);
    const tabAfter = await request(server).get(`/v1/tabs/${tab.id}`).set(auth(accessToken)).expect(200);
    expect(tabAfter.body.status).toBe('OPEN');
    expect(tabAfter.body.order).toBeNull();
    expect(tabAfter.body.branchCashRegisterOpen).toBe(false);
  });

  // 8, 9
  it.each(['PIX', 'CARD'])('checks out with %s: confirmed payment, no cash movement', async (method) => {
    const { accessToken, tab } = await setupTab();
    const res = await checkout(accessToken, tab.id, method).expect(200);
    expect(res.body.order.paymentMethod).toBe(method);
    expect(res.body.order.payment).toMatchObject({ status: 'CONFIRMED', method, amountCents: 5980 });

    const order = await getPrisma(app).order.findUniqueOrThrow({ where: { tabId: tab.id } });
    expect(await getPrisma(app).cashMovement.count({ where: { orderId: order.id } })).toBe(0);
  });

  // 12, 18
  it('refuses a second checkout of the same tab with a different key', async () => {
    const { accessToken, tab, tenantId } = await setupTab();
    await checkout(accessToken, tab.id, 'PIX').expect(200);
    const res = await checkout(accessToken, tab.id, 'CARD').expect(409);
    expect(res.body.code).toBe('TAB_ALREADY_CLOSED');
    expect(await getPrisma(app).order.count({ where: { tenantId } })).toBe(1);
  });

  // 13
  it('a repeated idempotencyKey returns the existing sale instead of duplicating it', async () => {
    const { accessToken, branchId, tab, tenantId } = await setupTab();
    await openCash(accessToken, branchId);
    const key = newKey();

    const first = await checkout(accessToken, tab.id, 'CASH', key).expect(200);
    const second = await checkout(accessToken, tab.id, 'CASH', key).expect(200);
    expect(second.body.idempotentReplay).toBe(true);
    expect(second.body.order.id).toBe(first.body.order.id);

    const prisma = getPrisma(app);
    expect(await prisma.order.count({ where: { tenantId } })).toBe(1);
    expect(await prisma.payment.count({ where: { tenantId } })).toBe(1);
    expect(await prisma.cashMovement.count({ where: { tenantId, type: 'SALE' } })).toBe(1);
  });

  it('refuses an idempotencyKey already used for another tab', async () => {
    const a = await setupTab();
    const secondTable = (
      await request(server).post('/v1/tables').set(auth(a.accessToken)).send({ branchId: a.branchId, number: 2 }).expect(201)
    ).body;
    const secondTab = (
      await request(server).post('/v1/tabs').set(auth(a.accessToken)).send({ branchId: a.branchId, tableId: secondTable.id }).expect(201)
    ).body;
    await request(server)
      .post(`/v1/tabs/${secondTab.id}/items`)
      .set(auth(a.accessToken))
      .send({ productId: a.products[0].id, quantity: 1 })
      .expect(201);
    const key = newKey();

    await checkout(a.accessToken, a.tab.id, 'PIX', key).expect(200);
    const res = await checkout(a.accessToken, secondTab.id, 'PIX', key).expect(409);
    expect(res.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    const secondAfter = await request(server).get(`/v1/tabs/${secondTab.id}`).set(auth(a.accessToken)).expect(200);
    expect(secondAfter.body.status).toBe('OPEN');
  });

  // 14
  it('concurrent checkouts with the SAME key: one sale, one payment, one SALE — all get the same result', async () => {
    const { accessToken, branchId, tab, tenantId } = await setupTab();
    await openCash(accessToken, branchId);
    const key = newKey();

    const results = await Promise.all([
      checkout(accessToken, tab.id, 'CASH', key),
      checkout(accessToken, tab.id, 'CASH', key),
      checkout(accessToken, tab.id, 'CASH', key),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    const orderIds = new Set(results.map((r) => r.body.order.id));
    expect(orderIds.size).toBe(1);
    expect(results.filter((r) => r.body.idempotentReplay === false)).toHaveLength(1);

    const prisma = getPrisma(app);
    expect(await prisma.order.count({ where: { tenantId } })).toBe(1);
    expect(await prisma.payment.count({ where: { tenantId } })).toBe(1);
    expect(await prisma.cashMovement.count({ where: { tenantId, type: 'SALE' } })).toBe(1);
  });

  it('concurrent checkouts with DIFFERENT keys: exactly one succeeds, the other gets a controlled 409', async () => {
    const { accessToken, branchId, tab, tenantId } = await setupTab();
    await openCash(accessToken, branchId);

    const results = await Promise.all([
      checkout(accessToken, tab.id, 'CASH'),
      checkout(accessToken, tab.id, 'CASH'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);

    const prisma = getPrisma(app);
    expect(await prisma.order.count({ where: { tenantId } })).toBe(1);
    expect(await prisma.payment.count({ where: { tenantId } })).toBe(1);
    expect(await prisma.cashMovement.count({ where: { tenantId, type: 'SALE' } })).toBe(1);
  });

  // 15, 17
  it("isolates tenants: another tenant can't check out (or see) the tab", async () => {
    const a = await setupTab();
    const b = await registerTenantE2E(server);
    await checkout(b.accessToken, a.tab.id, 'PIX').expect(404);
    expect(await getPrisma(app).order.count({ where: { tenantId: a.tenantId } })).toBe(0);
  });

  // 16
  it('isolates branches: staff linked only to another branch gets 403; staff of this branch can check out', async () => {
    const { tenantId, branchId, tab } = await setupTab();
    const otherBranch = await getPrisma(app).branch.create({ data: { tenantId, name: 'Filial', code: 'FILIAL' } });
    const outsider = await createStaffAndLoginE2E(app, server, tenantId, 'WAITER', [otherBranch.id]);
    const waiter = await createStaffAndLoginE2E(app, server, tenantId, 'WAITER', [branchId]);

    await checkout(outsider, tab.id, 'PIX').expect(403);
    await checkout(waiter, tab.id, 'PIX').expect(200);
  });

  // 19
  it('refuses to check out an empty tab', async () => {
    const { accessToken, tab, tenantId } = await setupTab([]);
    const res = await checkout(accessToken, tab.id, 'PIX').expect(409);
    expect(res.body.code).toBe('TAB_EMPTY');
    expect(await getPrisma(app).order.count({ where: { tenantId } })).toBe(0);
  });

  it('rejects a client-supplied amount and an invalid payment method (strict whitelist → 400)', async () => {
    const { accessToken, tab } = await setupTab();
    await request(server)
      .post(`/v1/tabs/${tab.id}/checkout`)
      .set(auth(accessToken))
      .send({ paymentMethod: 'PIX', idempotencyKey: newKey(), totalCents: 1 })
      .expect(400);
    await checkout(accessToken, tab.id, 'BITCOIN').expect(400);
  });

  // 20
  it('rolls back EVERYTHING when a later step of the transaction fails', async () => {
    const prisma = getPrisma(app);
    // Fails the Payment insert — the step AFTER Order + OrderItems + SALE
    // were already written in the same transaction. Scoped to one magic
    // amount so parallel suites are never affected.
    const fn = `fail_payment_${uniqueSuffix().replace(/-/g, '_')}`;
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION ${fn}() RETURNS trigger AS $$
      BEGIN
        IF NEW."amountCents" = 424242 THEN RAISE EXCEPTION 'simulated payment failure'; END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql;`);
    await prisma.$executeRawUnsafe(
      `CREATE TRIGGER ${fn} BEFORE INSERT ON "payments" FOR EACH ROW EXECUTE FUNCTION ${fn}();`,
    );
    try {
      const { accessToken, branchId, tab, tenantId } = await setupTab([{ name: 'Rodízio', price: 4242.42, quantity: 1 }]);
      const session = await openCash(accessToken, branchId);
      const key = newKey();

      await checkout(accessToken, tab.id, 'CASH', key).expect(500);

      expect(await prisma.order.count({ where: { tenantId } })).toBe(0);
      expect(await prisma.orderItem.count({ where: { order: { tenantId } } })).toBe(0);
      expect(await prisma.payment.count({ where: { tenantId } })).toBe(0);
      expect(await prisma.cashMovement.count({ where: { sessionId: session.id } })).toBe(0);
      const tabAfter = await request(server).get(`/v1/tabs/${tab.id}`).set(auth(accessToken)).expect(200);
      expect(tabAfter.body.status).toBe('OPEN');
      expect(tabAfter.body.items).toHaveLength(1);

      // The failed attempt consumed nothing: once the fault is gone, the same
      // key goes through normally.
      await prisma.$executeRawUnsafe(`DROP TRIGGER ${fn} ON "payments";`);
      const ok = await checkout(accessToken, tab.id, 'CASH', key).expect(200);
      expect(ok.body.idempotentReplay).toBe(false);
      expect(await prisma.cashMovement.count({ where: { sessionId: session.id } })).toBe(1);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${fn} ON "payments";`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${fn}();`);
    }
  });

  it('GET /v1/tabs/:id exposes the sale summary and records the checkout audit trail', async () => {
    const { accessToken, branchId, tab, tenantId } = await setupTab();
    await openCash(accessToken, branchId);
    const before = await request(server).get(`/v1/tabs/${tab.id}`).set(auth(accessToken)).expect(200);
    expect(before.body.branchCashRegisterOpen).toBe(true);
    expect(before.body.order).toBeNull();

    await checkout(accessToken, tab.id, 'CASH').expect(200);
    const after = await request(server).get(`/v1/tabs/${tab.id}`).set(auth(accessToken)).expect(200);
    expect(after.body.status).toBe('CLOSED');
    expect(after.body.order).toMatchObject({
      status: 'COMPLETED',
      paymentMethod: 'CASH',
      totalCents: 5980,
      payment: { status: 'CONFIRMED', method: 'CASH', amountCents: 5980 },
    });
    expect(after.body.order.orderNumber).toEqual(expect.any(String));

    const logs = await getPrisma(app).auditLog.findMany({ where: { tenantId, entity: 'Tab', entityId: tab.id } });
    const actions = logs.map((l) => l.action);
    expect(actions).toEqual(expect.arrayContaining(['TAB_CHECKOUT_STARTED', 'TAB_CHECKOUT_COMPLETED']));
    const completed = logs.find((l) => l.action === 'TAB_CHECKOUT_COMPLETED')!;
    expect(completed.afterData).toMatchObject({ branchId, orderId: after.body.order.id, totalCents: 5980 });
  });

  it('public checkout still cannot create a DINE_IN order', async () => {
    const { slug, accessToken } = await registerTenantE2E(server);
    const product = await createActiveProductE2E(server, accessToken, 'Produto', 10);
    await request(server)
      .post('/v1/public/orders')
      .send({
        restaurantSlug: slug,
        items: [{ productId: product.id, quantity: 1 }],
        customer: { name: 'Cliente', phone: '11987654321' },
        fulfillmentType: 'DINE_IN',
        paymentMethod: 'PIX',
      })
      .expect(400);
  });
});
