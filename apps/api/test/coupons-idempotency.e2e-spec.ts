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

// Fase 11, slice 2: the critical part (3/3). A repeated idempotent request must never consume a
// second usage, and nothing may be half applied. Own rate-limit window.
describe('Coupons idempotency and atomicity (e2e)', () => {
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
  const state = async (id: string) => {
    const c = await prisma().coupon.findUniqueOrThrow({ where: { id } });
    return {
      usageCount: c.usageCount,
      usageLimit: c.usageLimit,
      redemptions: await prisma().couponRedemption.count({ where: { couponId: id } }),
      orders: await prisma().order.count({ where: { couponId: id } }),
    };
  };
  const key = () => `idem-${uniqueSuffix()}`;

  // ---------------------------------------------------------------------------------------
  describe('idempotency', () => {
    it('repeating the same request returns the same order and consumes ONE usage', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, { usageLimit: 5 });
      const k = key();
      const first = await pdv(ctx, { couponCode: c.code, idempotencyKey: k }).expect(201);
      const second = await pdv(ctx, {
        couponCode: ` ${c.code.toLowerCase()} `,
        idempotencyKey: k,
      }).expect(201); // other spelling, same request
      const third = await pdv(ctx, { couponCode: c.code, idempotencyKey: k }).expect(201);
      expect([second.body.id, third.body.id]).toEqual([first.body.id, first.body.id]);
      expect(await state(c.id)).toEqual({
        usageCount: 1,
        usageLimit: 5,
        redemptions: 1,
        orders: 1,
      });
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
    });

    it('six SIMULTANEOUS duplicates of the same request, limit 1: all answer with the winner order', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, { usageLimit: 1 });
      const k = key();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => pdv(ctx, { couponCode: c.code, idempotencyKey: k })),
      );
      expect(statuses(results)).toEqual([201, 201, 201, 201, 201, 201]); // never a spurious "coupon used up"
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(await state(c.id)).toEqual({
        usageCount: 1,
        usageLimit: 1,
        redemptions: 1,
        orders: 1,
      });
    });

    it('six simultaneous duplicates with an unlimited coupon also consume exactly one usage', async () => {
      const ctx = await setup();
      const c = await coupon(ctx);
      const k = key();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => pdv(ctx, { couponCode: c.code, idempotencyKey: k })),
      );
      expect(statuses(results)).toEqual([201, 201, 201, 201, 201, 201]);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(await state(c.id)).toEqual({
        usageCount: 1,
        usageLimit: null,
        redemptions: 1,
        orders: 1,
      });
    });

    it('the same holds for the public checkout', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, { usageLimit: 1 });
      const k = key();
      const results = await Promise.all(
        Array.from({ length: 5 }, () => pub(ctx, { couponCode: c.code, idempotencyKey: k })),
      );
      expect(statuses(results)).toEqual([201, 201, 201, 201, 201]);
      expect(new Set(results.map((r) => r.body.id)).size).toBe(1);
      expect(await state(c.id)).toEqual({
        usageCount: 1,
        usageLimit: 1,
        redemptions: 1,
        orders: 1,
      });
    });

    it('a replay after the coupon was used up or deactivated still returns the original order, untouched', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, { usageLimit: 1 });
      const k = key();
      const first = await pdv(ctx, { couponCode: c.code, idempotencyKey: k }).expect(201);
      await post(ctx.accessToken, `/v1/coupons/${c.id}/deactivate`).expect(200);
      const replay = await pdv(ctx, { couponCode: c.code, idempotencyKey: k }).expect(201);
      expect(replay.body).toMatchObject({ id: first.body.id, discount: 5, total: 20 });
      expect(await state(c.id)).toEqual({
        usageCount: 1,
        usageLimit: 1,
        redemptions: 1,
        orders: 1,
      });
    });

    it('the same key with a different coupon, or with and without coupon, is a conflict and consumes nothing', async () => {
      const ctx = await setup();
      const a = await coupon(ctx, { usageLimit: 5 });
      const b = await coupon(ctx, { usageLimit: 5 });
      const k = key();
      await pdv(ctx, { couponCode: a.code, idempotencyKey: k }).expect(201);
      const other = await pdv(ctx, { couponCode: b.code, idempotencyKey: k });
      expect([other.status, other.body.code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
      const none = await pdv(ctx, { idempotencyKey: k });
      expect([none.status, none.body.code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
      expect([(await state(a.id)).usageCount, (await state(b.id)).usageCount]).toEqual([1, 0]);

      const k2 = key();
      await pdv(ctx, { idempotencyKey: k2 }).expect(201); // first WITHOUT a coupon
      const withCoupon = await pdv(ctx, { couponCode: a.code, idempotencyKey: k2 });
      expect([withCoupon.status, withCoupon.body.code]).toEqual([409, 'IDEMPOTENCY_KEY_REUSED']);
      expect((await state(a.id)).usageCount).toBe(1);
    });

    it('a different key is a different order: it consumes a second usage', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, { usageLimit: 5 });
      await pdv(ctx, { couponCode: c.code, idempotencyKey: key() }).expect(201);
      await pdv(ctx, { couponCode: c.code, idempotencyKey: key() }).expect(201);
      expect((await state(c.id)).usageCount).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe('nothing is half applied', () => {
    const failRedemptions = async (tenantId: string) => {
      await prisma().$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION fail_redemption_test() RETURNS trigger LANGUAGE plpgsql AS $fn$
         BEGIN
           IF NEW."tenantId" = '${tenantId}' THEN
             RAISE EXCEPTION 'redemption failure injected by test';
           END IF;
           RETURN NEW;
         END $fn$`,
      );
      await prisma().$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS fail_redemption_test ON coupon_redemptions`,
      );
      await prisma().$executeRawUnsafe(
        `CREATE TRIGGER fail_redemption_test BEFORE INSERT ON coupon_redemptions FOR EACH ROW EXECUTE FUNCTION fail_redemption_test()`,
      );
    };
    const restore = async () => {
      await prisma().$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS fail_redemption_test ON coupon_redemptions`,
      );
      await prisma().$executeRawUnsafe(`DROP FUNCTION IF EXISTS fail_redemption_test()`);
    };
    afterEach(restore);

    it('a failure after the coupon was applied rolls back the order AND the usage; the coupon is usable afterwards', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, { usageLimit: 1 });
      await failRedemptions(ctx.tenantId);
      await pdv(ctx, { couponCode: c.code }).expect(500);
      expect(await state(c.id)).toEqual({
        usageCount: 0,
        usageLimit: 1,
        redemptions: 0,
        orders: 0,
      });
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      await restore();
      await pdv(ctx, { couponCode: c.code }).expect(201); // the single usage was NOT burnt by the failure
      expect(await state(c.id)).toEqual({
        usageCount: 1,
        usageLimit: 1,
        redemptions: 1,
        orders: 1,
      });
    });

    it('a failed CASH sale (no open drawer) leaves the coupon untouched', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, { usageLimit: 1 });
      const res = await pdv(ctx, { couponCode: c.code, paymentMethod: 'CASH' });
      expect([res.status, res.body.code]).toEqual([409, 'CASH_REGISTER_NOT_OPEN']);
      expect(await state(c.id)).toEqual({
        usageCount: 0,
        usageLimit: 1,
        redemptions: 0,
        orders: 0,
      });
    });
  });
});
