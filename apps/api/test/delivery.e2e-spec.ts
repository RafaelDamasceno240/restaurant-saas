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

describe('Delivery (e2e)', () => {
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

  // Product costs R$ 25,00; the usual order is 2 units = R$ 50,00 (5000 cents).
  async function setup() {
    const tenant = await registerTenantE2E(server);
    const product = await createActiveProductE2E(server, tenant.accessToken, `Burger ${uniqueSuffix()}`, 25);
    return { ...tenant, product };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const settings = (ctx: Ctx, body: Partial<{ enabled: boolean; feeCents: number; minOrderCents: number }> = {}) =>
    put(ctx.accessToken, '/v1/delivery/settings', {
      branchId: ctx.branchId,
      enabled: true,
      feeCents: 0,
      minOrderCents: 0,
      ...body,
    });

  const address = {
    street: 'Rua das Flores',
    number: '120',
    complement: 'Ap 4',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    zipCode: '01310-100',
  };

  const publicOrder = (ctx: Ctx, extra: Json = {}, quantity = 2) =>
    request(server)
      .post('/v1/public/orders')
      .send({
        restaurantSlug: ctx.slug,
        items: [{ productId: ctx.product.id, quantity }],
        customer: { name: 'Maria Cliente', phone: '11987654321' },
        fulfillmentType: 'DELIVERY',
        address,
        paymentMethod: 'PIX',
        ...extra,
      });

  async function advance(ctx: Ctx, orderId: string, to: 'CONFIRMED' | 'PREPARING' | 'READY') {
    const flow = ['CONFIRMED', 'PREPARING', 'READY'];
    for (const status of flow.slice(0, flow.indexOf(to) + 1)) {
      await patch(ctx.accessToken, `/v1/orders/${orderId}/status`, { status }).expect(200);
    }
  }

  async function deliveryOf(orderId: string) {
    const row = await getPrisma(app).delivery.findUniqueOrThrow({ where: { orderId } });
    return row;
  }

  // Creates a delivery order already READY (dispatchable).
  async function readyDelivery(ctx: Ctx) {
    const order = (await publicOrder(ctx).expect(201)).body as { id: string };
    await advance(ctx, order.id, 'READY');
    const delivery = await deliveryOf(order.id);
    return { orderId: order.id, deliveryId: delivery.id };
  }

  describe('fee, minimum order and totals (server-side)', () => {
    it('adds the branch fee to the total, stores it as a snapshot and creates the delivery', async () => {
      const ctx = await setup();
      await settings(ctx, { feeCents: 500, minOrderCents: 2000 }).expect(200);

      // The client tries to dictate the fee/total; both are ignored.
      const res = await publicOrder(ctx, { deliveryFee: 0, deliveryFeeCents: 0, total: 1 }).expect(201);
      expect(res.body).toMatchObject({ subtotal: 50, deliveryFee: 5, total: 55, status: 'PENDING' });

      const order = await getPrisma(app).order.findUniqueOrThrow({ where: { id: res.body.id } });
      expect([order.subtotalCents, order.deliveryFeeCents, order.totalCents]).toEqual([5000, 500, 5500]);
      const delivery = await deliveryOf(res.body.id);
      expect(delivery).toMatchObject({ status: 'PENDING', tenantId: ctx.tenantId, branchId: ctx.branchId });
      expect(order.street).toBe('Rua das Flores');
    });

    it('does not create a delivery nor charge a fee for PICKUP orders', async () => {
      const ctx = await setup();
      await settings(ctx, { feeCents: 500 }).expect(200);
      const res = await publicOrder(ctx, { fulfillmentType: 'PICKUP', address: undefined }).expect(201);
      expect(res.body).toMatchObject({ subtotal: 50, deliveryFee: 0, total: 50 });
      expect(await getPrisma(app).delivery.count({ where: { orderId: res.body.id } })).toBe(0);
    });

    it('rejects a delivery order below the minimum and accepts one exactly at the minimum', async () => {
      const ctx = await setup();
      await settings(ctx, { feeCents: 500, minOrderCents: 5001 }).expect(200);
      const below = await publicOrder(ctx).expect(400);
      expect(below.body).toMatchObject({ code: 'DELIVERY_MIN_ORDER_NOT_MET', details: { minOrderCents: 5001 } });
      const prisma = getPrisma(app);
      expect(await prisma.order.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect(await prisma.delivery.count({ where: { tenantId: ctx.tenantId } })).toBe(0);

      await settings(ctx, { feeCents: 500, minOrderCents: 5000 }).expect(200);
      await publicOrder(ctx).expect(201);
    });

    it('refuses delivery when it is disabled, but still accepts pickup', async () => {
      const ctx = await setup();
      await settings(ctx, { enabled: false }).expect(200);
      const res = await publicOrder(ctx).expect(400);
      expect(res.body.code).toBe('DELIVERY_UNAVAILABLE');
      await publicOrder(ctx, { fulfillmentType: 'PICKUP', address: undefined }).expect(201);
      expect(await getPrisma(app).delivery.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
    });

    it('keeps the fee of an existing order when the branch fee changes later', async () => {
      const ctx = await setup();
      await settings(ctx, { feeCents: 500 }).expect(200);
      const first = (await publicOrder(ctx).expect(201)).body;
      await settings(ctx, { feeCents: 900 }).expect(200);
      const second = (await publicOrder(ctx).expect(201)).body;

      expect(second).toMatchObject({ deliveryFee: 9, total: 59 });
      const detail = (await get(ctx.accessToken, `/v1/orders/${first.id}`).expect(200)).body;
      expect(detail).toMatchObject({ deliveryFee: 5, total: 55 });
    });

    it('replays an idempotent checkout without a second order, delivery or fee', async () => {
      const ctx = await setup();
      await settings(ctx, { feeCents: 500 }).expect(200);
      const key = `key-${uniqueSuffix()}`;
      const a = await publicOrder(ctx, { idempotencyKey: key }).expect(201);
      const b = await publicOrder(ctx, { idempotencyKey: key }).expect(201);
      expect(b.body.id).toBe(a.body.id);
      expect(b.body.total).toBe(55);
      expect(await getPrisma(app).delivery.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
    });

    it('exposes the delivery terms on the public menu for the checkout screen', async () => {
      const ctx = await setup();
      await settings(ctx, { feeCents: 750, minOrderCents: 2500 }).expect(200);
      const menu = (await request(server).get(`/v1/public/menu/${ctx.slug}`).expect(200)).body;
      expect(menu.delivery).toEqual({ enabled: true, fee: 7.5, minOrder: 25 });
      expect(JSON.stringify(menu)).not.toContain(ctx.tenantId);
    });
  });

  describe('delivery settings', () => {
    it('validates the settings (integer cents, non-negative, bounded) and audits the change', async () => {
      const ctx = await setup();
      for (const bad of [{ feeCents: -1 }, { feeCents: 1.5 }, { feeCents: 1_000_001 }, { minOrderCents: -5 }]) {
        await settings(ctx, bad).expect(400);
      }
      await put(ctx.accessToken, '/v1/delivery/settings', { branchId: ctx.branchId, enabled: 'yes', feeCents: 0, minOrderCents: 0 }).expect(400);

      await settings(ctx, { enabled: true, feeCents: 600, minOrderCents: 1500 }).expect(200);
      const read = await get(ctx.accessToken, `/v1/delivery/settings?branchId=${ctx.branchId}`).expect(200);
      expect(read.body).toEqual({ branchId: ctx.branchId, enabled: true, feeCents: 600, minOrderCents: 1500 });
      const log = await getPrisma(app).auditLog.findFirstOrThrow({
        where: { tenantId: ctx.tenantId, action: 'DELIVERY_SETTINGS_UPDATED' },
        orderBy: { createdAt: 'desc' },
      });
      expect(log.afterData).toEqual({ enabled: true, feeCents: 600, minOrderCents: 1500 });
      expect(log.userId).not.toBeNull();
    });
  });

  describe('dispatch and completion', () => {
    it('lists deliveries with the address snapshot, amounts in cents and a summary per status', async () => {
      const ctx = await setup();
      await settings(ctx, { feeCents: 500 }).expect(200);
      const { orderId } = await readyDelivery(ctx);
      await publicOrder(ctx).expect(201);

      const all = (await get(ctx.accessToken, `/v1/delivery?branchId=${ctx.branchId}`).expect(200)).body;
      expect(all.summary).toEqual({ PENDING: 2, OUT_FOR_DELIVERY: 0, DELIVERED: 0, CANCELLED: 0, FAILED: 0 });
      expect(all.meta).toMatchObject({ page: 1, total: 2 });
      const row = all.data.find((d: { orderId: string }) => d.orderId === orderId);
      expect(row).toMatchObject({
        status: 'PENDING',
        orderStatus: 'READY',
        customerName: 'Maria Cliente',
        subtotalCents: 5000,
        deliveryFeeCents: 500,
        totalCents: 5500,
        itemCount: 1,
        canDispatch: true,
        address: { street: 'Rua das Flores', number: '120', complement: 'Ap 4', city: 'São Paulo', state: 'SP' },
      });
      const notReady = all.data.find((d: { orderId: string }) => d.orderId !== orderId);
      expect(notReady).toMatchObject({ orderStatus: 'PENDING', canDispatch: false });

      const filtered = (await get(ctx.accessToken, `/v1/delivery?branchId=${ctx.branchId}&status=DELIVERED`).expect(200)).body;
      expect(filtered.data).toHaveLength(0);
      await get(ctx.accessToken, '/v1/delivery').expect(400);
    });

    it('dispatches a READY order, moving order and delivery together, with audit', async () => {
      const ctx = await setup();
      const { orderId, deliveryId } = await readyDelivery(ctx);
      const res = await post(ctx.accessToken, `/v1/delivery/${deliveryId}/dispatch`).expect(200);
      expect(res.body).toMatchObject({ status: 'OUT_FOR_DELIVERY', orderStatus: 'OUT_FOR_DELIVERY', idempotentReplay: false });
      expect(res.body.dispatchedAt).not.toBeNull();

      const prisma = getPrisma(app);
      const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
      expect(delivery.dispatchedByUserId).not.toBeNull();
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('OUT_FOR_DELIVERY');
      const logs = await prisma.auditLog.findMany({
        where: { tenantId: ctx.tenantId, action: { in: ['DELIVERY_DISPATCHED', 'ORDER_STATUS_CHANGED'] } },
        orderBy: { createdAt: 'asc' },
      });
      expect(logs.filter((l) => l.action === 'DELIVERY_DISPATCHED')).toHaveLength(1);
      expect(logs.some((l) => l.action === 'ORDER_STATUS_CHANGED' && JSON.stringify(l.afterData).includes('OUT_FOR_DELIVERY'))).toBe(true);
    });

    it('does not dispatch an order that is not READY yet', async () => {
      const ctx = await setup();
      const order = (await publicOrder(ctx).expect(201)).body;
      const delivery = await deliveryOf(order.id);
      for (const to of ['CONFIRMED', 'PREPARING'] as const) {
        await patch(ctx.accessToken, `/v1/orders/${order.id}/status`, { status: to }).expect(200);
        const res = await post(ctx.accessToken, `/v1/delivery/${delivery.id}/dispatch`).expect(409);
        expect(res.body.code).toBe('ORDER_NOT_READY_FOR_DISPATCH');
      }
      expect((await deliveryOf(order.id)).status).toBe('PENDING');
    });

    it('completes the delivery only after dispatch, and the order becomes DELIVERED', async () => {
      const ctx = await setup();
      const { orderId, deliveryId } = await readyDelivery(ctx);
      const early = await post(ctx.accessToken, `/v1/delivery/${deliveryId}/complete`).expect(409);
      expect(early.body.code).toBe('INVALID_DELIVERY_TRANSITION');

      await post(ctx.accessToken, `/v1/delivery/${deliveryId}/dispatch`).expect(200);
      const done = await post(ctx.accessToken, `/v1/delivery/${deliveryId}/complete`).expect(200);
      expect(done.body).toMatchObject({ status: 'DELIVERED', orderStatus: 'DELIVERED', idempotentReplay: false });

      const prisma = getPrisma(app);
      const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
      expect(delivery.deliveredAt).not.toBeNull();
      expect(delivery.completedByUserId).not.toBeNull();
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('DELIVERED');

      // Final state: replaying complete is a no-op; dispatching again is refused.
      const again = await post(ctx.accessToken, `/v1/delivery/${deliveryId}/complete`).expect(200);
      expect(again.body.idempotentReplay).toBe(true);
      const back = await post(ctx.accessToken, `/v1/delivery/${deliveryId}/dispatch`).expect(409);
      expect(back.body.code).toBe('INVALID_DELIVERY_TRANSITION');
    });

    it('shows the delivery progress to the customer on the public order page', async () => {
      const ctx = await setup();
      const { orderId, deliveryId } = await readyDelivery(ctx);
      await post(ctx.accessToken, `/v1/delivery/${deliveryId}/dispatch`).expect(200);
      const page = (await request(server).get(`/v1/public/orders/${ctx.slug}/${orderId}`).expect(200)).body;
      expect(page.status).toBe('OUT_FOR_DELIVERY');
      expect(page).not.toHaveProperty('customerPhone');
    });

    it('forces delivery orders through the delivery flow, leaving other order flows untouched', async () => {
      const ctx = await setup();
      const { orderId } = await readyDelivery(ctx);
      const blocked = await patch(ctx.accessToken, `/v1/orders/${orderId}/status`, { status: 'COMPLETED' }).expect(409);
      expect(blocked.body.code).toBe('DELIVERY_FLOW_REQUIRED');
      for (const status of ['OUT_FOR_DELIVERY', 'DELIVERED']) {
        const res = await patch(ctx.accessToken, `/v1/orders/${orderId}/status`, { status }).expect(409);
        expect(res.body.code).toBe('INVALID_STATUS_TRANSITION');
      }
      expect((await getPrisma(app).order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('READY');

      const pickup = (await publicOrder(ctx, { fulfillmentType: 'PICKUP', address: undefined }).expect(201)).body;
      await advance(ctx, pickup.id, 'READY');
      await patch(ctx.accessToken, `/v1/orders/${pickup.id}/status`, { status: 'COMPLETED' }).expect(200);
    });

    it('cancels the delivery together with the order, and a cancelled delivery cannot be dispatched', async () => {
      const ctx = await setup();
      const order = (await publicOrder(ctx).expect(201)).body;
      const delivery = await deliveryOf(order.id);
      await patch(ctx.accessToken, `/v1/orders/${order.id}/status`, { status: 'CANCELLED' }).expect(200);

      const after = await deliveryOf(order.id);
      expect(after.status).toBe('CANCELLED');
      expect(after.cancelledAt).not.toBeNull();
      expect(await getPrisma(app).auditLog.count({ where: { tenantId: ctx.tenantId, action: 'DELIVERY_CANCELLED' } })).toBe(1);

      const res = await post(ctx.accessToken, `/v1/delivery/${delivery.id}/dispatch`).expect(409);
      expect(res.body.code).toBe('INVALID_DELIVERY_TRANSITION');
      const detail = (await get(ctx.accessToken, `/v1/orders/${order.id}`).expect(200)).body;
      expect(detail.delivery).toEqual({ id: delivery.id, status: 'CANCELLED', notes: null });
    });
  });

  describe('concurrency', () => {
    it('produces a single effective dispatch when many requests race', async () => {
      const ctx = await setup();
      const { orderId, deliveryId } = await readyDelivery(ctx);
      const results = await Promise.all(
        Array.from({ length: 10 }, () => post(ctx.accessToken, `/v1/delivery/${deliveryId}/dispatch`)),
      );
      expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
      expect(results.filter((r) => r.body.idempotentReplay === false)).toHaveLength(1);
      expect(results.filter((r) => r.body.idempotentReplay === true)).toHaveLength(9);

      const prisma = getPrisma(app);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('OUT_FOR_DELIVERY');
      expect(await prisma.auditLog.count({ where: { tenantId: ctx.tenantId, action: 'DELIVERY_DISPATCHED' } })).toBe(1);
    });

    it('produces a single effective completion when many requests race', async () => {
      const ctx = await setup();
      const { orderId, deliveryId } = await readyDelivery(ctx);
      await post(ctx.accessToken, `/v1/delivery/${deliveryId}/dispatch`).expect(200);
      const results = await Promise.all(
        Array.from({ length: 10 }, () => post(ctx.accessToken, `/v1/delivery/${deliveryId}/complete`)),
      );
      expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
      expect(results.filter((r) => r.body.idempotentReplay === false)).toHaveLength(1);
      const prisma = getPrisma(app);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('DELIVERED');
      expect(await prisma.auditLog.count({ where: { tenantId: ctx.tenantId, action: 'DELIVERY_COMPLETED' } })).toBe(1);
    });

    it('serializes dispatch racing with complete: the delivery never ends inconsistent', async () => {
      const ctx = await setup();
      const { orderId, deliveryId } = await readyDelivery(ctx);
      const results = await Promise.all([
        ...Array.from({ length: 4 }, () => post(ctx.accessToken, `/v1/delivery/${deliveryId}/complete`)),
        ...Array.from({ length: 4 }, () => post(ctx.accessToken, `/v1/delivery/${deliveryId}/dispatch`)),
      ]);
      expect(results.every((r) => [200, 409].includes(r.status))).toBe(true);
      const prisma = getPrisma(app);
      const delivery = await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } });
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      // Whatever interleaving happened (a complete that waited on the lock can run
      // right after a winning dispatch), order and delivery are always in step.
      const expectedOrder = { PENDING: 'READY', OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY', DELIVERED: 'DELIVERED' } as const;
      expect(Object.keys(expectedOrder)).toContain(delivery.status);
      expect(order.status).toBe(expectedOrder[delivery.status as keyof typeof expectedOrder]);

      const count = (action: string) => prisma.auditLog.count({ where: { tenantId: ctx.tenantId, action } });
      const dispatched = await count('DELIVERY_DISPATCHED');
      const completed = await count('DELIVERY_COMPLETED');
      expect(dispatched).toBe(delivery.status === 'PENDING' ? 0 : 1);
      expect(completed).toBe(delivery.status === 'DELIVERED' ? 1 : 0);
    });
  });

  describe('tenant and branch isolation', () => {
    it('never exposes or changes another tenant’s deliveries or settings', async () => {
      const a = await setup();
      const b = await setup();
      await settings(a, { feeCents: 500 }).expect(200);
      const { deliveryId, orderId } = await readyDelivery(a);

      expect((await get(b.accessToken, `/v1/delivery?branchId=${a.branchId}`).expect(404)).body.code).toBe('BRANCH_NOT_FOUND');
      expect((await post(b.accessToken, `/v1/delivery/${deliveryId}/dispatch`).expect(404)).body.code).toBe('DELIVERY_NOT_FOUND');
      await post(b.accessToken, `/v1/delivery/${deliveryId}/complete`).expect(404);
      await get(b.accessToken, `/v1/delivery/settings?branchId=${a.branchId}`).expect(404);
      await put(b.accessToken, '/v1/delivery/settings', { branchId: a.branchId, enabled: false, feeCents: 0, minOrderCents: 0 }).expect(404);

      const prisma = getPrisma(app);
      expect((await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).status).toBe('PENDING');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('READY');
      expect((await prisma.branch.findUniqueOrThrow({ where: { id: a.branchId } })).deliveryEnabled).toBe(true);
      expect((await get(b.accessToken, `/v1/delivery?branchId=${b.branchId}`).expect(200)).body.meta.total).toBe(0);
    });

    it('keeps branches apart for users linked to a single branch', async () => {
      const ctx = await setup();
      const prisma = getPrisma(app);
      const branch2 = await prisma.branch.create({ data: { tenantId: ctx.tenantId, name: 'Filial 2', code: 'F2', status: 'ACTIVE' } });
      const order = (await publicOrder(ctx).expect(201)).body;
      // Move the delivery (and its order) to branch 2 to test scoping by branch.
      await prisma.order.update({ where: { id: order.id }, data: { branchId: branch2.id } });
      const delivery = await deliveryOf(order.id);
      await prisma.delivery.update({ where: { id: delivery.id }, data: { branchId: branch2.id } });

      const manager1 = await createStaffAndLoginE2E(app, server, ctx.tenantId, RoleName.MANAGER, [ctx.branchId]);
      const manager2 = await createStaffAndLoginE2E(app, server, ctx.tenantId, RoleName.MANAGER, [branch2.id]);

      expect((await get(manager1, `/v1/delivery?branchId=${branch2.id}`).expect(403)).body.code).toBe('BRANCH_ACCESS_DENIED');
      await post(manager1, `/v1/delivery/${delivery.id}/dispatch`).expect(404);
      await post(manager1, `/v1/delivery/${delivery.id}/complete`).expect(404);
      await put(manager1, '/v1/delivery/settings', { branchId: branch2.id, enabled: false, feeCents: 0, minOrderCents: 0 }).expect(403);
      expect((await prisma.branch.findUniqueOrThrow({ where: { id: branch2.id } })).deliveryEnabled).toBe(true);

      const list = (await get(manager2, `/v1/delivery?branchId=${branch2.id}`).expect(200)).body;
      expect(list.data.map((d: { id: string }) => d.id)).toEqual([delivery.id]);
      // READY is required to dispatch; this one is PENDING so the branch-2 manager gets the business error, not a scope error.
      expect((await post(manager2, `/v1/delivery/${delivery.id}/dispatch`).expect(409)).body.code).toBe('ORDER_NOT_READY_FOR_DISPATCH');
    });
  });

  describe('permissions (backend)', () => {
    it('grants read/update to DELIVERY, configuration only to management, nothing to other roles', async () => {
      const ctx = await setup();
      const { deliveryId } = await readyDelivery(ctx);
      const roles: [RoleName, { read: boolean; update: boolean; configure: boolean }][] = [
        [RoleName.ADMIN, { read: true, update: true, configure: true }],
        [RoleName.MANAGER, { read: true, update: true, configure: true }],
        [RoleName.DELIVERY, { read: true, update: true, configure: false }],
        [RoleName.CASHIER, { read: false, update: false, configure: false }],
        [RoleName.WAITER, { read: false, update: false, configure: false }],
        [RoleName.KITCHEN, { read: false, update: false, configure: false }],
        [RoleName.VIEWER, { read: false, update: false, configure: false }],
      ];
      for (const [role, can] of roles) {
        const token = await createStaffAndLoginE2E(app, server, ctx.tenantId, role, [ctx.branchId]);
        const read = await get(token, `/v1/delivery?branchId=${ctx.branchId}`);
        const readSettings = await get(token, `/v1/delivery/settings?branchId=${ctx.branchId}`);
        const configure = await put(token, '/v1/delivery/settings', { branchId: ctx.branchId, enabled: true, feeCents: 0, minOrderCents: 0 });
        expect([role, 'read', read.status === 200]).toEqual([role, 'read', can.read]);
        expect([role, 'readSettings', readSettings.status === 200]).toEqual([role, 'readSettings', can.read]);
        expect([role, 'configure', configure.status === 200]).toEqual([role, 'configure', can.configure]);
        if (!can.update) {
          expect((await post(token, `/v1/delivery/${deliveryId}/dispatch`)).status).toBe(403);
          expect((await post(token, `/v1/delivery/${deliveryId}/complete`)).status).toBe(403);
        }
      }
      expect((await getPrisma(app).delivery.findUniqueOrThrow({ where: { id: deliveryId } })).status).toBe('PENDING');

      // A DELIVERY-role user can operate the flow end to end.
      const courier = await createStaffAndLoginE2E(app, server, ctx.tenantId, RoleName.DELIVERY, [ctx.branchId]);
      await post(courier, `/v1/delivery/${deliveryId}/dispatch`).expect(200);
      await post(courier, `/v1/delivery/${deliveryId}/complete`).expect(200);
      await request(server).get(`/v1/delivery?branchId=${ctx.branchId}`).expect(401);
    });
  });

  describe('audit is part of the transaction', () => {
    // A real trigger makes the audit INSERT fail for one tenant+action, so a
    // rollback is proven without mocking any service.
    const failAudit = async (tenantId: string, action: string) => {
      const prisma = getPrisma(app);
      await prisma.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION fail_audit_delivery_test() RETURNS trigger LANGUAGE plpgsql AS $fn$
         BEGIN
           IF NEW."tenantId" = '${tenantId}' AND NEW."action" = '${action}' THEN
             RAISE EXCEPTION 'audit failure injected by test';
           END IF;
           RETURN NEW;
         END $fn$`,
      );
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_audit_delivery_test ON audit_logs`);
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER fail_audit_delivery_test BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_audit_delivery_test()`,
      );
    };
    const restoreAudit = async () => {
      const prisma = getPrisma(app);
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_audit_delivery_test ON audit_logs`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS fail_audit_delivery_test()`);
    };
    afterEach(restoreAudit);

    it('rolls back dispatch (delivery and order) when its audit cannot be written', async () => {
      const ctx = await setup();
      const { orderId, deliveryId } = await readyDelivery(ctx);
      await failAudit(ctx.tenantId, 'DELIVERY_DISPATCHED');
      await post(ctx.accessToken, `/v1/delivery/${deliveryId}/dispatch`).expect(500);
      const prisma = getPrisma(app);
      expect((await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).status).toBe('PENDING');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('READY');
      await restoreAudit();
      await post(ctx.accessToken, `/v1/delivery/${deliveryId}/dispatch`).expect(200);
    });

    it('rolls back completion when its audit cannot be written', async () => {
      const ctx = await setup();
      const { orderId, deliveryId } = await readyDelivery(ctx);
      await post(ctx.accessToken, `/v1/delivery/${deliveryId}/dispatch`).expect(200);
      await failAudit(ctx.tenantId, 'DELIVERY_COMPLETED');
      await post(ctx.accessToken, `/v1/delivery/${deliveryId}/complete`).expect(500);
      const prisma = getPrisma(app);
      expect((await prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).status).toBe('OUT_FOR_DELIVERY');
      expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe('OUT_FOR_DELIVERY');
    });

    it('rolls back the order cancellation when the delivery cancellation audit fails', async () => {
      const ctx = await setup();
      const order = (await publicOrder(ctx).expect(201)).body;
      await failAudit(ctx.tenantId, 'DELIVERY_CANCELLED');
      await patch(ctx.accessToken, `/v1/orders/${order.id}/status`, { status: 'CANCELLED' }).expect(500);
      const prisma = getPrisma(app);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe('PENDING');
      expect((await deliveryOf(order.id)).status).toBe('PENDING');
    });
  });
});
