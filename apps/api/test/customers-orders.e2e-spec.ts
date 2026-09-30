import { INestApplication } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import request from 'supertest';
import {
  createActiveProductE2E,
  createStaffAndLoginE2E,
  createTestApp,
  getPrisma,
  registerTenantE2E,
  uniqueSuffix,
} from './test-app.util';

type Json = Record<string, unknown>;

// Fase 11, slice 1: customers linked to orders (PDV), history and metrics. Own file = own
// rate-limit window; CRUD/RBAC/isolation are in customers.e2e-spec.ts.
describe('Customers x orders (e2e)', () => {
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
  const get = (token: string, path: string) => request(server).get(path).set(auth(token));
  const post = (token: string, path: string, body: Json = {}) => request(server).post(path).set(auth(token)).send(body);
  const patch = (token: string, path: string, body: Json) => request(server).patch(path).set(auth(token)).send(body);
  const prisma = () => getPrisma(app);

  let seq = 0;
  const phone = () => `118${String(Date.now() + ++seq).slice(-8)}`;

  // Products cost R$ 25,00 (2500 cents) each.
  async function setup() {
    const tenant = await registerTenantE2E(server);
    const product = await createActiveProductE2E(server, tenant.accessToken, `Burger ${uniqueSuffix()}`, 25);
    return { ...tenant, product };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const newCustomer = async (ctx: Ctx, extra: Json = {}) =>
    (await post(ctx.accessToken, '/v1/customers', { name: 'Maria Souza', phone: phone(), ...extra }).expect(201)).body as {
      id: string;
      name: string;
      phone: string;
    };

  const pos = (token: string, ctx: Ctx, extra: Json = {}, quantity = 1) =>
    post(token, '/v1/pos/orders', {
      branchId: ctx.branchId,
      items: [{ productId: ctx.product.id, quantity }],
      paymentMethod: 'PIX',
      ...extra,
    });
  const order = async (ctx: Ctx, extra: Json = {}, quantity = 1, token = ctx.accessToken) =>
    (await pos(token, ctx, extra, quantity).expect(201)).body as { id: string; orderNumber: string; total: number; customerName: string | null; customerPhone: string | null };
  const row = (id: string) => prisma().order.findUniqueOrThrow({ where: { id } });

  describe('linking (PDV)', () => {
    it('an order without a customer keeps working exactly as before', async () => {
      const ctx = await setup();
      const o = await order(ctx, { customerName: 'Fulano de Balcão' });
      const db = await row(o.id);
      expect([db.customerId, db.customerName, db.totalCents]).toEqual([null, 'Fulano de Balcão', 2500]);
      const anonymous = await order(ctx);
      expect((await row(anonymous.id)).customerId).toBeNull();
    });

    it('links the customer and copies name/phone into the order snapshot when nothing was typed', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const o = await order(ctx, { customerId: c.id });
      const db = await row(o.id);
      expect([db.customerId, db.customerName, db.customerPhone]).toEqual([c.id, c.name, c.phone]);
      expect(o).toMatchObject({ customerName: c.name, customerPhone: c.phone });
    });

    it('what was typed at the counter wins over the registry in the snapshot', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const o = await order(ctx, { customerId: c.id, customerName: 'Nome digitado' });
      const db = await row(o.id);
      expect([db.customerId, db.customerName, db.customerPhone]).toEqual([c.id, 'Nome digitado', c.phone]);
    });

    it('linking does not change the money: same items, same totals', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const plain = await row((await order(ctx, {}, 3)).id);
      const linked = await row((await order(ctx, { customerId: c.id }, 3)).id);
      expect([linked.subtotalCents, linked.deliveryFeeCents, linked.totalCents]).toEqual([
        plain.subtotalCents,
        plain.deliveryFeeCents,
        plain.totalCents,
      ]);
      expect(linked.totalCents).toBe(7500);
    });

    it('editing the customer later never rewrites the order snapshot', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const o = await order(ctx, { customerId: c.id });
      await patch(ctx.accessToken, `/v1/customers/${c.id}`, { name: 'Nome Novo', phone: phone() }).expect(200);
      const db = await row(o.id);
      expect([db.customerName, db.customerPhone]).toEqual([c.name, c.phone]);
      const detail = await get(ctx.accessToken, `/v1/orders/${o.id}`).expect(200);
      expect(detail.body.customerName).toBe(c.name);
    });

    it('deleting the customer row keeps the order and its snapshot (link becomes null)', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const o = await order(ctx, { customerId: c.id });
      await prisma().customer.delete({ where: { id: c.id } });
      const db = await row(o.id);
      expect([db.customerId, db.customerName, db.customerPhone, db.totalCents]).toEqual([null, c.name, c.phone, 2500]);
    });

    it('rejects a customer of another tenant (404), an inactive one (409) and a malformed id (400)', async () => {
      const ctx = await setup();
      const other = await setup();
      const foreign = await newCustomer(other);
      const inactive = await newCustomer(ctx);
      await patch(ctx.accessToken, `/v1/customers/${inactive.id}`, { active: false }).expect(200);

      expect((await pos(ctx.accessToken, ctx, { customerId: foreign.id })).body.code).toBe('CUSTOMER_NOT_FOUND');
      expect((await pos(ctx.accessToken, ctx, { customerId: '11111111-1111-4111-8111-111111111111' })).status).toBe(404);
      const inactiveRes = await pos(ctx.accessToken, ctx, { customerId: inactive.id });
      expect([inactiveRes.status, inactiveRes.body.code]).toEqual([409, 'CUSTOMER_INACTIVE']);
      expect((await pos(ctx.accessToken, ctx, { customerId: 'nope' })).status).toBe(400);
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect(await prisma().order.count({ where: { customerId: foreign.id } })).toBe(0);
    });

    it('a CASHIER (customers.read) can link; the public checkout has no customerId field', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const cashier = await createStaffAndLoginE2E(app, server, ctx.tenantId, RoleName.CASHIER, [ctx.branchId]);
      const o = await order(ctx, { customerId: c.id }, 1, cashier);
      expect((await row(o.id)).customerId).toBe(c.id);

      const pub = await request(server)
        .post('/v1/public/orders')
        .send({
          restaurantSlug: ctx.slug,
          items: [{ productId: ctx.product.id, quantity: 1 }],
          customer: { name: 'Visitante', phone: '11999990000' },
          fulfillmentType: 'PICKUP',
          paymentMethod: 'PIX',
          customerId: c.id,
        });
      // The public DTO has no such field: it is either rejected or stripped - what must never
      // happen is a link to the registry created from a public request.
      expect([201, 400]).toContain(pub.status);
      if (pub.status === 201) expect((await row(pub.body.id)).customerId).toBeNull();
      expect(await prisma().order.count({ where: { customerId: c.id, source: 'ONLINE' } })).toBe(0);
      const ok = await request(server)
        .post('/v1/public/orders')
        .send({
          restaurantSlug: ctx.slug,
          items: [{ productId: ctx.product.id, quantity: 1 }],
          customer: { name: 'Visitante', phone: '11999990000' },
          fulfillmentType: 'PICKUP',
          paymentMethod: 'PIX',
        })
        .expect(201);
      expect((await row(ok.body.id)).customerId).toBeNull();
      expect(JSON.stringify(ok.body)).not.toMatch(/customerId/);
    });

    it('idempotency: the same key and customer replays the order; a different customer is a conflict', async () => {
      const ctx = await setup();
      const a = await newCustomer(ctx);
      const b = await newCustomer(ctx);
      const key = `crm-${uniqueSuffix()}`;
      const first = await order(ctx, { customerId: a.id, idempotencyKey: key });
      const again = await order(ctx, { customerId: a.id, idempotencyKey: key });
      expect(again.id).toBe(first.id);
      const clash = await pos(ctx.accessToken, ctx, { customerId: b.id, idempotencyKey: key });
      expect([clash.status, clash.body.code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
      expect(await prisma().order.count({ where: { customerId: { in: [a.id, b.id] } } })).toBe(1);
    });
  });

  describe('history and metrics', () => {
    it('a customer with several orders: count, total, average ticket, last purchase and history', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const first = await order(ctx, { customerId: c.id }, 1); // 2500
      const second = await order(ctx, { customerId: c.id }, 2); // 5000
      const third = await order(ctx, { customerId: c.id }, 3); // 7500
      await prisma().order.update({ where: { id: first.id }, data: { createdAt: new Date(Date.now() - 3 * 86_400_000) } });
      await prisma().order.update({ where: { id: second.id }, data: { createdAt: new Date(Date.now() - 2 * 86_400_000) } });

      const detail = (await get(ctx.accessToken, `/v1/customers/${c.id}`).expect(200)).body;
      expect(detail.metrics).toMatchObject({ ordersCount: 3, cancelledCount: 0, totalSpentCents: 15000, averageTicketCents: 5000 });
      const last = (await row(third.id)).createdAt;
      expect(new Date(detail.metrics.lastOrderAt).getTime()).toBe(last.getTime());

      const history = (await get(ctx.accessToken, `/v1/customers/${c.id}/orders?pageSize=2`).expect(200)).body;
      expect(history.meta).toMatchObject({ total: 3, totalPages: 2, pageSize: 2 });
      expect(history.data.map((o: { id: string }) => o.id)).toEqual([third.id, second.id]); // newest first
      expect(history.data[0]).toMatchObject({
        orderNumber: third.orderNumber,
        status: 'PENDING',
        counted: true,
        totalCents: 7500,
        itemCount: 1,
        paymentMethod: 'PIX',
        source: 'COUNTER',
        branch: { id: ctx.branchId },
      });
      const page2 = (await get(ctx.accessToken, `/v1/customers/${c.id}/orders?pageSize=2&page=2`).expect(200)).body;
      expect(page2.data.map((o: { id: string }) => o.id)).toEqual([first.id]);

      const list = (await get(ctx.accessToken, '/v1/customers').expect(200)).body.data.find((x: { id: string }) => x.id === c.id);
      expect(list).toMatchObject({ ordersCount: 3, totalSpentCents: 15000 });
    });

    it('cancelled orders do not distort the metrics but stay visible in the history', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const kept = await order(ctx, { customerId: c.id }, 1); // 2500
      const cancelled = await order(ctx, { customerId: c.id }, 4); // 10000
      await patch(ctx.accessToken, `/v1/orders/${cancelled.id}/status`, { status: 'CANCELLED' }).expect(200);

      const m = (await get(ctx.accessToken, `/v1/customers/${c.id}`).expect(200)).body.metrics;
      expect(m).toMatchObject({ ordersCount: 1, cancelledCount: 1, totalSpentCents: 2500, averageTicketCents: 2500 });
      expect(new Date(m.lastOrderAt).getTime()).toBe((await row(kept.id)).createdAt.getTime());

      const history = (await get(ctx.accessToken, `/v1/customers/${c.id}/orders`).expect(200)).body.data;
      expect(history).toHaveLength(2);
      expect(history.find((o: { id: string }) => o.id === cancelled.id)).toMatchObject({ status: 'CANCELLED', counted: false });
      const filtered = (await get(ctx.accessToken, `/v1/customers/${c.id}/orders?status=CANCELLED`).expect(200)).body;
      expect(filtered.meta.total).toBe(1);
      const row2 = (await get(ctx.accessToken, '/v1/customers').expect(200)).body.data.find((x: { id: string }) => x.id === c.id);
      expect(row2).toMatchObject({ ordersCount: 1, totalSpentCents: 2500 });
    });

    it('only cancelled orders: zero spend and no last purchase', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const o = await order(ctx, { customerId: c.id });
      await patch(ctx.accessToken, `/v1/orders/${o.id}/status`, { status: 'CANCELLED' }).expect(200);
      const m = (await get(ctx.accessToken, `/v1/customers/${c.id}`).expect(200)).body.metrics;
      expect(m).toEqual({ ordersCount: 0, cancelledCount: 1, totalSpentCents: 0, averageTicketCents: 0, lastOrderAt: null });
    });

    it('old orders (no link) stay valid and are never attributed to a customer by phone', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      // an order that existed before the CRM: same phone typed, no link
      const legacy = await order(ctx, { customerName: c.name, customerPhone: c.phone });
      const db = await row(legacy.id);
      expect([db.customerId, db.status]).toEqual([null, 'PENDING']);
      expect((await get(ctx.accessToken, `/v1/orders/${legacy.id}`).expect(200)).body.customerName).toBe(c.name);
      const m = (await get(ctx.accessToken, `/v1/customers/${c.id}`).expect(200)).body.metrics;
      expect(m.ordersCount).toBe(0);
      await patch(ctx.accessToken, `/v1/orders/${legacy.id}/status`, { status: 'CONFIRMED' }).expect(200);
    });

    it('metrics and history never mix customers, tenants or other customers\' orders', async () => {
      const ctx = await setup();
      const a = await newCustomer(ctx);
      const b = await newCustomer(ctx);
      await order(ctx, { customerId: a.id });
      await order(ctx, { customerId: b.id }, 2);
      expect((await get(ctx.accessToken, `/v1/customers/${a.id}`).expect(200)).body.metrics).toMatchObject({ ordersCount: 1, totalSpentCents: 2500 });
      expect((await get(ctx.accessToken, `/v1/customers/${b.id}`).expect(200)).body.metrics).toMatchObject({ ordersCount: 1, totalSpentCents: 5000 });
    });

    it('rejects malformed history filters', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      for (const bad of ['pageSize=101', 'page=0', 'status=WEIRD', 'branchId=nope']) {
        expect((await get(ctx.accessToken, `/v1/customers/${c.id}/orders?${bad}`)).status).toBe(400);
      }
    });
  });

  describe('branch isolation', () => {
    it('a branch-limited user sees (and is measured on) only their own branches\' orders; OWNER sees all', async () => {
      const ctx = await setup();
      const branch2 = await prisma().branch.create({ data: { tenantId: ctx.tenantId, name: 'Filial 2', code: 'F2', status: 'ACTIVE' } });
      const c = await newCustomer(ctx);
      const inBranch1 = await order(ctx, { customerId: c.id }, 1); // 2500
      const inBranch2 = (await post(ctx.accessToken, '/v1/pos/orders', {
        branchId: branch2.id,
        items: [{ productId: ctx.product.id, quantity: 2 }], // 5000
        paymentMethod: 'PIX',
        customerId: c.id,
      }).expect(201)).body as { id: string };

      const owner = (await get(ctx.accessToken, `/v1/customers/${c.id}`).expect(200)).body.metrics;
      expect(owner).toMatchObject({ ordersCount: 2, totalSpentCents: 7500 });

      const manager1 = await createStaffAndLoginE2E(app, server, ctx.tenantId, RoleName.MANAGER, [ctx.branchId]);
      const manager2 = await createStaffAndLoginE2E(app, server, ctx.tenantId, RoleName.MANAGER, [branch2.id]);

      // the customer itself is tenant-wide: both managers can open it...
      const m1 = (await get(manager1, `/v1/customers/${c.id}`).expect(200)).body.metrics;
      const m2 = (await get(manager2, `/v1/customers/${c.id}`).expect(200)).body.metrics;
      // ...but each one is measured only on the branches they may access
      expect(m1).toMatchObject({ ordersCount: 1, totalSpentCents: 2500 });
      expect(m2).toMatchObject({ ordersCount: 1, totalSpentCents: 5000 });

      const h1 = (await get(manager1, `/v1/customers/${c.id}/orders`).expect(200)).body.data.map((o: { id: string }) => o.id);
      const h2 = (await get(manager2, `/v1/customers/${c.id}/orders`).expect(200)).body.data.map((o: { id: string }) => o.id);
      expect(h1).toEqual([inBranch1.id]);
      expect(h2).toEqual([inBranch2.id]);

      // branchId in the query cannot widen access
      expect((await get(manager1, `/v1/customers/${c.id}/orders?branchId=${branch2.id}`)).status).toBe(403);
      expect((await get(manager2, `/v1/customers/${c.id}/orders?branchId=${ctx.branchId}`)).status).toBe(403);
      const ownerFiltered = (await get(ctx.accessToken, `/v1/customers/${c.id}/orders?branchId=${branch2.id}`).expect(200)).body.data;
      expect(ownerFiltered.map((o: { id: string }) => o.id)).toEqual([inBranch2.id]);

      // per-row stats in the list follow the same branch scope
      const row1 = (await get(manager1, '/v1/customers').expect(200)).body.data.find((x: { id: string }) => x.id === c.id);
      expect(row1).toMatchObject({ ordersCount: 1, totalSpentCents: 2500 });

      // and a branch-limited user cannot link an order in a branch they cannot operate
      const escape = await post(manager1, '/v1/pos/orders', {
        branchId: branch2.id,
        items: [{ productId: ctx.product.id, quantity: 1 }],
        paymentMethod: 'PIX',
        customerId: c.id,
      });
      expect(escape.status).toBe(403);
    });
  });
});
