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

describe('Tabs (comandas) (e2e)', () => {
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

  function createTable(token: string, branchId: string, number: number) {
    return request(server)
      .post('/v1/tables')
      .set('Authorization', `Bearer ${token}`)
      .send({ branchId, number })
      .then((r) => r.body as { id: string });
  }
  function openTab(token: string, body: Record<string, unknown>) {
    return request(server).post('/v1/tabs').set('Authorization', `Bearer ${token}`).send(body);
  }
  // B9: items reach a tab only in rounds sent to the kitchen. One item per round here.
  function addItem(token: string, tabId: string, item: Record<string, unknown>) {
    return request(server)
      .post(`/v1/tabs/${tabId}/rounds`)
      .set('Authorization', `Bearer ${token}`)
      .send({ idempotencyKey: `round-${uniqueSuffix()}`, items: [item] });
  }
  // Fatia 10: closing a tab = checking it out (the old /close route is gone).
  // A fresh key per call, so a second call is a new attempt, not a replay.
  function closeTab(token: string, tabId: string) {
    return request(server)
      .post(`/v1/tabs/${tabId}/checkout`)
      .set('Authorization', `Bearer ${token}`)
      .send({ paymentMethod: 'PIX', idempotencyKey: `close-${uniqueSuffix()}` });
  }

  async function setup(number = 1) {
    const tenant = await registerTenantE2E(server);
    const table = await createTable(tenant.accessToken, tenant.branchId, number);
    return { ...tenant, table };
  }

  it('opens a tab for a table', async () => {
    const { accessToken, branchId, table } = await setup();
    const res = await openTab(accessToken, { branchId, tableId: table.id, customerName: 'Mesa 1' }).expect(201);
    expect(res.body.status).toBe('OPEN');
    expect(res.body.table.id).toBe(table.id);
    expect(res.body.items).toEqual([]);
    expect(res.body.totalCents).toBe(0);

    const listed = await request(server)
      .get('/v1/tables')
      .query({ branchId })
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    const listedTable = listed.body.find((t: { id: string }) => t.id === table.id);
    expect(listedTable.status).toBe('OCCUPIED');
    expect(listedTable.openTabId).toBe(res.body.id);
  });

  it('blocks a second OPEN tab for the same table', async () => {
    const { accessToken, branchId, table } = await setup();
    await openTab(accessToken, { branchId, tableId: table.id }).expect(201);
    const res = await openTab(accessToken, { branchId, tableId: table.id }).expect(409);
    expect(res.body.code).toBe('TABLE_ALREADY_OCCUPIED');
  });

  it('adds a product to the tab, snapshotting name/price from the DB', async () => {
    const { accessToken, branchId, table } = await setup();
    const product = await createActiveProductE2E(server, accessToken, 'X-Burger', 29.9);
    const tab = (await openTab(accessToken, { branchId, tableId: table.id }).expect(201)).body;

    const res = await addItem(accessToken, tab.id, {
      productId: product.id,
      quantity: 2,
      notes: 'sem cebola',
    }).expect(201);

    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].name).toBe('X-Burger');
    expect(res.body.items[0].unitPriceCents).toBe(2990);
    expect(res.body.items[0].quantity).toBe(2);
    expect(res.body.items[0].notes).toBe('sem cebola');
    expect(res.body.subtotalCents).toBe(5980);
    expect(res.body.totalCents).toBe(5980);
  });

  // TabRoundItemDto has no price field at all (structural guarantee, same as
  // OrderCreationService/PosOrdersService) — a client-supplied price is
  // rejected outright by the global strict ValidationPipe, exactly like the
  // authenticated PDV (pos.e2e-spec.ts "MANDATORY: rejects smuggled
  // priceCents..."), not silently stripped like the public guest checkout.
  it('MANDATORY: rejects a smuggled client-supplied price (strict whitelist → 400)', async () => {
    const { accessToken, branchId, table } = await setup();
    const product = await createActiveProductE2E(server, accessToken, 'X-Burger', 29.9);
    const tab = (await openTab(accessToken, { branchId, tableId: table.id }).expect(201)).body;

    const res = await addItem(accessToken, tab.id, {
      productId: product.id,
      quantity: 1,
      // Tampering attempt: real price is 2990 cents.
      priceCents: 1,
      price: 0.01,
    }).expect(400);
    expect(res.body.items).toBeUndefined();
  });

  it('rejects an inactive product', async () => {
    const { accessToken, branchId, table } = await setup();
    const inactive = await createActiveProductE2E(server, accessToken, 'Descontinuado', 10, false);
    const tab = (await openTab(accessToken, { branchId, tableId: table.id }).expect(201)).body;

    const res = await addItem(accessToken, tab.id, { productId: inactive.id, quantity: 1 }).expect(400);
    expect(res.body.code).toBe('PRODUCT_UNAVAILABLE');
  });

  it("rejects another tenant's product", async () => {
    const a = await setup();
    const b = await registerTenantE2E(server);
    const productB = await createActiveProductE2E(server, b.accessToken, 'Produto B', 10);
    const tab = (await openTab(a.accessToken, { branchId: a.branchId, tableId: a.table.id }).expect(201)).body;

    const res = await addItem(a.accessToken, tab.id, { productId: productB.id, quantity: 1 }).expect(400);
    expect(res.body.code).toBe('PRODUCT_UNAVAILABLE');
  });

  it('B9: a sent item cannot be edited or deleted - the old item routes no longer exist', async () => {
    const { accessToken, branchId, table } = await setup();
    const product = await createActiveProductE2E(server, accessToken, 'Produto', 10);
    const tab = (await openTab(accessToken, { branchId, tableId: table.id }).expect(201)).body;
    const itemId = (await addItem(accessToken, tab.id, { productId: product.id, quantity: 1 }).expect(201)).body.items[0].id;
    const auth = { Authorization: `Bearer ${accessToken}` };

    await request(server).post(`/v1/tabs/${tab.id}/items`).set(auth).send({ productId: product.id, quantity: 1 }).expect(404);
    await request(server).patch(`/v1/tabs/${tab.id}/items/${itemId}`).set(auth).send({ quantity: 4 }).expect(404);
    await request(server).delete(`/v1/tabs/${tab.id}/items/${itemId}`).set(auth).expect(404);
    const item = await getPrisma(app).tabItem.findUniqueOrThrow({ where: { id: itemId } });
    expect(item).toMatchObject({ quantity: 1, cancelledQuantity: 0, status: 'SENT' });
  });

  it('computes total correctly across multiple items and quantities', async () => {
    const { accessToken, branchId, table } = await setup();
    const p1 = await createActiveProductE2E(server, accessToken, 'Produto 1', 12.5);
    const p2 = await createActiveProductE2E(server, accessToken, 'Produto 2', 7.25);
    const tab = (await openTab(accessToken, { branchId, tableId: table.id }).expect(201)).body;
    await addItem(accessToken, tab.id, { productId: p1.id, quantity: 3 }).expect(201);
    const res = await addItem(accessToken, tab.id, { productId: p2.id, quantity: 2 }).expect(201);

    // 3*1250 + 2*725 = 3750 + 1450 = 5200
    expect(res.body.subtotalCents).toBe(5200);
    expect(res.body.totalCents).toBe(5200);
    expect(res.body.itemCount).toBe(5);
  });

  it('closes a tab (requires at least one item) and blocks further changes', async () => {
    const { accessToken, branchId, table } = await setup();
    const product = await createActiveProductE2E(server, accessToken, 'Produto', 10);
    const tab = (await openTab(accessToken, { branchId, tableId: table.id }).expect(201)).body;

    const emptyClose = await closeTab(accessToken, tab.id).expect(409);
    expect(emptyClose.body.code).toBe('TAB_EMPTY');

    await addItem(accessToken, tab.id, { productId: product.id, quantity: 1 }).expect(201);

    const closed = await closeTab(accessToken, tab.id).expect(200);
    expect(closed.body.status).toBe('CLOSED');
    expect(closed.body.closedAt).not.toBeNull();
    expect(closed.body.order).not.toBeNull();

    // No further mutation is allowed once CLOSED.
    const late = await addItem(accessToken, tab.id, { productId: product.id, quantity: 1 }).expect(409);
    expect(late.body.code).toBe('TAB_CLOSED');
    const secondClose = await closeTab(accessToken, tab.id).expect(409);
    expect(secondClose.body.code).toBe('TAB_ALREADY_CLOSED');

    // The table is AVAILABLE again once its tab is closed, and a new tab
    // may be opened for it.
    const tableAfter = await request(server)
      .get(`/v1/tables/${table.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(tableAfter.body.status).toBe('AVAILABLE');
    await openTab(accessToken, { branchId, tableId: table.id }).expect(201);
  });

  it('isolates tabs between tenants (404 cross-tenant, and cannot open a tab on another tenant\'s table)', async () => {
    const a = await setup();
    const b = await registerTenantE2E(server);
    const tab = (await openTab(a.accessToken, { branchId: a.branchId, tableId: a.table.id }).expect(201)).body;

    await request(server)
      .get(`/v1/tabs/${tab.id}`)
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(404);
    // b's own branchId, but a's tableId — table lookup is scoped by tenant+branch.
    await openTab(b.accessToken, { branchId: b.branchId, tableId: a.table.id }).expect(404);
  });

  it('isolates tabs between branches of the same tenant', async () => {
    const { accessToken, tenantId, branchId, table } = await setup();
    const otherBranch = await getPrisma(app).branch.create({
      data: { tenantId, name: 'Filial', code: 'FILIAL' },
    });
    const waiter = await createStaffAndLoginE2E(app, server, tenantId, 'WAITER', [otherBranch.id]);

    // The WAITER is linked only to otherBranch, so they can't open/see a tab
    // on the matriz's table.
    await openTab(waiter, { branchId, tableId: table.id }).expect(403);

    const tab = (await openTab(accessToken, { branchId, tableId: table.id }).expect(201)).body;
    await request(server).get(`/v1/tabs/${tab.id}`).set('Authorization', `Bearer ${waiter}`).expect(403);
  });

  it('concurrent opens for the same table: exactly one succeeds', async () => {
    const { accessToken, branchId, table } = await setup();
    const results = await Promise.all([
      openTab(accessToken, { branchId, tableId: table.id }),
      openTab(accessToken, { branchId, tableId: table.id }),
      openTab(accessToken, { branchId, tableId: table.id }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    const openCount = await getPrisma(app).tab.count({ where: { tableId: table.id, status: 'OPEN' } });
    expect(openCount).toBe(1);
  });
});
