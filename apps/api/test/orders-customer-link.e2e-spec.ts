import { INestApplication } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import request from 'supertest';
import {
  createActiveProductE2E,
  createStaffAndLoginE2E,
  createTestApp,
  getPrisma,
  injectAuditFailure,
  registerTenantE2E,
  removeAuditFailure,
  uniqueSuffix,
} from './test-app.util';

type Json = Record<string, unknown>;

// Fase 11, CRM avançado (2/2): attaching a customer of the registry to sales that were not
// born with one - an online/delivery order (linked by the staff afterwards) and a table
// checkout (linked when the bill is paid).
describe('Orders x customer link (e2e)', () => {
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
  const link = (token: string, orderId: string, customerId: string | null) =>
    patch(token, `/v1/orders/${orderId}/customer`, { customerId });

  let seq = 0;
  const phone = () => `116${String(Date.now() + ++seq).slice(-8)}`;

  async function setup() {
    const tenant = await registerTenantE2E(server);
    const product = await createActiveProductE2E(server, tenant.accessToken, `Burger ${uniqueSuffix()}`, 25); // 2500
    return { ...tenant, product };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const newCustomer = async (ctx: Ctx, extra: Json = {}) =>
    (await post(ctx.accessToken, '/v1/customers', { name: 'Maria Souza', phone: phone(), ...extra }).expect(201)).body as {
      id: string;
      name: string;
      phone: string;
    };

  // An order nobody is attached to: the public checkout never links a customer.
  const onlineOrder = async (ctx: Ctx, customer: Json = { name: 'Visitante', phone: '11999990000' }) =>
    (
      await request(server)
        .post('/v1/public/orders')
        .send({
          restaurantSlug: ctx.slug,
          items: [{ productId: ctx.product.id, quantity: 1 }],
          customer,
          fulfillmentType: 'PICKUP',
          paymentMethod: 'PIX',
        })
        .expect(201)
    ).body as { id: string };

  const row = (orderId: string) => prisma().order.findUniqueOrThrow({ where: { id: orderId } });
  const linkAudits = (orderId: string) =>
    prisma().auditLog.findMany({
      where: { entity: 'Order', entityId: orderId, action: { in: ['ORDER_CUSTOMER_LINKED', 'ORDER_CUSTOMER_UNLINKED'] } },
      orderBy: { createdAt: 'asc' },
    });
  const metrics = async (ctx: Ctx, customerId: string) =>
    (await get(ctx.accessToken, `/v1/customers/${customerId}`).expect(200)).body.metrics as {
      ordersCount: number;
      totalSpentCents: number;
    };

  describe('linking an existing order', () => {
    it('an online order starts without a customer and exposes only the link id to the staff', async () => {
      const ctx = await setup();
      const order = await onlineOrder(ctx);
      const detail = await get(ctx.accessToken, `/v1/orders/${order.id}`).expect(200);
      expect(detail.body.customerId).toBeNull();
      const listed = await get(ctx.accessToken, '/v1/orders').expect(200);
      expect(listed.body.data[0].customerId).toBeNull();
    });

    it('links the order: it joins the customer history and metrics, and the snapshot is untouched', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const order = await onlineOrder(ctx, { name: 'Nome Digitado', phone: '11911112222' });
      expect(await metrics(ctx, c.id)).toMatchObject({ ordersCount: 0, totalSpentCents: 0 });

      const linked = await link(ctx.accessToken, order.id, c.id).expect(200);
      expect(linked.body).toMatchObject({ id: order.id, customerId: c.id, customerName: 'Nome Digitado', customerPhone: '11911112222' });

      expect(await metrics(ctx, c.id)).toMatchObject({ ordersCount: 1, totalSpentCents: 2500 });
      const history = await get(ctx.accessToken, `/v1/customers/${c.id}/orders`).expect(200);
      expect(history.body.data.map((o: { id: string }) => o.id)).toEqual([order.id]);
      // Nothing about the money or the status moved.
      const stored = await row(order.id);
      expect([stored.totalCents, stored.subtotalCents, stored.status]).toEqual([2500, 2500, 'PENDING']);
    });

    it('unlinks with null, moves the order to another customer, and audits every real change with ids only', async () => {
      const ctx = await setup();
      const first = await newCustomer(ctx, { name: 'Primeira Cliente', email: 'primeira@example.com' });
      const second = await newCustomer(ctx, { name: 'Segunda Cliente' });
      const order = await onlineOrder(ctx);

      await link(ctx.accessToken, order.id, first.id).expect(200);
      await link(ctx.accessToken, order.id, second.id).expect(200);
      expect(await metrics(ctx, first.id)).toMatchObject({ ordersCount: 0 });
      expect(await metrics(ctx, second.id)).toMatchObject({ ordersCount: 1 });

      const unlinked = await link(ctx.accessToken, order.id, null).expect(200);
      expect(unlinked.body.customerId).toBeNull();
      expect(await metrics(ctx, second.id)).toMatchObject({ ordersCount: 0 });

      const audits = await linkAudits(order.id);
      expect(audits.map((a) => [a.action, a.beforeData, a.afterData])).toEqual([
        ['ORDER_CUSTOMER_LINKED', { customerId: null }, { customerId: first.id }],
        ['ORDER_CUSTOMER_LINKED', { customerId: first.id }, { customerId: second.id }],
        ['ORDER_CUSTOMER_UNLINKED', { customerId: second.id }, { customerId: null }],
      ]);
      expect(audits.every((a) => a.tenantId === ctx.tenantId && a.userId !== null)).toBe(true);
      expect(JSON.stringify(audits)).not.toMatch(/Primeira|Segunda|primeira@example|11\d{9}/);
    });

    it('repeating the same link (or the same unlink) changes nothing and writes no audit', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const order = await onlineOrder(ctx);
      await link(ctx.accessToken, order.id, null).expect(200);
      expect(await linkAudits(order.id)).toHaveLength(0);
      await link(ctx.accessToken, order.id, c.id).expect(200);
      await link(ctx.accessToken, order.id, c.id).expect(200);
      expect(await linkAudits(order.id)).toHaveLength(1);
    });

    it('ten simultaneous identical links leave one link and one audit entry', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const order = await onlineOrder(ctx);
      const results = await Promise.all(Array.from({ length: 10 }, () => link(ctx.accessToken, order.id, c.id)));
      expect(results.every((res) => res.status === 200)).toBe(true);
      expect((await row(order.id)).customerId).toBe(c.id);
      expect(await linkAudits(order.id)).toHaveLength(1);
    });

    it('two simultaneous links to different customers end in one of them, with a consistent trail', async () => {
      const ctx = await setup();
      const a = await newCustomer(ctx, { name: 'Cliente A' });
      const b = await newCustomer(ctx, { name: 'Cliente B' });
      const order = await onlineOrder(ctx);
      const results = await Promise.all([link(ctx.accessToken, order.id, a.id), link(ctx.accessToken, order.id, b.id)]);
      expect(results.map((res) => res.status)).toEqual([200, 200]);

      const final = (await row(order.id)).customerId;
      expect([a.id, b.id]).toContain(final);
      const audits = await linkAudits(order.id);
      expect(audits).toHaveLength(2);
      // The trail is a chain: each entry starts where the previous one ended.
      expect((audits[0].beforeData as { customerId: string | null }).customerId).toBeNull();
      expect((audits[1].beforeData as { customerId: string }).customerId).toBe(
        (audits[0].afterData as { customerId: string }).customerId,
      );
      expect((audits[1].afterData as { customerId: string }).customerId).toBe(final);
    });

    it('the link is rolled back when its audit cannot be written', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const order = await onlineOrder(ctx);
      await injectAuditFailure(app, 'fail_audit_order_link_test', ctx.tenantId, 'ORDER_CUSTOMER_LINKED');
      try {
        await link(ctx.accessToken, order.id, c.id).expect(500);
        expect((await row(order.id)).customerId).toBeNull();
      } finally {
        await removeAuditFailure(app, 'fail_audit_order_link_test');
      }
      await link(ctx.accessToken, order.id, c.id).expect(200);
    });

    it('works for an order of any status, including one linked at the PDV', async () => {
      const ctx = await setup();
      const a = await newCustomer(ctx, { name: 'Cliente A' });
      const b = await newCustomer(ctx, { name: 'Cliente B' });
      const pdv = await post(ctx.accessToken, '/v1/pos/orders', {
        branchId: ctx.branchId,
        items: [{ productId: ctx.product.id, quantity: 1 }],
        paymentMethod: 'PIX',
        customerId: a.id,
      }).expect(201);
      await patch(ctx.accessToken, `/v1/orders/${pdv.body.id}/status`, { status: 'CANCELLED' }).expect(200);
      const moved = await link(ctx.accessToken, pdv.body.id, b.id).expect(200);
      expect(moved.body).toMatchObject({ customerId: b.id, status: 'CANCELLED' });
    });
  });

  describe('what cannot be linked', () => {
    it('refuses a customer of another tenant (404), an inactive one (409) and malformed input (400)', async () => {
      const ctx = await setup();
      const other = await setup();
      const order = await onlineOrder(ctx);
      const foreign = await newCustomer(other);
      const inactive = await newCustomer(ctx);
      await patch(ctx.accessToken, `/v1/customers/${inactive.id}`, { active: false }).expect(200);

      expect((await link(ctx.accessToken, order.id, foreign.id).expect(404)).body.code).toBe('CUSTOMER_NOT_FOUND');
      expect((await link(ctx.accessToken, order.id, inactive.id).expect(409)).body.code).toBe('CUSTOMER_INACTIVE');
      await patch(ctx.accessToken, `/v1/orders/${order.id}/customer`, { customerId: 'not-a-uuid' }).expect(400);
      await patch(ctx.accessToken, `/v1/orders/${order.id}/customer`, {}).expect(400);
      await patch(ctx.accessToken, `/v1/orders/${order.id}/customer`, { customerId: 123 }).expect(400);
      expect((await row(order.id)).customerId).toBeNull();
      expect(await linkAudits(order.id)).toHaveLength(0);
    });

    it('accepts nothing but the customer id: no tenant, no name, no total', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const order = await onlineOrder(ctx);
      for (const extra of [{ tenantId: ctx.tenantId }, { customerName: 'Outro' }, { totalCents: 1 }, { status: 'COMPLETED' }]) {
        await patch(ctx.accessToken, `/v1/orders/${order.id}/customer`, { customerId: c.id, ...extra }).expect(400);
      }
      expect((await row(order.id)).customerId).toBeNull();
    });

    it('an order of another tenant is not found, whoever the customer is', async () => {
      const ctx = await setup();
      const other = await setup();
      const mine = await newCustomer(ctx);
      const theirOrder = await onlineOrder(other);
      await link(ctx.accessToken, theirOrder.id, mine.id).expect(404);
      await link(ctx.accessToken, theirOrder.id, null).expect(404);
      await get(ctx.accessToken, `/v1/orders/${theirOrder.id}/customer-suggestions`).expect(404);
      expect((await row(theirOrder.id)).customerId).toBeNull();
    });

    it('a branch-limited manager cannot link an order of a branch they do not work at', async () => {
      const ctx = await setup();
      const second = await prisma().branch.create({ data: { tenantId: ctx.tenantId, name: 'Filial', code: 'FILIAL' } });
      const manager = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'MANAGER', [second.id]);
      const c = await newCustomer(ctx);
      const matrizOrder = await onlineOrder(ctx); // the public checkout goes to the oldest branch
      const filialOrder = await post(ctx.accessToken, '/v1/pos/orders', {
        branchId: second.id,
        items: [{ productId: ctx.product.id, quantity: 1 }],
        paymentMethod: 'PIX',
      }).expect(201);

      await link(manager, matrizOrder.id, c.id).expect(404);
      expect((await row(matrizOrder.id)).customerId).toBeNull();
      await link(manager, filialOrder.body.id, c.id).expect(200);
    });
  });

  describe('permissions', () => {
    it.each([
      ['OWNER', 200],
      ['ADMIN', 200],
      ['MANAGER', 200],
      // orders.update without customers.read, and customers.read without orders.update.
      ['KITCHEN', 403],
      ['CASHIER', 403],
      ['WAITER', 403],
      ['DELIVERY', 403],
      ['VIEWER', 403],
    ] as [RoleName, number][])('%s -> %i', async (role, expected) => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const order = await onlineOrder(ctx);
      const token = role === 'OWNER' ? ctx.accessToken : await createStaffAndLoginE2E(app, server, ctx.tenantId, role, [ctx.branchId]);
      await link(token, order.id, c.id).expect(expected);
      await link(token, order.id, null).expect(expected);
      if (expected === 403) expect(await linkAudits(order.id)).toHaveLength(0);
    });

    it('needs a session', async () => {
      const ctx = await setup();
      const order = await onlineOrder(ctx);
      await request(server).patch(`/v1/orders/${order.id}/customer`).send({ customerId: null }).expect(401);
      await request(server).get(`/v1/orders/${order.id}/customer-suggestions`).expect(401);
    });
  });

  describe('suggestions by phone', () => {
    it('suggests the active customers whose phone is the one typed on the order, in any spelling', async () => {
      const ctx = await setup();
      const match = await newCustomer(ctx, { name: 'Dona do Telefone', phone: '11987654321' });
      await newCustomer(ctx, { name: 'Outro Telefone' });
      const order = await onlineOrder(ctx, { name: 'Visitante', phone: '+55 (11) 98765-4321' });

      const suggestions = await get(ctx.accessToken, `/v1/orders/${order.id}/customer-suggestions`).expect(200);
      expect(suggestions.body.data).toEqual([{ id: match.id, name: 'Dona do Telefone', phone: '11987654321', active: true }]);
      // A suggestion is only a hint: nothing was linked.
      expect((await row(order.id)).customerId).toBeNull();
    });

    it('suggests nobody for an order without phone, an unknown phone, an inactive customer or another tenant', async () => {
      const ctx = await setup();
      const other = await setup();
      await newCustomer(other, { name: 'Mesmo Telefone, Outro Restaurante', phone: '11955554444' });
      const inactive = await newCustomer(ctx, { phone: '11933332222' });
      await patch(ctx.accessToken, `/v1/customers/${inactive.id}`, { active: false }).expect(200);

      const empty = async (orderId: string) =>
        expect((await get(ctx.accessToken, `/v1/orders/${orderId}/customer-suggestions`).expect(200)).body.data).toEqual([]);
      await empty((await onlineOrder(ctx, { name: 'Visitante Um', phone: '11955554444' })).id);
      await empty((await onlineOrder(ctx, { name: 'Visitante Dois', phone: '11933332222' })).id);
      const noPhone = await post(ctx.accessToken, '/v1/pos/orders', {
        branchId: ctx.branchId,
        items: [{ productId: ctx.product.id, quantity: 1 }],
        paymentMethod: 'PIX',
      }).expect(201);
      await empty(noPhone.body.id);
    });

    it('is refused without customers.read', async () => {
      const ctx = await setup();
      const order = await onlineOrder(ctx);
      const kitchen = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'KITCHEN', [ctx.branchId]);
      await get(kitchen, `/v1/orders/${order.id}/customer-suggestions`).expect(403);
    });
  });

  describe('table checkout', () => {
    async function openTab(ctx: Ctx, customerName?: string) {
      const table = (await post(ctx.accessToken, '/v1/tables', { branchId: ctx.branchId, number: 1 }).expect(201)).body;
      const tab = (
        await post(ctx.accessToken, '/v1/tabs', { branchId: ctx.branchId, tableId: table.id, ...(customerName ? { customerName } : {}) }).expect(201)
      ).body as { id: string };
      await post(ctx.accessToken, `/v1/tabs/${tab.id}/items`, { productId: ctx.product.id, quantity: 2 }).expect(201);
      return tab;
    }
    const checkout = (token: string, tabId: string, extra: Json = {}) =>
      post(token, `/v1/tabs/${tabId}/checkout`, { paymentMethod: 'PIX', idempotencyKey: `chk-${uniqueSuffix()}`, ...extra });
    const saleOf = (tabId: string) => prisma().order.findUniqueOrThrow({ where: { tabId } });

    it('without a customer the checkout is unchanged', async () => {
      const ctx = await setup();
      const tab = await openTab(ctx, 'Mesa da janela');
      await checkout(ctx.accessToken, tab.id).expect(200);
      expect(await saleOf(tab.id)).toMatchObject({ customerId: null, customerName: 'Mesa da janela', customerPhone: null, totalCents: 5000 });
    });

    it('links the sale to the customer; the name typed on the tab wins and the registry fills the gaps', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx, { name: 'Cliente da Mesa' });

      const named = await openTab(ctx, 'Mesa da janela');
      await checkout(ctx.accessToken, named.id, { customerId: c.id }).expect(200);
      expect(await saleOf(named.id)).toMatchObject({ customerId: c.id, customerName: 'Mesa da janela', customerPhone: c.phone });

      const other = await setup();
      const c2 = await newCustomer(other, { name: 'Cliente Sem Nome na Comanda' });
      const anonymous = await openTab(other);
      await checkout(other.accessToken, anonymous.id, { customerId: c2.id }).expect(200);
      expect(await saleOf(anonymous.id)).toMatchObject({ customerId: c2.id, customerName: 'Cliente Sem Nome na Comanda', totalCents: 5000 });
      expect(await metrics(other, c2.id)).toMatchObject({ ordersCount: 1, totalSpentCents: 5000 });
    });

    it('refuses another tenant customer, an inactive one and a malformed id, and the tab stays open', async () => {
      const ctx = await setup();
      const stranger = await setup();
      const foreign = await newCustomer(stranger);
      const inactive = await newCustomer(ctx);
      await patch(ctx.accessToken, `/v1/customers/${inactive.id}`, { active: false }).expect(200);
      const tab = await openTab(ctx);

      await checkout(ctx.accessToken, tab.id, { customerId: foreign.id }).expect(404);
      await checkout(ctx.accessToken, tab.id, { customerId: inactive.id }).expect(409);
      await checkout(ctx.accessToken, tab.id, { customerId: 'x' }).expect(400);
      expect((await prisma().tab.findUniqueOrThrow({ where: { id: tab.id } })).status).toBe('OPEN');
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      await checkout(ctx.accessToken, tab.id).expect(200);
    });

    it('a waiter closes tabs but cannot attach a customer (no customers.read)', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const waiter = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'WAITER', [ctx.branchId]);
      const tab = await openTab(ctx);
      await checkout(waiter, tab.id, { customerId: c.id }).expect(403);
      expect((await prisma().tab.findUniqueOrThrow({ where: { id: tab.id } })).status).toBe('OPEN');
      await checkout(waiter, tab.id).expect(200);
    });

    it('a repeated checkout keeps answering with the sale even after the customer was deactivated', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const tab = await openTab(ctx);
      const key = `chk-${uniqueSuffix()}`;
      await checkout(ctx.accessToken, tab.id, { customerId: c.id, idempotencyKey: key }).expect(200);
      await patch(ctx.accessToken, `/v1/customers/${c.id}`, { active: false }).expect(200);
      const replay = await checkout(ctx.accessToken, tab.id, { customerId: c.id, idempotencyKey: key });
      expect(replay.status).toBe(200);
      expect(replay.body.idempotentReplay).toBe(true);
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
    });
  });
});
