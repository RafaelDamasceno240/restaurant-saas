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

// Delivery, final hardening: races between the operational moves and the order
// cancellation, cancellation in every delivery state, and "a cancelled delivery never
// comes back". After every race the delivery/order pair must be one of the valid pairs.
describe('Delivery hardening (e2e)', () => {
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
  const cancelOrder = (token: string, orderId: string) =>
    request(server).patch(`/v1/orders/${orderId}/status`).set(auth(token)).send({ status: 'CANCELLED' });
  const prisma = () => getPrisma(app);

  async function setup() {
    const tenant = await registerTenantE2E(server);
    const product = await createActiveProductE2E(server, tenant.accessToken, `Burger ${uniqueSuffix()}`, 25);
    return { ...tenant, product };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  async function newDelivery(ctx: Ctx, orderStatus: 'PENDING' | 'READY' = 'READY') {
    const order = (
      await request(server)
        .post('/v1/public/orders')
        .send({
          restaurantSlug: ctx.slug,
          items: [{ productId: ctx.product.id, quantity: 1 }],
          customer: { name: 'Maria Cliente', phone: '11987654321' },
          fulfillmentType: 'DELIVERY',
          address: { street: 'Rua A', number: '1', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', zipCode: '01310-100' },
          paymentMethod: 'PIX',
        })
        .expect(201)
    ).body as { id: string };
    if (orderStatus === 'READY') await prisma().order.update({ where: { id: order.id }, data: { status: 'READY' } });
    const delivery = await prisma().delivery.findUniqueOrThrow({ where: { orderId: order.id } });
    return { orderId: order.id, deliveryId: delivery.id };
  }
  async function outForDelivery(ctx: Ctx) {
    const d = await newDelivery(ctx);
    await post(ctx.accessToken, `/v1/delivery/${d.deliveryId}/dispatch`).expect(200);
    return d;
  }
  async function failed(ctx: Ctx) {
    const d = await outForDelivery(ctx);
    await post(ctx.accessToken, `/v1/delivery/${d.deliveryId}/fail`, { reason: 'Cliente ausente' }).expect(200);
    return d;
  }

  // The only (delivery, order) pairs the system may ever show.
  const VALID_PAIRS = new Set([
    'PENDING/READY',
    'PENDING/PENDING',
    'PENDING/CONFIRMED',
    'PENDING/PREPARING',
    'OUT_FOR_DELIVERY/OUT_FOR_DELIVERY',
    'DELIVERED/DELIVERED',
    'FAILED/READY',
    'CANCELLED/CANCELLED',
  ]);
  async function pair(d: { orderId: string; deliveryId: string }) {
    const delivery = await prisma().delivery.findUniqueOrThrow({ where: { id: d.deliveryId } });
    const order = await prisma().order.findUniqueOrThrow({ where: { id: d.orderId } });
    return { delivery, order, key: `${delivery.status}/${order.status}` };
  }
  const noServerError = (statuses: number[]) => expect(statuses.filter((s) => s >= 500)).toEqual([]);

  describe('races between the operational moves', () => {
    it('dispatch x fail leaves a valid pair and a consistent attempt count', async () => {
      for (let i = 0; i < 3; i++) {
        const ctx = await setup();
        const d = await newDelivery(ctx);
        const res = await Promise.all([
          post(ctx.accessToken, `/v1/delivery/${d.deliveryId}/dispatch`),
          post(ctx.accessToken, `/v1/delivery/${d.deliveryId}/fail`, { reason: 'Cliente ausente' }),
        ]);
        noServerError(res.map((r) => r.status));
        expect(res[0].status).toBe(200); // dispatch always lands
        expect([200, 409]).toContain(res[1].status);
        const { delivery, key } = await pair(d);
        expect(VALID_PAIRS.has(key)).toBe(true);
        expect(delivery.attemptCount).toBe(1);
        expect(['OUT_FOR_DELIVERY/OUT_FOR_DELIVERY', 'FAILED/READY']).toContain(key);
        const failLogs = await prisma().auditLog.count({ where: { tenantId: ctx.tenantId, action: 'DELIVERY_FAILED' } });
        expect(failLogs).toBe(key.startsWith('FAILED') ? 1 : 0);
      }
    });

    it('dispatch x complete leaves a valid pair', async () => {
      for (let i = 0; i < 3; i++) {
        const ctx = await setup();
        const d = await newDelivery(ctx);
        const res = await Promise.all([
          post(ctx.accessToken, `/v1/delivery/${d.deliveryId}/dispatch`),
          post(ctx.accessToken, `/v1/delivery/${d.deliveryId}/complete`),
        ]);
        noServerError(res.map((r) => r.status));
        expect(res[0].status).toBe(200);
        expect([200, 409]).toContain(res[1].status);
        const { delivery, key } = await pair(d);
        expect(['OUT_FOR_DELIVERY/OUT_FOR_DELIVERY', 'DELIVERED/DELIVERED']).toContain(key);
        expect(delivery.attemptCount).toBe(1);
        const done = await prisma().auditLog.count({ where: { tenantId: ctx.tenantId, action: 'DELIVERY_COMPLETED' } });
        expect(done).toBe(key.startsWith('DELIVERED') ? 1 : 0);
      }
    });

    it('fail x complete x dispatch-replay: exactly one terminal outcome, pair stays valid', async () => {
      const ctx = await setup();
      const d = await outForDelivery(ctx);
      const res = await Promise.all([
        post(ctx.accessToken, `/v1/delivery/${d.deliveryId}/fail`, { reason: 'Cliente ausente' }),
        post(ctx.accessToken, `/v1/delivery/${d.deliveryId}/complete`),
        post(ctx.accessToken, `/v1/delivery/${d.deliveryId}/dispatch`),
        post(ctx.accessToken, `/v1/delivery/${d.deliveryId}/fail`, { reason: 'Cliente ausente' }),
      ]);
      noServerError(res.map((r) => r.status));
      const { key } = await pair(d);
      expect(['FAILED/READY', 'DELIVERED/DELIVERED']).toContain(key);
      const terminal =
        (await prisma().auditLog.count({ where: { tenantId: ctx.tenantId, action: { in: ['DELIVERY_FAILED', 'DELIVERY_COMPLETED'] } } }));
      expect(terminal).toBe(1);
    });

    it('redelivery x cancel of a failed delivery: one wins, never a resurrected cancellation', async () => {
      for (let i = 0; i < 3; i++) {
        const ctx = await setup();
        const d = await failed(ctx);
        const [redeliver, cancel] = await Promise.all([
          post(ctx.accessToken, `/v1/delivery/${d.deliveryId}/redeliver`),
          cancelOrder(ctx.accessToken, d.orderId),
        ]);
        noServerError([redeliver.status, cancel.status]);
        const { key, delivery } = await pair(d);
        expect(VALID_PAIRS.has(key)).toBe(true);
        if (key === 'CANCELLED/CANCELLED') {
          expect(cancel.status).toBe(200);
          expect(redeliver.status).toBe(409);
          expect(delivery.cancelledAt).not.toBeNull();
        } else {
          expect(key).toBe('PENDING/READY');
          expect(redeliver.status).toBe(200);
          expect(cancel.status).toBe(409);
          expect(delivery.cancelledAt).toBeNull();
        }
      }
    });

    it('cancel x dispatch of a pending delivery (order still PENDING): coherent outcome', async () => {
      const ctx = await setup();
      const d = await newDelivery(ctx, 'PENDING');
      const res = await Promise.all([
        cancelOrder(ctx.accessToken, d.orderId),
        post(ctx.accessToken, `/v1/delivery/${d.deliveryId}/dispatch`),
      ]);
      noServerError(res.map((r) => r.status));
      const { key } = await pair(d);
      // dispatch needs a READY order, so it can never win here
      expect(key).toBe('CANCELLED/CANCELLED');
      expect(res[1].status).toBe(409);
    });
  });

  describe('cancellation', () => {
    it('refuses to cancel an order that is out for delivery and changes nothing', async () => {
      const ctx = await setup();
      const d = await outForDelivery(ctx);
      const res = await cancelOrder(ctx.accessToken, d.orderId);
      expect(res.status).toBe(409);
      expect((await pair(d)).key).toBe('OUT_FOR_DELIVERY/OUT_FOR_DELIVERY');
      expect(await prisma().auditLog.count({ where: { tenantId: ctx.tenantId, action: 'DELIVERY_CANCELLED' } })).toBe(0);
    });

    it('cancels a pending delivery with its order and records a single DELIVERY_CANCELLED', async () => {
      const ctx = await setup();
      const d = await newDelivery(ctx, 'PENDING');
      await cancelOrder(ctx.accessToken, d.orderId).expect(200);
      expect((await pair(d)).key).toBe('CANCELLED/CANCELLED');
      // a repeated cancel is refused and writes nothing more
      const again = await cancelOrder(ctx.accessToken, d.orderId);
      expect([200, 409]).toContain(again.status);
      expect(await prisma().auditLog.count({ where: { tenantId: ctx.tenantId, action: 'DELIVERY_CANCELLED' } })).toBe(1);
    });

    it('never lets a cancelled delivery come back: every later move is refused and nothing changes', async () => {
      const ctx = await setup();
      const d = await failed(ctx);
      const courier = await createStaffAndLoginE2E(app, server, ctx.tenantId, RoleName.DELIVERY, [ctx.branchId]);
      const courierId = JSON.parse(Buffer.from(courier.split('.')[1], 'base64url').toString()).sub as string;
      await cancelOrder(ctx.accessToken, d.orderId).expect(200);
      const before = await pair(d);
      expect(before.key).toBe('CANCELLED/CANCELLED');

      const url = `/v1/delivery/${d.deliveryId}`;
      const attempts = await Promise.all([
        post(ctx.accessToken, `${url}/dispatch`),
        post(ctx.accessToken, `${url}/complete`),
        post(ctx.accessToken, `${url}/fail`, { reason: 'Tarde demais' }),
        post(ctx.accessToken, `${url}/redeliver`),
        put(ctx.accessToken, `${url}/courier`, { courierUserId: courierId }),
        request(server).patch(`${url}/notes`).set(auth(ctx.accessToken)).send({ notes: 'nota' }),
        request(server).patch(`/v1/orders/${d.orderId}/status`).set(auth(ctx.accessToken)).send({ status: 'CONFIRMED' }),
      ]);
      expect(attempts.map((r) => r.status)).toEqual(Array(7).fill(409));
      const after = await pair(d);
      expect(after.key).toBe('CANCELLED/CANCELLED');
      expect(after.delivery.updatedAt.getTime()).toBe(before.delivery.updatedAt.getTime());
      expect(after.delivery.attemptCount).toBe(before.delivery.attemptCount);
      expect(after.delivery.courierUserId).toBeNull();
    });

    it('keeps the courier in the history of a cancelled delivery even after the courier is deactivated', async () => {
      const ctx = await setup();
      const d = await newDelivery(ctx, 'PENDING');
      const courier = await createStaffAndLoginE2E(app, server, ctx.tenantId, RoleName.DELIVERY, [ctx.branchId]);
      const courierId = JSON.parse(Buffer.from(courier.split('.')[1], 'base64url').toString()).sub as string;
      await put(ctx.accessToken, `/v1/delivery/${d.deliveryId}/courier`, { courierUserId: courierId }).expect(200);
      await cancelOrder(ctx.accessToken, d.orderId).expect(200);
      await prisma().user.update({ where: { id: courierId }, data: { status: 'INACTIVE' } });
      const hist = (await get(ctx.accessToken, `/v1/delivery/${d.deliveryId}/history`).expect(200)).body.data;
      expect(hist.map((e: { kind: string }) => e.kind)).toEqual(['CREATED', 'ASSIGNED', 'CANCELLED']);
      expect(hist[1].courier.id).toBe(courierId);
      const view = await get(ctx.accessToken, `/v1/delivery?branchId=${ctx.branchId}&status=CANCELLED`).expect(200);
      expect(view.body.data[0].courier.id).toBe(courierId);
    });
  });

  describe('courier filter with pagination', () => {
    it('paginates "me" deterministically, with totals and summary following the filter', async () => {
      const ctx = await setup();
      const courier = await createStaffAndLoginE2E(app, server, ctx.tenantId, RoleName.DELIVERY, [ctx.branchId]);
      const courierId = JSON.parse(Buffer.from(courier.split('.')[1], 'base64url').toString()).sub as string;
      const mine: string[] = [];
      for (let i = 0; i < 3; i++) {
        const d = await newDelivery(ctx);
        await put(ctx.accessToken, `/v1/delivery/${d.deliveryId}/courier`, { courierUserId: courierId }).expect(200);
        mine.push(d.deliveryId);
      }
      await newDelivery(ctx); // someone else's / unassigned
      const page = (n: number) =>
        get(courier, `/v1/delivery?branchId=${ctx.branchId}&courier=me&status=PENDING&pageSize=2&page=${n}`).expect(200);
      const [p1, p2, p3] = [await page(1), await page(2), await page(3)];
      expect(p1.body.meta).toMatchObject({ total: 3, totalPages: 2, pageSize: 2 });
      expect(p1.body.data).toHaveLength(2);
      expect(p2.body.data).toHaveLength(1);
      expect(p3.body.data).toHaveLength(0);
      const ids = [...p1.body.data, ...p2.body.data].map((x: { id: string }) => x.id);
      expect(new Set(ids).size).toBe(3);
      expect(ids.sort()).toEqual([...mine].sort());
      expect(p1.body.summary.PENDING).toBe(3);
      await get(courier, `/v1/delivery?branchId=${ctx.branchId}&courier=me&pageSize=101`).expect(400);
    });
  });
});
