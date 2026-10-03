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

// Fase 11, slice 2: coupons inside the existing order flows (PDV and public checkout) and the
// read-only preview. Administration: coupons.e2e-spec.ts. Concurrency/idempotency:
// coupons-concurrency.e2e-spec.ts.
describe('Coupons x orders (e2e)', () => {
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
  const post = (token: string, path: string, body: Json = {}) =>
    request(server).post(path).set(auth(token)).send(body);
  const prisma = () => getPrisma(app);

  // Products cost R$ 25,00 (2500 cents) each.
  async function setup() {
    const tenant = await registerTenantE2E(server);
    const product = await createActiveProductE2E(
      server,
      tenant.accessToken,
      `Burger ${uniqueSuffix()}`,
      25,
    );
    return { ...tenant, product };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  let seq = 0;
  const phone = () => `117${String(Date.now() + ++seq).slice(-8)}`;
  const code = () => `T${uniqueSuffix().replace(/-/g, '').slice(-10)}`;

  const coupon = async (ctx: Ctx, extra: Json = {}) =>
    (
      await post(ctx.accessToken, '/v1/coupons', {
        code: code(),
        discountType: 'PERCENTAGE',
        value: 10,
        ...extra,
      }).expect(201)
    ).body as { id: string; code: string };
  const customer = async (ctx: Ctx) =>
    (
      await post(ctx.accessToken, '/v1/customers', { name: 'Maria Souza', phone: phone() }).expect(
        201,
      )
    ).body as { id: string };

  const pdv = (token: string, ctx: Ctx, extra: Json = {}, quantity = 1) =>
    post(token, '/v1/pos/orders', {
      branchId: ctx.branchId,
      items: [{ productId: ctx.product.id, quantity }],
      paymentMethod: 'PIX',
      ...extra,
    });
  const pub = (ctx: Ctx, extra: Json = {}, quantity = 1) =>
    request(server)
      .post('/v1/public/orders')
      .send({
        restaurantSlug: ctx.slug,
        items: [{ productId: ctx.product.id, quantity }],
        customer: { name: 'Fulano Convidado', phone: '11999998888' },
        fulfillmentType: 'PICKUP',
        paymentMethod: 'PIX',
        ...extra,
      });
  const row = (id: string) => prisma().order.findUniqueOrThrow({ where: { id } });
  const usage = async (id: string) =>
    (await prisma().coupon.findUniqueOrThrow({ where: { id } })).usageCount;
  const redemptions = (couponId: string) =>
    prisma().couponRedemption.count({ where: { couponId } });
  const ordersWithCoupon = (couponId: string) => prisma().order.count({ where: { couponId } });
  const failed = async (
    res: { status: number; body: { code?: string } },
    status: number,
    code: string,
  ) => expect([res.status, res.body.code]).toEqual([status, code]);

  // ---------------------------------------------------------------------------------------
  describe('PDV: discount calculated and persisted by the backend', () => {
    it('an order without coupon is unchanged: discount 0, no coupon, total = subtotal', async () => {
      const ctx = await setup();
      const res = await pdv(ctx.accessToken, ctx, {}, 2).expect(201);
      expect(res.body).toMatchObject({
        subtotal: 50,
        discount: 0,
        couponCode: null,
        deliveryFee: 0,
        total: 50,
      });
      const db = await row(res.body.id);
      expect([
        db.subtotalCents,
        db.discountCents,
        db.couponId,
        db.couponCode,
        db.totalCents,
      ]).toEqual([5000, 0, null, null, 5000]);
    });

    it('percentage: price from the backend, discount and snapshot persisted, usage trail written', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, { value: 10 });
      const res = await pdv(ctx.accessToken, ctx, { couponCode: c.code }, 2).expect(201);
      expect(res.body).toMatchObject({ subtotal: 50, discount: 5, couponCode: c.code, total: 45 });
      const db = await row(res.body.id);
      expect([
        db.subtotalCents,
        db.discountCents,
        db.totalCents,
        db.couponId,
        db.couponCode,
      ]).toEqual([5000, 500, 4500, c.id, c.code]);
      expect(await usage(c.id)).toBe(1);
      const trail = await prisma().couponRedemption.findUniqueOrThrow({
        where: { orderId: res.body.id },
      });
      expect(trail).toMatchObject({
        couponId: c.id,
        tenantId: ctx.tenantId,
        discountCents: 500,
        customerId: null,
      });
    });

    it('the coupon is typed in any spelling and the snapshot keeps the canonical code', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, {
        code: `Mix${uniqueSuffix().replace(/-/g, '').slice(-6)}`.toUpperCase(),
      });
      const res = await pdv(ctx.accessToken, ctx, {
        couponCode: `  ${c.code.toLowerCase()} `,
      }).expect(201);
      expect(res.body.couponCode).toBe(c.code);
      expect((await row(res.body.id)).couponCode).toBe(c.code);
    });

    it('fixed discount, and a fixed discount larger than the subtotal never makes the total negative', async () => {
      const ctx = await setup();
      const fixed = await coupon(ctx, { discountType: 'FIXED', value: 700 });
      const a = await pdv(ctx.accessToken, ctx, { couponCode: fixed.code }, 2).expect(201); // 5000 - 700
      expect([a.body.discount, a.body.total]).toEqual([7, 43]);

      const huge = await coupon(ctx, { discountType: 'FIXED', value: 999_999 });
      const b = await pdv(ctx.accessToken, ctx, { couponCode: huge.code }, 1).expect(201); // subtotal 2500
      const db = await row(b.body.id);
      expect([db.subtotalCents, db.discountCents, db.totalCents]).toEqual([2500, 2500, 0]);
      expect(db.totalCents).toBeGreaterThanOrEqual(0);
    });

    it('percentage rounds down to whole cents and respects maxDiscountCents', async () => {
      const ctx = await setup();
      const odd = await coupon(ctx, { value: 33 });
      const a = await pdv(ctx.accessToken, ctx, { couponCode: odd.code }).expect(201); // 33% of 2500 = 825
      expect((await row(a.body.id)).discountCents).toBe(825);
      const capped = await coupon(ctx, { value: 50, maxDiscountCents: 600 });
      const b = await pdv(ctx.accessToken, ctx, { couponCode: capped.code }, 2).expect(201); // 50% of 5000 = 2500, cap 600
      const db = await row(b.body.id);
      expect([db.discountCents, db.totalCents]).toEqual([600, 4400]);
    });

    it('the minimum order is on the subtotal BEFORE the discount: exactly at the minimum is accepted', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, { minOrderCents: 5000 });
      const below = await pdv(ctx.accessToken, ctx, { couponCode: c.code }, 1); // 2500 < 5000
      await failed(below, 400, 'COUPON_MIN_ORDER_NOT_MET');
      expect(await usage(c.id)).toBe(0);
      await pdv(ctx.accessToken, ctx, { couponCode: c.code }, 2).expect(201); // 5000 == minimum
      expect(await usage(c.id)).toBe(1);
    });

    it('a rejected coupon blocks the order entirely: no order, no usage, no trail', async () => {
      const ctx = await setup();
      const before = await prisma().order.count({ where: { tenantId: ctx.tenantId } });
      const unknown = await pdv(ctx.accessToken, ctx, { couponCode: 'NAOEXISTE' });
      await failed(unknown, 400, 'COUPON_NOT_FOUND');
      const c = await coupon(ctx, { minOrderCents: 999_999 });
      await failed(
        await pdv(ctx.accessToken, ctx, { couponCode: c.code }),
        400,
        'COUPON_MIN_ORDER_NOT_MET',
      );
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(before);
      expect(await redemptions(c.id)).toBe(0);
    });

    it('inactive, not started and expired coupons are refused', async () => {
      const ctx = await setup();
      const day = 86_400_000;
      const off = await coupon(ctx);
      await post(ctx.accessToken, `/v1/coupons/${off.id}/deactivate`).expect(200);
      await failed(
        await pdv(ctx.accessToken, ctx, { couponCode: off.code }),
        400,
        'COUPON_NOT_FOUND',
      ); // no ACTIVE coupon has this code
      const future = await coupon(ctx, { startsAt: new Date(Date.now() + day).toISOString() });
      await failed(
        await pdv(ctx.accessToken, ctx, { couponCode: future.code }),
        400,
        'COUPON_NOT_STARTED',
      );
      const past = await coupon(ctx, {
        startsAt: new Date(Date.now() - 2 * day).toISOString(),
        endsAt: new Date(Date.now() - day).toISOString(),
      });
      await failed(
        await pdv(ctx.accessToken, ctx, { couponCode: past.code }),
        400,
        'COUPON_EXPIRED',
      );
      for (const c of [off, future, past]) {
        expect([await usage(c.id), await ordersWithCoupon(c.id)]).toEqual([0, 0]);
      }
    });

    it('a coupon inside its validity window works', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, {
        startsAt: new Date(Date.now() - 3_600_000).toISOString(),
        endsAt: new Date(Date.now() + 3_600_000).toISOString(),
      });
      await pdv(ctx.accessToken, ctx, { couponCode: c.code }).expect(201);
    });

    it('global limit: once used up, further orders are refused and usageCount never passes the limit', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, { usageLimit: 2 });
      await pdv(ctx.accessToken, ctx, { couponCode: c.code }).expect(201);
      await pdv(ctx.accessToken, ctx, { couponCode: c.code }).expect(201);
      await failed(
        await pdv(ctx.accessToken, ctx, { couponCode: c.code }),
        409,
        'COUPON_USAGE_LIMIT_REACHED',
      );
      expect([await usage(c.id), await redemptions(c.id), await ordersWithCoupon(c.id)]).toEqual([
        2, 2, 2,
      ]);
      // an order WITHOUT the coupon still goes through
      await pdv(ctx.accessToken, ctx).expect(201);
    });

    it('per-customer limit: needs a linked customer, counts per customer', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, { perCustomerLimit: 1 });
      const a = await customer(ctx);
      const b = await customer(ctx);
      await failed(
        await pdv(ctx.accessToken, ctx, { couponCode: c.code }),
        400,
        'COUPON_CUSTOMER_REQUIRED',
      );
      const first = await pdv(ctx.accessToken, ctx, {
        couponCode: c.code,
        customerId: a.id,
      }).expect(201);
      expect(
        (await prisma().couponRedemption.findUniqueOrThrow({ where: { orderId: first.body.id } }))
          .customerId,
      ).toBe(a.id);
      await failed(
        await pdv(ctx.accessToken, ctx, { couponCode: c.code, customerId: a.id }),
        409,
        'COUPON_CUSTOMER_LIMIT_REACHED',
      );
      await pdv(ctx.accessToken, ctx, { couponCode: c.code, customerId: b.id }).expect(201); // another customer: fine
      expect(await usage(c.id)).toBe(2);
    });

    it('a customer of ANOTHER tenant is refused before the coupon is touched', async () => {
      const ctx = await setup();
      const other = await setup();
      const foreign = await customer(other);
      const c = await coupon(ctx, { perCustomerLimit: 1 });
      const res = await pdv(ctx.accessToken, ctx, { couponCode: c.code, customerId: foreign.id });
      await failed(res, 404, 'CUSTOMER_NOT_FOUND');
      expect([await usage(c.id), await redemptions(c.id)]).toEqual([0, 0]);
    });

    it('tenant isolation: a coupon of another tenant looks like it does not exist and is not consumed', async () => {
      const a = await setup();
      const b = await setup();
      const theirs = await coupon(b, { value: 50 });
      await failed(
        await pdv(a.accessToken, a, { couponCode: theirs.code }),
        400,
        'COUPON_NOT_FOUND',
      );
      await failed(
        await pdv(a.accessToken, a, { couponCode: theirs.code.toLowerCase() }),
        400,
        'COUPON_NOT_FOUND',
      );
      expect([await usage(theirs.id), await redemptions(theirs.id)]).toEqual([0, 0]);
      // and the same code may exist in tenant A as a different coupon: A resolves A's own
      const mine = await coupon(a, { code: theirs.code, discountType: 'FIXED', value: 100 });
      const res = await pdv(a.accessToken, a, { couponCode: theirs.code }).expect(201);
      expect(res.body.discount).toBe(1);
      expect((await row(res.body.id)).couponId).toBe(mine.id);
      expect(await usage(theirs.id)).toBe(0);
    });

    it('branch isolation: a coupon of another branch is refused; a tenant-wide one and the own-branch one work', async () => {
      const ctx = await setup();
      const branch2 = await prisma().branch.create({
        data: { tenantId: ctx.tenantId, name: 'Filial 2', code: 'F2', status: 'ACTIVE' },
      });
      const onlyB2 = await coupon(ctx, { branchId: branch2.id });
      const onlyB1 = await coupon(ctx, { branchId: ctx.branchId });
      const wide = await coupon(ctx);
      await failed(
        await pdv(ctx.accessToken, ctx, { couponCode: onlyB2.code }),
        400,
        'COUPON_WRONG_BRANCH',
      );
      await pdv(ctx.accessToken, ctx, { couponCode: onlyB1.code }).expect(201);
      await pdv(ctx.accessToken, ctx, { couponCode: wide.code }).expect(201);
      await pdv(ctx.accessToken, ctx, { branchId: branch2.id, couponCode: onlyB2.code }).expect(
        201,
      );
      await failed(
        await pdv(ctx.accessToken, ctx, { branchId: branch2.id, couponCode: onlyB1.code }),
        400,
        'COUPON_WRONG_BRANCH',
      );
      expect([await usage(onlyB1.id), await usage(onlyB2.id), await usage(wide.id)]).toEqual([
        1, 1, 1,
      ]);
    });

    it('the client cannot send the discount, the total, a price or a tenant: the PDV rejects unknown fields', async () => {
      const ctx = await setup();
      const c = await coupon(ctx);
      for (const extra of [
        { discountCents: 99_999 },
        { discount: 99 },
        { total: 0.01 },
        { totalCents: 1 },
        { tenantId: 'x' },
        { couponId: c.id },
      ]) {
        const res = await pdv(ctx.accessToken, ctx, { couponCode: c.code, ...extra });
        expect([JSON.stringify(extra), res.status]).toEqual([JSON.stringify(extra), 400]);
      }
      expect(await usage(c.id)).toBe(0);
    });

    it('CASH sale with coupon: the cash movement carries the DISCOUNTED total', async () => {
      const ctx = await setup();
      await post(ctx.accessToken, '/v1/cash/sessions', {
        branchId: ctx.branchId,
        openingBalanceCents: 10_000,
      }).expect(201);
      const c = await coupon(ctx, { value: 20 });
      const res = await pdv(
        ctx.accessToken,
        ctx,
        { couponCode: c.code, paymentMethod: 'CASH' },
        2,
      ).expect(201); // 5000 - 1000
      expect(res.body.total).toBe(40);
      const movement = await prisma().cashMovement.findFirstOrThrow({
        where: { orderId: res.body.id },
      });
      expect([movement.type, movement.amountCents]).toEqual(['SALE', 4000]);
    });

    it('ORDER_CREATED audit carries the discount and the coupon code, nothing personal', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, { value: 10 });
      const res = await pdv(ctx.accessToken, ctx, {
        couponCode: c.code,
        customerName: 'Fulana de Tal',
        customerPhone: '11955554444',
      }).expect(201);
      const log = await prisma().auditLog.findFirstOrThrow({
        where: { tenantId: ctx.tenantId, action: 'ORDER_CREATED', entityId: res.body.id },
      });
      expect(log.afterData).toMatchObject({
        totalCents: 2250,
        discountCents: 250,
        couponCode: c.code,
      });
      expect(JSON.stringify(log)).not.toMatch(/Fulana|11955554444/);
    });

    it('the order list and detail show the discount; the CRM metrics count the discounted total', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, { value: 10 });
      const cust = await customer(ctx);
      const res = await pdv(
        ctx.accessToken,
        ctx,
        { couponCode: c.code, customerId: cust.id },
        2,
      ).expect(201);
      const detail = (await get(ctx.accessToken, `/v1/orders/${res.body.id}`).expect(200)).body;
      expect(detail).toMatchObject({ subtotal: 50, discount: 5, couponCode: c.code, total: 45 });
      const list = (await get(ctx.accessToken, '/v1/orders').expect(200)).body.data.find(
        (o: { id: string }) => o.id === res.body.id,
      );
      expect(list).toMatchObject({ discount: 5, couponCode: c.code, total: 45 });
      const metrics = (await get(ctx.accessToken, `/v1/customers/${cust.id}`).expect(200)).body
        .metrics;
      expect(metrics).toMatchObject({ ordersCount: 1, totalSpentCents: 4500 });
    });

    it('cancelling the order does NOT give the usage back (known limitation, documented)', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, { usageLimit: 1 });
      const res = await pdv(ctx.accessToken, ctx, { couponCode: c.code }).expect(201);
      await request(server)
        .patch(`/v1/orders/${res.body.id}/status`)
        .set(auth(ctx.accessToken))
        .send({ status: 'CANCELLED' })
        .expect(200);
      expect(await usage(c.id)).toBe(1);
      await failed(
        await pdv(ctx.accessToken, ctx, { couponCode: c.code }),
        409,
        'COUPON_USAGE_LIMIT_REACHED',
      );
    });
  });

  // ---------------------------------------------------------------------------------------
  describe('PDV: who may apply a coupon', () => {
    it('a CASHIER applies coupons (coupons.apply) without being able to administer them', async () => {
      const ctx = await setup();
      const c = await coupon(ctx);
      const cashier = await createStaffAndLoginE2E(app, server, ctx.tenantId, RoleName.CASHIER, [
        ctx.branchId,
      ]);
      const res = await pdv(cashier, ctx, { couponCode: c.code }).expect(201);
      expect(res.body.discount).toBe(2.5);
      expect((await get(cashier, '/v1/coupons')).status).toBe(403);
      expect(
        (await post(cashier, '/v1/coupons', { code: 'CAIXA10', discountType: 'FIXED', value: 100 }))
          .status,
      ).toBe(403);
    });

    it('a user who cannot sell at the PDV cannot apply coupons either', async () => {
      const ctx = await setup();
      const c = await coupon(ctx);
      for (const role of [RoleName.WAITER, RoleName.KITCHEN, RoleName.DELIVERY, RoleName.VIEWER]) {
        const token = await createStaffAndLoginE2E(app, server, ctx.tenantId, role, [ctx.branchId]);
        expect([role, (await pdv(token, ctx, { couponCode: c.code })).status]).toEqual([role, 403]);
      }
      expect(await usage(c.id)).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe('public checkout', () => {
    it('a guest uses a coupon: server prices the items and calculates the discount; extra client fields are ignored', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, { value: 10 });
      const res = await pub(ctx, {
        couponCode: ` ${c.code.toLowerCase()} `,
        // everything below is a tampering attempt and must be silently ignored
        discountCents: 99_999,
        discount: 99,
        total: 0.01,
        items: [{ productId: ctx.product.id, quantity: 2, priceCents: 1, unitPrice: 0.01 }],
      }).expect(201);
      expect(res.body).toMatchObject({
        subtotal: 50,
        discount: 5,
        couponCode: c.code,
        deliveryFee: 0,
        total: 45,
      });
      const db = await row(res.body.id);
      expect([db.subtotalCents, db.discountCents, db.totalCents, db.couponId]).toEqual([
        5000,
        500,
        4500,
        c.id,
      ]);
      expect(await usage(c.id)).toBe(1);
      const confirmation = (
        await request(server).get(`/v1/public/orders/${ctx.slug}/${res.body.id}`).expect(200)
      ).body;
      expect(confirmation).toMatchObject({ discount: 5, couponCode: c.code, total: 45 });
      expect(confirmation).not.toHaveProperty('customerName');
    });

    it('without a coupon the checkout is unchanged', async () => {
      const ctx = await setup();
      const res = await pub(ctx, {}, 2).expect(201);
      expect(res.body).toMatchObject({ subtotal: 50, discount: 0, couponCode: null, total: 50 });
    });

    it('delivery: the fee is never discounted and the delivery minimum uses the subtotal BEFORE the discount', async () => {
      const ctx = await setup();
      await prisma().branch.update({
        where: { id: ctx.branchId },
        data: { deliveryFeeCents: 500, deliveryMinOrderCents: 5000 },
      });
      const c = await coupon(ctx, { value: 50 });
      const address = {
        street: 'Rua A',
        number: '1',
        neighborhood: 'Centro',
        city: 'São Paulo',
        state: 'SP',
        zipCode: '01310-100',
      };
      // subtotal 5000 meets the 5000 minimum even though 5000 - 2500 = 2500 would not
      const ok = await pub(
        ctx,
        { fulfillmentType: 'DELIVERY', address, couponCode: c.code },
        2,
      ).expect(201);
      const db = await row(ok.body.id);
      expect([db.subtotalCents, db.discountCents, db.deliveryFeeCents, db.totalCents]).toEqual([
        5000, 2500, 500, 3000,
      ]);
      expect(ok.body).toMatchObject({ subtotal: 50, discount: 25, deliveryFee: 5, total: 30 });
      // a basket below the delivery minimum is still refused, coupon or not
      const low = await pub(ctx, { fulfillmentType: 'DELIVERY', address, couponCode: c.code }, 1);
      await failed(low, 400, 'DELIVERY_MIN_ORDER_NOT_MET');
      expect(await usage(c.id)).toBe(1);
    });

    it('every coupon refusal looks the same to a guest (no code enumeration) and consumes nothing', async () => {
      const ctx = await setup();
      const day = 86_400_000;
      const off = await coupon(ctx);
      await post(ctx.accessToken, `/v1/coupons/${off.id}/deactivate`).expect(200);
      const expired = await coupon(ctx, {
        startsAt: new Date(Date.now() - 2 * day).toISOString(),
        endsAt: new Date(Date.now() - day).toISOString(),
      });
      const minimum = await coupon(ctx, { minOrderCents: 999_999 });
      const used = await coupon(ctx, { usageLimit: 1 });
      await prisma().coupon.update({ where: { id: used.id }, data: { usageCount: 1 } });
      const perCustomer = await coupon(ctx, { perCustomerLimit: 1 });
      const bodies: unknown[] = [];
      for (const typed of [
        'NAOEXISTE',
        off.code,
        expired.code,
        minimum.code,
        used.code,
        perCustomer.code,
      ]) {
        const res = await pub(ctx, { couponCode: typed });
        expect([typed, res.status, res.body.code]).toEqual([typed, 400, 'COUPON_INVALID']);
        bodies.push(res.body);
      }
      expect(
        new Set(
          bodies.map((b) =>
            JSON.stringify({ code: (b as Json).code, message: (b as Json).message }),
          ),
        ).size,
      ).toBe(1);
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect([await usage(minimum.id), await usage(perCustomer.id)]).toEqual([0, 0]);
    });

    it('a coupon with a per-customer limit can never be used by a guest (no phone-based identification)', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, { perCustomerLimit: 5 });
      await failed(await pub(ctx, { couponCode: c.code }), 400, 'COUPON_INVALID');
      // even if the guest types the phone of a registered customer
      const cust = await prisma().customer.create({
        data: { tenantId: ctx.tenantId, name: 'Cadastrada', phone: '11999998888' },
      });
      await failed(
        await pub(ctx, { couponCode: c.code, customerId: cust.id }),
        400,
        'COUPON_INVALID',
      );
      expect([await usage(c.id), await redemptions(c.id)]).toEqual([0, 0]);
    });

    it('tenant isolation: a guest of restaurant A cannot use a coupon of restaurant B', async () => {
      const a = await setup();
      const b = await setup();
      const theirs = await coupon(b);
      await failed(await pub(a, { couponCode: theirs.code }), 400, 'COUPON_INVALID');
      expect(await usage(theirs.id)).toBe(0);
    });

    it('a branch-scoped coupon only works at the default branch the checkout uses', async () => {
      const ctx = await setup();
      const branch2 = await prisma().branch.create({
        data: { tenantId: ctx.tenantId, name: 'Filial 2', code: 'F2', status: 'ACTIVE' },
      });
      const other = await coupon(ctx, { branchId: branch2.id });
      const here = await coupon(ctx, { branchId: ctx.branchId });
      await failed(await pub(ctx, { couponCode: other.code }), 400, 'COUPON_INVALID');
      await pub(ctx, { couponCode: here.code }).expect(201);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe('preview (read-only)', () => {
    it('PDV preview returns the same discount the order will use, consuming nothing', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, { value: 20, usageLimit: 1 });
      const before = await prisma().order.count({ where: { tenantId: ctx.tenantId } });
      const preview = await post(ctx.accessToken, '/v1/pos/orders/coupon-preview', {
        branchId: ctx.branchId,
        items: [{ productId: ctx.product.id, quantity: 2 }],
        code: ` ${c.code.toLowerCase()}`,
      }).expect(200);
      expect(preview.body).toEqual({
        code: c.code,
        discountType: 'PERCENTAGE',
        subtotalCents: 5000,
        discountCents: 1000,
        subtotalAfterDiscountCents: 4000,
      });
      // nothing consumed, nothing created, no persistent lock: the single usage is still there
      for (let i = 0; i < 3; i++) {
        await post(ctx.accessToken, '/v1/pos/orders/coupon-preview', {
          branchId: ctx.branchId,
          items: [{ productId: ctx.product.id, quantity: 2 }],
          code: c.code,
        }).expect(200);
      }
      expect([await usage(c.id), await redemptions(c.id)]).toEqual([0, 0]);
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(before);
      const order = await pdv(ctx.accessToken, ctx, { couponCode: c.code }, 2).expect(201);
      expect(order.body.discount * 100).toBe(preview.body.discountCents);
    });

    it('PDV preview explains why a coupon is refused (specific codes, staff only)', async () => {
      const ctx = await setup();
      const minimum = await coupon(ctx, { minOrderCents: 999_999 });
      const body = (code: string) => ({
        branchId: ctx.branchId,
        items: [{ productId: ctx.product.id, quantity: 1 }],
        code,
      });
      await failed(
        await post(ctx.accessToken, '/v1/pos/orders/coupon-preview', body(minimum.code)),
        400,
        'COUPON_MIN_ORDER_NOT_MET',
      );
      await failed(
        await post(ctx.accessToken, '/v1/pos/orders/coupon-preview', body('NAOEXISTE')),
        400,
        'COUPON_NOT_FOUND',
      );
      const perCustomer = await coupon(ctx, { perCustomerLimit: 1 });
      await failed(
        await post(ctx.accessToken, '/v1/pos/orders/coupon-preview', body(perCustomer.code)),
        400,
        'COUPON_CUSTOMER_REQUIRED',
      );
      const cust = await customer(ctx);
      await pdv(ctx.accessToken, ctx, { couponCode: perCustomer.code, customerId: cust.id }).expect(
        201,
      );
      await failed(
        await post(ctx.accessToken, '/v1/pos/orders/coupon-preview', {
          ...body(perCustomer.code),
          customerId: cust.id,
        }),
        409,
        'COUPON_CUSTOMER_LIMIT_REACHED',
      );
    });

    it('PDV preview is tenant/branch/customer scoped, permissioned and prices only on the server', async () => {
      const ctx = await setup();
      const other = await setup();
      const c = await coupon(ctx);
      const theirs = await coupon(other);
      const payload = {
        branchId: ctx.branchId,
        items: [{ productId: ctx.product.id, quantity: 1 }],
        code: c.code,
      };
      await failed(
        await post(ctx.accessToken, '/v1/pos/orders/coupon-preview', {
          ...payload,
          code: theirs.code,
        }),
        400,
        'COUPON_NOT_FOUND',
      );
      expect(
        (
          await post(ctx.accessToken, '/v1/pos/orders/coupon-preview', {
            ...payload,
            branchId: other.branchId,
          })
        ).status,
      ).toBe(404);
      const foreignCustomer = await customer(other);
      expect(
        (
          await post(ctx.accessToken, '/v1/pos/orders/coupon-preview', {
            ...payload,
            customerId: foreignCustomer.id,
          })
        ).status,
      ).toBe(404);
      // product of another tenant: refused like in the order
      const foreignProduct = await createActiveProductE2E(
        server,
        other.accessToken,
        `Alheio ${uniqueSuffix()}`,
        1,
      );
      const unavailable = await post(ctx.accessToken, '/v1/pos/orders/coupon-preview', {
        ...payload,
        items: [{ productId: foreignProduct.id, quantity: 1 }],
      });
      await failed(unavailable, 400, 'PRODUCT_UNAVAILABLE');
      // prices/totals cannot be sent
      for (const extra of [
        { subtotalCents: 1 },
        { total: 1 },
        { unitPriceCents: 1 },
        { tenantId: 'x' },
      ]) {
        expect(
          (await post(ctx.accessToken, '/v1/pos/orders/coupon-preview', { ...payload, ...extra }))
            .status,
        ).toBe(400);
      }
      // permissions: CASHIER yes, the others no, anonymous 401
      const cashier = await createStaffAndLoginE2E(app, server, ctx.tenantId, RoleName.CASHIER, [
        ctx.branchId,
      ]);
      await post(cashier, '/v1/pos/orders/coupon-preview', payload).expect(200);
      for (const role of [RoleName.WAITER, RoleName.KITCHEN, RoleName.DELIVERY, RoleName.VIEWER]) {
        const token = await createStaffAndLoginE2E(app, server, ctx.tenantId, role, [ctx.branchId]);
        expect([
          role,
          (await post(token, '/v1/pos/orders/coupon-preview', payload)).status,
        ]).toEqual([role, 403]);
      }
      expect(
        (await request(server).post('/v1/pos/orders/coupon-preview').send(payload)).status,
      ).toBe(401);
      expect(await usage(c.id)).toBe(0);
    });

    it('public preview: same pricing, generic refusal, nothing consumed', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, { value: 10 });
      const preview = (code: string, items = [{ productId: ctx.product.id, quantity: 2 }]) =>
        request(server)
          .post('/v1/public/orders/coupon-preview')
          .send({ restaurantSlug: ctx.slug, items, code });
      const ok = await preview(c.code.toLowerCase()).expect(200);
      expect(ok.body).toEqual({
        code: c.code,
        discountType: 'PERCENTAGE',
        subtotalCents: 5000,
        discountCents: 500,
        subtotalAfterDiscountCents: 4500,
      });
      // tampering fields are ignored, the price is the server's
      const tampered = await request(server)
        .post('/v1/public/orders/coupon-preview')
        .send({
          restaurantSlug: ctx.slug,
          code: c.code,
          items: [{ productId: ctx.product.id, quantity: 2, priceCents: 1 }],
          subtotalCents: 1,
          discountCents: 4999,
        })
        .expect(200);
      expect(tampered.body.discountCents).toBe(500);

      const minimum = await coupon(ctx, { minOrderCents: 999_999 });
      const perCustomer = await coupon(ctx, { perCustomerLimit: 1 });
      for (const typed of ['NAOEXISTE', minimum.code, perCustomer.code]) {
        const res = await preview(typed);
        expect([typed, res.status, res.body.code]).toEqual([typed, 400, 'COUPON_INVALID']);
      }
      const other = await setup();
      const theirs = await coupon(other);
      await failed(await preview(theirs.code), 400, 'COUPON_INVALID'); // another tenant's code
      expect(
        (
          await request(server)
            .post('/v1/public/orders/coupon-preview')
            .send({
              restaurantSlug: 'nao-existe-aqui',
              code: c.code,
              items: [{ productId: ctx.product.id, quantity: 1 }],
            })
        ).status,
      ).toBe(404);
      expect([await usage(c.id), await redemptions(c.id), await usage(theirs.id)]).toEqual([
        0, 0, 0,
      ]);
    });

    it('a preview can go stale: the order re-validates inside its transaction and refuses', async () => {
      const ctx = await setup();
      const c = await coupon(ctx, { value: 10 });
      const payload = {
        branchId: ctx.branchId,
        items: [{ productId: ctx.product.id, quantity: 1 }],
        code: c.code,
      };
      await post(ctx.accessToken, '/v1/pos/orders/coupon-preview', payload).expect(200);
      await post(ctx.accessToken, `/v1/coupons/${c.id}/deactivate`).expect(200); // changed after the preview
      await failed(
        await pdv(ctx.accessToken, ctx, { couponCode: c.code }),
        400,
        'COUPON_NOT_FOUND',
      );
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe('code resolution uses only the ACTIVE homonym', () => {
    it('with an old inactive PROMO and a new active PROMO, orders use the new one', async () => {
      const ctx = await setup();
      const shared = code();
      const old = await coupon(ctx, { code: shared, discountType: 'PERCENTAGE', value: 90 });
      await post(ctx.accessToken, `/v1/coupons/${old.id}/deactivate`).expect(200);
      const fresh = await coupon(ctx, { code: shared, discountType: 'FIXED', value: 300 });
      const res = await pdv(ctx.accessToken, ctx, { couponCode: shared.toLowerCase() }, 2).expect(
        201,
      );
      const db = await row(res.body.id);
      expect([db.couponId, db.discountCents]).toEqual([fresh.id, 300]); // not the old 90 %
      expect([await usage(old.id), await usage(fresh.id)]).toEqual([0, 1]);
      const preview = await post(ctx.accessToken, '/v1/pos/orders/coupon-preview', {
        branchId: ctx.branchId,
        items: [{ productId: ctx.product.id, quantity: 2 }],
        code: shared,
      }).expect(200);
      expect(preview.body.discountCents).toBe(300);
      // the public flow resolves the same record
      const guest = await pub(ctx, { couponCode: shared }, 2).expect(201);
      expect((await row(guest.body.id)).couponId).toBe(fresh.id);
    });

    it('when only inactive homonyms exist, the code is refused', async () => {
      const ctx = await setup();
      const shared = code();
      for (let i = 0; i < 2; i++) {
        const c = await coupon(ctx, { code: shared });
        await post(ctx.accessToken, `/v1/coupons/${c.id}/deactivate`).expect(200);
      }
      await failed(
        await pdv(ctx.accessToken, ctx, { couponCode: shared }),
        400,
        'COUPON_NOT_FOUND',
      );
      await failed(await pub(ctx, { couponCode: shared }), 400, 'COUPON_INVALID');
    });
  });
});
