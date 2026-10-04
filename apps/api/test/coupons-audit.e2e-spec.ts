import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createActiveProductE2E, createTestApp, getPrisma, registerTenantE2E, uniqueSuffix } from './test-app.util';

type Json = Record<string, unknown>;

// Audit of the coupons slice: the two cases the pre-push review left unmeasured.
//   - a burst far above the connection pool on ONE limited coupon (every order waits for the
//     same row lock while holding a connection): the limit must hold and nobody may get a 500;
//   - a CASH sale discounted down to zero: the drawer must stay consistent.
// Own file = own rate-limit window (the app throttles 100 requests/minute per instance).
describe('Coupons audit: load on one coupon and zero-total cash sale (e2e)', () => {
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
  const post = (token: string, path: string, body: Json = {}) => request(server).post(path).set(auth(token)).send(body);
  const prisma = () => getPrisma(app);
  const code = () => `A${uniqueSuffix().replace(/-/g, '').slice(-10)}`;

  async function setup() {
    const tenant = await registerTenantE2E(server);
    const product = await createActiveProductE2E(server, tenant.accessToken, `Burger ${uniqueSuffix()}`, 25); // 2500
    return { ...tenant, product };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const pdv = (ctx: Ctx, extra: Json = {}) =>
    post(ctx.accessToken, '/v1/pos/orders', {
      branchId: ctx.branchId,
      items: [{ productId: ctx.product.id, quantity: 1 }],
      paymentMethod: 'PIX',
      ...extra,
    });

  it('limit 7, forty simultaneous orders: exactly seven succeed, the rest are refused, none fails with 5xx', async () => {
    const ctx = await setup();
    const coupon = (
      await post(ctx.accessToken, '/v1/coupons', { code: code(), discountType: 'FIXED', value: 500, usageLimit: 7 }).expect(201)
    ).body as { id: string; code: string };

    const results = await Promise.all(Array.from({ length: 40 }, () => pdv(ctx, { couponCode: coupon.code })));

    const statuses = results.map((res) => res.status);
    const count = (status: number) => statuses.filter((s) => s === status).length;
    expect({ created: count(201), refused: count(409), other: statuses.filter((s) => s !== 201 && s !== 409) }).toEqual({
      created: 7,
      refused: 33,
      other: [],
    });
    expect(results.filter((res) => res.status === 409).every((res) => res.body.code === 'COUPON_USAGE_LIMIT_REACHED')).toBe(true);

    const stored = await prisma().coupon.findUniqueOrThrow({ where: { id: coupon.id } });
    expect(stored.usageCount).toBe(7);
    expect(await prisma().couponRedemption.count({ where: { couponId: coupon.id } })).toBe(7);
    const orders = await prisma().order.findMany({ where: { tenantId: ctx.tenantId } });
    expect(orders).toHaveLength(7);
    expect(orders.every((order) => order.discountCents === 500 && order.totalCents === 2000)).toBe(true);
  });

  it('a CASH sale discounted to zero is a valid sale: total 0, a SALE of 0 in the drawer, closing still adds up', async () => {
    const ctx = await setup();
    const session = (
      await post(ctx.accessToken, '/v1/cash/sessions', { branchId: ctx.branchId, openingBalanceCents: 10_000 }).expect(201)
    ).body as { id: string };
    const free = (
      await post(ctx.accessToken, '/v1/coupons', { code: code(), discountType: 'PERCENTAGE', value: 100 }).expect(201)
    ).body as { code: string };

    const order = await pdv(ctx, { couponCode: free.code, paymentMethod: 'CASH' }).expect(201);
    expect(order.body.total).toBe(0);
    expect(order.body.discount).toBe(25);

    const paid = await pdv(ctx, { paymentMethod: 'CASH' }).expect(201);
    expect(paid.body.total).toBe(25);

    const sales = await prisma().cashMovement.findMany({
      where: { sessionId: session.id, type: 'SALE' },
      orderBy: { amountCents: 'asc' },
    });
    expect(sales.map((sale) => sale.amountCents)).toEqual([0, 2500]);

    // The backend computes the expected balance: opening + the one sale that brought money in.
    const closed = await request(server)
      .patch(`/v1/cash/sessions/${session.id}/close`)
      .set(auth(ctx.accessToken))
      .send({ countedClosingBalanceCents: 12_500 })
      .expect(200);
    expect(closed.body.expectedBalanceCents).toBe(12_500);
    expect(closed.body.differenceCents).toBe(0);
  });
});
