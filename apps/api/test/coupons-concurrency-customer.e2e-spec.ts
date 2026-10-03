import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createActiveProductE2E,
  createTestApp,
  getPrisma,
  registerTenantE2E,
  uniqueSuffix,
} from './test-app.util';

type Json = Record<string, unknown>;

// Fase 11, slice 2: the critical part (2/3). Per-customer limit under real concurrency, and
// administration racing with orders. Own rate-limit window.
describe('Coupons per-customer limit and admin races (e2e)', () => {
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
  const post = (token: string, path: string, body: Json = {}) =>
    request(server).post(path).set(auth(token)).send(body);
  const patch = (token: string, path: string, body: Json) =>
    request(server).patch(path).set(auth(token)).send(body);
  const prisma = () => getPrisma(app);

  async function setup() {
    const tenant = await registerTenantE2E(server);
    const product = await createActiveProductE2E(
      server,
      tenant.accessToken,
      `Burger ${uniqueSuffix()}`,
      25,
    ); // 2500
    return { ...tenant, product };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  let seq = 0;
  const phone = () => `116${String(Date.now() + ++seq).slice(-8)}`;
  const code = () => `K${uniqueSuffix().replace(/-/g, '').slice(-10)}`;
  const coupon = async (ctx: Ctx, extra: Json = {}) =>
    (
      await post(ctx.accessToken, '/v1/coupons', {
        code: code(),
        discountType: 'FIXED',
        value: 500,
        ...extra,
      }).expect(201)
    ).body as { id: string; code: string };
  const customer = async (ctx: Ctx) =>
    (
      await post(ctx.accessToken, '/v1/customers', { name: 'Maria Souza', phone: phone() }).expect(
        201,
      )
    ).body as { id: string };

  const pdv = (ctx: Ctx, extra: Json = {}) =>
    post(ctx.accessToken, '/v1/pos/orders', {
      branchId: ctx.branchId,
      items: [{ productId: ctx.product.id, quantity: 1 }],
      paymentMethod: 'PIX',
      ...extra,
    });

  const statuses = (results: { status: number }[]) =>
    results.map((r) => r.status).sort((a, b) => a - b);
  const count = (statusList: number[], status: number) =>
    statusList.filter((s) => s === status).length;
  const state = async (id: string) => {
    const c = await prisma().coupon.findUniqueOrThrow({ where: { id } });
    return {
      usageCount: c.usageCount,
      usageLimit: c.usageLimit,
      redemptions: await prisma().couponRedemption.count({ where: { couponId: id } }),
      orders: await prisma().order.count({ where: { couponId: id } }),
    };
  };

  // ---------------------------------------------------------------------------------------
  describe('per-customer limit under concurrency', () => {
    it('limit 1 per customer, six simultaneous orders of the same customer: exactly one', async () => {
      const ctx = await setup();
      const cust = await customer(ctx);
      const c = await coupon(ctx, { perCustomerLimit: 1 });
      const results = await Promise.all(
        Array.from({ length: 6 }, () => pdv(ctx, { couponCode: c.code, customerId: cust.id })),
      );
      const s = statuses(results);
      expect([count(s, 201), count(s, 409), count(s, 500)]).toEqual([1, 5, 0]);
      expect(
        results
          .filter((r) => r.status === 409)
          .every((r) => r.body.code === 'COUPON_CUSTOMER_LIMIT_REACHED'),
      ).toBe(true);
      expect(
        await prisma().couponRedemption.count({ where: { couponId: c.id, customerId: cust.id } }),
      ).toBe(1);
    });

    it('limit 2 per customer, seven simultaneous orders: exactly two', async () => {
      const ctx = await setup();
      const cust = await customer(ctx);
      const c = await coupon(ctx, { perCustomerLimit: 2 });
      const results = await Promise.all(
        Array.from({ length: 7 }, () => pdv(ctx, { couponCode: c.code, customerId: cust.id })),
      );
      const s = statuses(results);
      expect([count(s, 201), count(s, 409), count(s, 500)]).toEqual([2, 5, 0]);
      expect(
        await prisma().couponRedemption.count({ where: { couponId: c.id, customerId: cust.id } }),
      ).toBe(2);
    });

    it('two customers racing: each gets exactly one; the limit of one does not leak between them', async () => {
      const ctx = await setup();
      const a = await customer(ctx);
      const b = await customer(ctx);
      const c = await coupon(ctx, { perCustomerLimit: 1 });
      const calls = [a, b, a, b, a, b].map((cust) =>
        pdv(ctx, { couponCode: c.code, customerId: cust.id }),
      );
      const results = await Promise.all(calls);
      const s = statuses(results);
      expect([count(s, 201), count(s, 409), count(s, 500)]).toEqual([2, 4, 0]);
      expect(
        await prisma().couponRedemption.count({ where: { couponId: c.id, customerId: a.id } }),
      ).toBe(1);
      expect(
        await prisma().couponRedemption.count({ where: { couponId: c.id, customerId: b.id } }),
      ).toBe(1);
    });

    it('both limits together: global 3 and one per customer, three customers racing three times each', async () => {
      const ctx = await setup();
      const customers = [await customer(ctx), await customer(ctx), await customer(ctx)];
      const c = await coupon(ctx, { usageLimit: 3, perCustomerLimit: 1 });
      const calls = customers.flatMap((cust) =>
        Array.from({ length: 3 }, () => pdv(ctx, { couponCode: c.code, customerId: cust.id })),
      );
      const results = await Promise.all(calls);
      const s = statuses(results);
      expect([count(s, 201), count(s, 500)]).toEqual([3, 0]);
      expect(await state(c.id)).toEqual({
        usageCount: 3,
        usageLimit: 3,
        redemptions: 3,
        orders: 3,
      });
      for (const cust of customers) {
        expect(
          await prisma().couponRedemption.count({ where: { couponId: c.id, customerId: cust.id } }),
        ).toBe(1);
      }
    });
  });

  // ---------------------------------------------------------------------------------------
  describe('administration racing with orders', () => {
    it('lowering the limit while orders run never leaves usageCount above the limit and never errors with 500', async () => {
      const ctx = await setup();
      for (let round = 0; round < 3; round++) {
        const c = await coupon(ctx, { usageLimit: 8 });
        const orders = Array.from({ length: 6 }, () => pdv(ctx, { couponCode: c.code }));
        const edit = patch(ctx.accessToken, `/v1/coupons/${c.id}`, { usageLimit: 2 });
        const [editRes, ...orderRes] = await Promise.all([edit, ...orders]);
        expect([200, 400]).toContain(editRes.status); // 400 COUPON_USAGE_LIMIT_BELOW_USED if too late
        expect(statuses(orderRes).every((s) => s === 201 || s === 409)).toBe(true);
        const final = await state(c.id);
        expect(final.usageCount).toBeLessThanOrEqual(final.usageLimit!);
        expect(final.redemptions).toBe(final.usageCount);
        expect(final.orders).toBe(final.usageCount);
      }
    });
  });
});
