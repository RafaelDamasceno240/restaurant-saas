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

// Fase 11, slice 2: the critical part (1/3). Real simultaneous requests against a real Nest app and
// a real PostgreSQL: the global usage limit must hold. Split in three files, each with its own
// rate-limit window (the app throttles 100 requests/minute per instance).
describe('Coupons global limit under concurrency (e2e)', () => {
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

  const pdv = (ctx: Ctx, extra: Json = {}) =>
    post(ctx.accessToken, '/v1/pos/orders', {
      branchId: ctx.branchId,
      items: [{ productId: ctx.product.id, quantity: 1 }],
      paymentMethod: 'PIX',
      ...extra,
    });
  const pub = (ctx: Ctx, extra: Json = {}) =>
    request(server)
      .post('/v1/public/orders')
      .send({
        restaurantSlug: ctx.slug,
        items: [{ productId: ctx.product.id, quantity: 1 }],
        customer: { name: 'Fulano Convidado', phone: '11999998888' },
        fulfillmentType: 'PICKUP',
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
  describe('global limit under concurrency', () => {
    it('limit 1, two simultaneous orders: exactly one consumes the usage, the other is refused', async () => {
      const ctx = await setup();
      for (let round = 0; round < 5; round++) {
        const c = await coupon(ctx, { usageLimit: 1 });
        const results = await Promise.all([
          pdv(ctx, { couponCode: c.code }),
          pdv(ctx, { couponCode: c.code }),
        ]);
        expect([round, ...statuses(results)]).toEqual([round, 201, 409]);
        const loser = results.find((r) => r.status === 409)!;
        expect(loser.body.code).toBe('COUPON_USAGE_LIMIT_REACHED');
        expect(await state(c.id)).toEqual({
          usageCount: 1,
          usageLimit: 1,
          redemptions: 1,
          orders: 1,
        });
      }
    });

    it('limit 1, ten simultaneous orders: one wins, nine refused, never over the limit, never a 500', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, { usageLimit: 1 });
      const results = await Promise.all(
        Array.from({ length: 10 }, () => pdv(ctx, { couponCode: c.code })),
      );
      const s = statuses(results);
      expect([count(s, 201), count(s, 409), count(s, 500)]).toEqual([1, 9, 0]);
      expect(await state(c.id)).toEqual({
        usageCount: 1,
        usageLimit: 1,
        redemptions: 1,
        orders: 1,
      });
      // the refused ones left nothing behind: only the winner exists as an order of this tenant
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
    });

    it('limit 3, twelve simultaneous orders: exactly three succeed', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, { usageLimit: 3 });
      const results = await Promise.all(
        Array.from({ length: 12 }, () => pdv(ctx, { couponCode: c.code })),
      );
      const s = statuses(results);
      expect([count(s, 201), count(s, 409), count(s, 500)]).toEqual([3, 9, 0]);
      expect(await state(c.id)).toEqual({
        usageCount: 3,
        usageLimit: 3,
        redemptions: 3,
        orders: 3,
      });
    });

    it('PDV and public checkout racing for the same last usage: exactly one gets it', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, { usageLimit: 1 });
      const results = await Promise.all([
        pdv(ctx, { couponCode: c.code }),
        pub(ctx, { couponCode: c.code }),
        pdv(ctx, { couponCode: c.code }),
        pub(ctx, { couponCode: c.code }),
      ]);
      const s = statuses(results);
      expect([count(s, 201), count(s, 500)]).toEqual([1, 0]);
      expect(s.filter((x) => x !== 201).every((x) => x === 400 || x === 409)).toBe(true); // 409 PDV, generic 400 public
      expect(await state(c.id)).toEqual({
        usageCount: 1,
        usageLimit: 1,
        redemptions: 1,
        orders: 1,
      });
    });

    it('orders with different coupons (or none) never block each other and all succeed', async () => {
      const ctx = await setup();
      const a = await coupon(ctx, { usageLimit: 5 });
      const b = await coupon(ctx, { usageLimit: 5 });
      const results = await Promise.all([
        ...Array.from({ length: 4 }, () => pdv(ctx, { couponCode: a.code })),
        ...Array.from({ length: 4 }, () => pdv(ctx, { couponCode: b.code })),
        ...Array.from({ length: 4 }, () => pdv(ctx)),
      ]);
      expect(statuses(results).every((s) => s === 201)).toBe(true);
      expect((await state(a.id)).usageCount).toBe(4);
      expect((await state(b.id)).usageCount).toBe(4);
    });

    it('CASH sales (cash lock -> coupon lock): limit 3, eight simultaneous orders, no deadlock, totals consistent', async () => {
      const ctx = await setup();
      await post(ctx.accessToken, '/v1/cash/sessions', {
        branchId: ctx.branchId,
        openingBalanceCents: 0,
      }).expect(201);
      const c = await coupon(ctx, { usageLimit: 3 }); // 500 off each 2500
      const results = await Promise.all(
        Array.from({ length: 8 }, () => pdv(ctx, { couponCode: c.code, paymentMethod: 'CASH' })),
      );
      const s = statuses(results);
      expect([count(s, 201), count(s, 409), count(s, 500)]).toEqual([3, 5, 0]);
      expect(await state(c.id)).toEqual({
        usageCount: 3,
        usageLimit: 3,
        redemptions: 3,
        orders: 3,
      });
      const sales = await prisma().cashMovement.findMany({
        where: { tenantId: ctx.tenantId, type: 'SALE' },
      });
      expect(sales).toHaveLength(3); // no SALE without its order, no order without its SALE
      expect(sales.every((m) => m.amountCents === 2000)).toBe(true);
    });
  });
});
