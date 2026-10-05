import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createActiveProductE2E,
  createTestApp,
  getPrisma,
  injectAuditFailure,
  registerTenantE2E,
  removeAuditFailure,
  uniqueSuffix,
} from './test-app.util';

type Json = Record<string, unknown>;

// Fase 11, fatia 4 (2/2): how ORDERS earn points. The rule: a concluded order (COMPLETED or
// DELIVERED) of a linked customer earns floor((subtotal - discount) / 100) * pointsPerReal,
// once, in the same transaction that concludes it.
describe('Loyalty x orders (e2e)', () => {
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
  const put = (token: string, path: string, body: Json) => request(server).put(path).set(auth(token)).send(body);
  const patch = (token: string, path: string, body: Json) => request(server).patch(path).set(auth(token)).send(body);
  const prisma = () => getPrisma(app);
  const key = () => `loy-${uniqueSuffix()}`;

  let seq = 0;
  const phone = () => `114${String(Date.now() + ++seq).slice(-8)}`;

  // Burger R$ 25,90 (2590 cents).
  async function setup(program: { enabled: boolean; pointsPerReal: number } | null = { enabled: true, pointsPerReal: 1 }) {
    const tenant = await registerTenantE2E(server);
    const product = await createActiveProductE2E(server, tenant.accessToken, `Burger ${uniqueSuffix()}`, 25.9);
    if (program) await put(tenant.accessToken, '/v1/loyalty/program', program).expect(200);
    return { ...tenant, product };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const newCustomer = async (ctx: Ctx, name = 'Maria Souza') =>
    (await post(ctx.accessToken, '/v1/customers', { name, phone: phone() }).expect(201)).body as { id: string };

  const pdv = async (ctx: Ctx, extra: Json = {}, quantity = 1) =>
    (
      await post(ctx.accessToken, '/v1/pos/orders', {
        branchId: ctx.branchId,
        items: [{ productId: ctx.product.id, quantity }],
        paymentMethod: 'PIX',
        ...extra,
      }).expect(201)
    ).body as { id: string; orderNumber: string };

  const status = (ctx: Ctx, orderId: string, next: string) => patch(ctx.accessToken, `/v1/orders/${orderId}/status`, { status: next });
  async function toReady(ctx: Ctx, orderId: string) {
    for (const next of ['CONFIRMED', 'PREPARING', 'READY']) await status(ctx, orderId, next).expect(200);
  }
  async function complete(ctx: Ctx, orderId: string) {
    await toReady(ctx, orderId);
    await status(ctx, orderId, 'COMPLETED').expect(200);
  }

  const balance = async (ctx: Ctx, customerId: string) =>
    (await get(ctx.accessToken, `/v1/loyalty/customers/${customerId}`).expect(200)).body.balancePoints as number;
  const earnsOf = (orderId: string) => prisma().loyaltyEntry.findMany({ where: { orderId, type: 'EARN' } });

  describe('earning', () => {
    it('credits nothing while the order is open and the points when it is completed, once', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const order = await pdv(ctx, { customerId: c.id }, 2); // 5180 cents -> 51 points

      await toReady(ctx, order.id);
      expect(await balance(ctx, c.id)).toBe(0);
      expect(await earnsOf(order.id)).toHaveLength(0);

      await status(ctx, order.id, 'COMPLETED').expect(200);
      expect(await balance(ctx, c.id)).toBe(51);
      const [earn] = await earnsOf(order.id);
      expect(earn).toMatchObject({ tenantId: ctx.tenantId, customerId: c.id, points: 51, balanceAfter: 51, branchId: ctx.branchId });
      expect(earn.createdByUserId).not.toBeNull();

      const statement = await get(ctx.accessToken, `/v1/loyalty/customers/${c.id}/entries`).expect(200);
      expect(statement.body.data).toEqual([expect.objectContaining({ type: 'EARN', points: 51, orderId: order.id, orderNumber: order.orderNumber })]);

      const audits = await prisma().auditLog.findMany({ where: { tenantId: ctx.tenantId, action: 'LOYALTY_POINTS_EARNED' } });
      expect(audits).toHaveLength(1);
      expect(audits[0].afterData).toMatchObject({ customerId: c.id, orderId: order.id, points: 51, balanceAfter: 51, pointsPerReal: 1 });
    });

    it('uses the configured rate and counts only what was paid after the coupon', async () => {
      const ctx = await setup({ enabled: true, pointsPerReal: 3 });
      const c = await newCustomer(ctx);
      await post(ctx.accessToken, '/v1/coupons', { code: `FID${uniqueSuffix().replace(/-/g, '').slice(-8)}`, discountType: 'FIXED', value: 1000 }).expect(201);
      const coupon = await prisma().coupon.findFirstOrThrow({ where: { tenantId: ctx.tenantId } });
      const order = await pdv(ctx, { customerId: c.id, couponCode: coupon.code }, 2); // 5180 - 1000 = 4180 -> 41 * 3
      await complete(ctx, order.id);
      expect(await balance(ctx, c.id)).toBe(123);
    });

    it('a purchase below one real, or fully discounted, earns nothing and writes no entry', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const cheap = await createActiveProductE2E(server, ctx.accessToken, `Bala ${uniqueSuffix()}`, 0.5);
      const small = (
        await post(ctx.accessToken, '/v1/pos/orders', {
          branchId: ctx.branchId,
          items: [{ productId: cheap.id, quantity: 1 }],
          paymentMethod: 'PIX',
          customerId: c.id,
        }).expect(201)
      ).body as { id: string };
      await complete(ctx, small.id);
      expect(await earnsOf(small.id)).toHaveLength(0);
      expect(await prisma().loyaltyAccount.count({ where: { customerId: c.id } })).toBe(0);
    });

    it('an order without a customer, a cancelled order and a disabled program earn nothing', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);

      const anonymous = await pdv(ctx);
      await complete(ctx, anonymous.id);
      expect(await earnsOf(anonymous.id)).toHaveLength(0);

      const cancelled = await pdv(ctx, { customerId: c.id });
      await status(ctx, cancelled.id, 'CANCELLED').expect(200);
      expect(await earnsOf(cancelled.id)).toHaveLength(0);

      await put(ctx.accessToken, '/v1/loyalty/program', { enabled: false, pointsPerReal: 1 }).expect(200);
      const whileOff = await pdv(ctx, { customerId: c.id });
      await complete(ctx, whileOff.id);
      expect(await earnsOf(whileOff.id)).toHaveLength(0);
      expect(await balance(ctx, c.id)).toBe(0);
      expect(await prisma().loyaltyEntry.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
    });

    it('a restaurant that never configured the program behaves exactly as before', async () => {
      const ctx = await setup(null);
      const c = await newCustomer(ctx);
      const order = await pdv(ctx, { customerId: c.id });
      await complete(ctx, order.id);
      expect(await prisma().loyaltyEntry.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect((await get(ctx.accessToken, `/v1/orders/${order.id}`).expect(200)).body.status).toBe('COMPLETED');
    });

    it('a table sale is born completed and earns in the same transaction', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const table = (await post(ctx.accessToken, '/v1/tables', { branchId: ctx.branchId, number: 1 }).expect(201)).body;
      const tab = (await post(ctx.accessToken, '/v1/tabs', { branchId: ctx.branchId, tableId: table.id }).expect(201)).body;
      await post(ctx.accessToken, `/v1/tabs/${tab.id}/items`, { productId: ctx.product.id, quantity: 3 }).expect(201); // 7770
      await post(ctx.accessToken, `/v1/tabs/${tab.id}/checkout`, { paymentMethod: 'PIX', idempotencyKey: key(), customerId: c.id }).expect(200);

      const sale = await prisma().order.findUniqueOrThrow({ where: { tabId: tab.id } });
      expect(sale.status).toBe('COMPLETED');
      expect(await earnsOf(sale.id)).toHaveLength(1);
      expect(await balance(ctx, c.id)).toBe(77);
    });

    it('a delivery earns when it is delivered, and the delivery fee earns nothing', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await put(ctx.accessToken, '/v1/delivery/settings', { branchId: ctx.branchId, enabled: true, feeCents: 700, minOrderCents: 0 }).expect(200);
      const order = (
        await request(server)
          .post('/v1/public/orders')
          .send({
            restaurantSlug: ctx.slug,
            items: [{ productId: ctx.product.id, quantity: 2 }],
            customer: { name: 'Visitante da Entrega', phone: '11999990000' },
            fulfillmentType: 'DELIVERY',
            address: { street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', zipCode: '01000-000' },
            paymentMethod: 'PIX',
          })
          .expect(201)
      ).body as { id: string };
      // The public checkout links nobody: a staff member does.
      await patch(ctx.accessToken, `/v1/orders/${order.id}/customer`, { customerId: c.id }).expect(200);
      await toReady(ctx, order.id);
      const delivery = await prisma().delivery.findUniqueOrThrow({ where: { orderId: order.id } });
      await post(ctx.accessToken, `/v1/delivery/${delivery.id}/dispatch`).expect(200);
      expect(await balance(ctx, c.id)).toBe(0);

      await post(ctx.accessToken, `/v1/delivery/${delivery.id}/complete`).expect(200);
      const stored = await prisma().order.findUniqueOrThrow({ where: { id: order.id } });
      expect([stored.status, stored.subtotalCents, stored.deliveryFeeCents, stored.totalCents]).toEqual(['DELIVERED', 5180, 700, 5880]);
      expect(await balance(ctx, c.id)).toBe(51); // items only

      // Confirming the delivery again is a replay: no second credit.
      await post(ctx.accessToken, `/v1/delivery/${delivery.id}/complete`).expect(200);
      expect(await earnsOf(order.id)).toHaveLength(1);
    });
  });

  describe('linking a customer after the sale', () => {
    it('an already completed order earns when its customer becomes known, once', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const order = await pdv(ctx);
      await complete(ctx, order.id);
      expect(await earnsOf(order.id)).toHaveLength(0);

      await patch(ctx.accessToken, `/v1/orders/${order.id}/customer`, { customerId: c.id }).expect(200);
      expect(await balance(ctx, c.id)).toBe(25);
      await patch(ctx.accessToken, `/v1/orders/${order.id}/customer`, { customerId: c.id }).expect(200);
      expect(await earnsOf(order.id)).toHaveLength(1);
    });

    it('linking an order that is still open credits nothing yet', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const order = await pdv(ctx);
      await patch(ctx.accessToken, `/v1/orders/${order.id}/customer`, { customerId: c.id }).expect(200);
      expect(await balance(ctx, c.id)).toBe(0);
      await complete(ctx, order.id);
      expect(await balance(ctx, c.id)).toBe(25);
    });

    it('an order that credited points cannot change customer until the points are reversed, and never earns twice', async () => {
      const ctx = await setup();
      const first = await newCustomer(ctx, 'Primeira Cliente');
      const second = await newCustomer(ctx, 'Segunda Cliente');
      const order = await pdv(ctx, { customerId: first.id });
      await complete(ctx, order.id);
      const [earn] = await earnsOf(order.id);

      for (const target of [second.id, null]) {
        const refused = await patch(ctx.accessToken, `/v1/orders/${order.id}/customer`, { customerId: target }).expect(409);
        expect(refused.body.code).toBe('ORDER_HAS_LOYALTY_POINTS');
      }
      expect((await prisma().order.findUniqueOrThrow({ where: { id: order.id } })).customerId).toBe(first.id);

      await post(ctx.accessToken, `/v1/loyalty/entries/${earn.id}/reverse`, { reason: 'Venda lançada no cliente errado', idempotencyKey: key() }).expect(200);
      expect(await balance(ctx, first.id)).toBe(0);

      await patch(ctx.accessToken, `/v1/orders/${order.id}/customer`, { customerId: second.id }).expect(200);
      // The order already had its points: moving it does not pay them again.
      expect(await balance(ctx, second.id)).toBe(0);
      expect(await prisma().loyaltyEntry.count({ where: { orderId: order.id, type: 'EARN' } })).toBe(1);
    });
  });

  describe('atomicity and concurrency', () => {
    afterEach(() => removeAuditFailure(app, 'fail_audit_loyalty_orders_test'));

    it('if the points cannot be recorded the order is not concluded either; it concludes and earns afterwards', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const order = await pdv(ctx, { customerId: c.id });
      await toReady(ctx, order.id);

      await injectAuditFailure(app, 'fail_audit_loyalty_orders_test', ctx.tenantId, 'LOYALTY_POINTS_EARNED');
      await status(ctx, order.id, 'COMPLETED').expect(500);
      expect((await prisma().order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('READY');
      expect(await earnsOf(order.id)).toHaveLength(0);
      expect(await prisma().loyaltyAccount.findUnique({ where: { customerId: c.id } })).toBeNull();

      await removeAuditFailure(app, 'fail_audit_loyalty_orders_test');
      await status(ctx, order.id, 'COMPLETED').expect(200);
      expect(await balance(ctx, c.id)).toBe(25);
    });

    it('two simultaneous "complete" requests conclude and credit once', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const order = await pdv(ctx, { customerId: c.id });
      await toReady(ctx, order.id);

      const results = await Promise.all([status(ctx, order.id, 'COMPLETED'), status(ctx, order.id, 'COMPLETED')]);
      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
      expect(await earnsOf(order.id)).toHaveLength(1);
      expect(await balance(ctx, c.id)).toBe(25);
    });

    it('eight orders of one customer completed at the same time all credit, and the balance adds up', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const orders = [];
      for (let i = 0; i < 8; i++) orders.push(await pdv(ctx, { customerId: c.id }));
      // Straight to READY in the database: this test is about the simultaneous conclusions.
      await prisma().order.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data: { status: 'READY' } });

      const results = await Promise.all(orders.map((order) => status(ctx, order.id, 'COMPLETED')));
      expect(results.every((res) => res.status === 200)).toBe(true);
      expect(await balance(ctx, c.id)).toBe(8 * 25);

      const entries = await prisma().loyaltyEntry.findMany({ where: { customerId: c.id }, orderBy: { balanceAfter: 'asc' } });
      expect(entries.map((entry) => entry.balanceAfter)).toEqual([25, 50, 75, 100, 125, 150, 175, 200]);
      expect((await prisma().loyaltyAccount.findUniqueOrThrow({ where: { customerId: c.id } })).balancePoints).toBe(200);
    });
  });

  describe('end to end', () => {
    it('buy, earn, redeem a reward, and the customer figures of the CRM are untouched by points', async () => {
      const ctx = await setup({ enabled: true, pointsPerReal: 2 });
      const c = await newCustomer(ctx);
      const reward = (await post(ctx.accessToken, '/v1/loyalty/rewards', { name: 'Refrigerante', pointsCost: 40 }).expect(201)).body;
      const order = await pdv(ctx, { customerId: c.id });
      await complete(ctx, order.id); // 25 * 2 = 50

      const redeemed = await post(ctx.accessToken, `/v1/loyalty/customers/${c.id}/redeem`, {
        rewardId: reward.id,
        branchId: ctx.branchId,
        idempotencyKey: key(),
      }).expect(200);
      expect(redeemed.body).toMatchObject({ points: -40, balanceAfter: 10 });

      const detail = await get(ctx.accessToken, `/v1/customers/${c.id}`).expect(200);
      expect(detail.body.metrics).toMatchObject({ ordersCount: 1, totalSpentCents: 2590 });
      // Another tenant's program never touches this one.
      const other = await setup({ enabled: true, pointsPerReal: 1000 });
      const theirs = await newCustomer(other);
      const theirOrder = await pdv(other, { customerId: theirs.id });
      await complete(other, theirOrder.id);
      expect(await balance(other, theirs.id)).toBe(25_000);
      expect(await balance(ctx, c.id)).toBe(10);
    });
  });
});
