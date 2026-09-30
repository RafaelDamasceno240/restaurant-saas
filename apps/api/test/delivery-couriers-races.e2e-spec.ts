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

// Delivery, slice 3: concurrency of courier assignment against itself and against the
// operational moves. Invariants are asserted (consistency, audit counts, no 5xx), not a
// fixed winner.
describe('Delivery couriers - races (e2e)', () => {
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
  const put = (token: string, path: string, body: Json) => request(server).put(path).set(auth(token)).send(body);
  const del = (token: string, path: string) => request(server).delete(path).set(auth(token));
  const prisma = () => getPrisma(app);
  const url = (id: string) => `/v1/delivery/${id}/courier`;

  async function setup() {
    const tenant = await registerTenantE2E(server);
    const product = await createActiveProductE2E(server, tenant.accessToken, `Burger ${uniqueSuffix()}`, 25);
    return { ...tenant, product };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  async function courier(ctx: Ctx) {
    const token = await createStaffAndLoginE2E(app, server, ctx.tenantId, RoleName.DELIVERY, [ctx.branchId]);
    const id = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub as string;
    return { token, id };
  }
  const couriers = (ctx: Ctx, n: number) => Promise.all(Array.from({ length: n }, () => courier(ctx)));

  async function readyDelivery(ctx: Ctx) {
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
    await prisma().order.update({ where: { id: order.id }, data: { status: 'READY' } });
    const delivery = await prisma().delivery.findUniqueOrThrow({ where: { orderId: order.id } });
    return { orderId: order.id, deliveryId: delivery.id };
  }

  const row = (id: string) => prisma().delivery.findUniqueOrThrow({ where: { id } });
  const audits = (ctx: Ctx, action: string) => prisma().auditLog.count({ where: { tenantId: ctx.tenantId, action } });
  const noServerError = (statuses: number[]) => expect(statuses.filter((s) => s >= 500)).toEqual([]);

  it('10 simultaneous assigns of the same courier write once', async () => {
    const ctx = await setup();
    const { deliveryId } = await readyDelivery(ctx);
    const c = await courier(ctx);
    const res = await Promise.all(Array.from({ length: 10 }, () => put(ctx.accessToken, url(deliveryId), { courierUserId: c.id })));
    expect(res.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(res.filter((r) => r.body.idempotentReplay === false)).toHaveLength(1);
    expect((await row(deliveryId)).courierUserId).toBe(c.id);
    expect(await audits(ctx, 'DELIVERY_ASSIGNED')).toBe(1);
    expect(await audits(ctx, 'DELIVERY_REASSIGNED')).toBe(0);
  });

  it('10 simultaneous assigns of different couriers serialize into one consistent chain', async () => {
    const ctx = await setup();
    const { deliveryId } = await readyDelivery(ctx);
    const list = await couriers(ctx, 10);
    const res = await Promise.all(list.map((c) => put(ctx.accessToken, url(deliveryId), { courierUserId: c.id })));
    expect(res.map((r) => r.status)).toEqual(Array(10).fill(200));

    const logs = await prisma().auditLog.findMany({
      where: { tenantId: ctx.tenantId, action: { in: ['DELIVERY_ASSIGNED', 'DELIVERY_REASSIGNED'] } },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(logs).toHaveLength(10);
    expect(logs.filter((l) => l.action === 'DELIVERY_ASSIGNED')).toHaveLength(1);
    // each link of the chain starts where the previous one ended
    const afters = logs.map((l) => (l.afterData as { courierUserId: string }).courierUserId);
    logs.slice(1).forEach((l, i) => expect((l.beforeData as { courierUserId: string }).courierUserId).toBe(afters[i]));
    expect((await row(deliveryId)).courierUserId).toBe(afters[afters.length - 1]);
  });

  it('10 simultaneous removals write once; 10 mixed reassign/remove leave a coherent state', async () => {
    const ctx = await setup();
    const { deliveryId } = await readyDelivery(ctx);
    const [c1, c2] = await couriers(ctx, 2);
    await put(ctx.accessToken, url(deliveryId), { courierUserId: c1.id }).expect(200);
    const res = await Promise.all(Array.from({ length: 10 }, () => del(ctx.accessToken, url(deliveryId))));
    expect(res.map((r) => r.status)).toEqual(Array(10).fill(200));
    expect(res.filter((r) => r.body.idempotentReplay === false)).toHaveLength(1);
    expect(await audits(ctx, 'DELIVERY_UNASSIGNED')).toBe(1);

    const mixed = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        i % 2 ? del(ctx.accessToken, url(deliveryId)) : put(ctx.accessToken, url(deliveryId), { courierUserId: i % 4 ? c1.id : c2.id }),
      ),
    );
    noServerError(mixed.map((r) => r.status));
    const last = await prisma().auditLog.findFirstOrThrow({
      where: { tenantId: ctx.tenantId, action: { in: ['DELIVERY_ASSIGNED', 'DELIVERY_REASSIGNED', 'DELIVERY_UNASSIGNED'] } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    });
    expect((await row(deliveryId)).courierUserId).toBe((last.afterData as { courierUserId: string | null }).courierUserId);
  });

  it('assign x dispatch: both succeed, the courier is kept and the delivery is OUT_FOR_DELIVERY', async () => {
    const ctx = await setup();
    const { deliveryId } = await readyDelivery(ctx);
    const c = await courier(ctx);
    const [a, d] = await Promise.all([
      put(ctx.accessToken, url(deliveryId), { courierUserId: c.id }),
      post(ctx.accessToken, `/v1/delivery/${deliveryId}/dispatch`),
    ]);
    expect([a.status, d.status]).toEqual([200, 200]);
    const r = await row(deliveryId);
    expect([r.status, r.courierUserId, r.attemptCount]).toEqual(['OUT_FOR_DELIVERY', c.id, 1]);
  });

  it('assign x fail: no lost update, no 5xx', async () => {
    const ctx = await setup();
    const { deliveryId } = await readyDelivery(ctx);
    const [c1, c2] = await couriers(ctx, 2);
    await put(ctx.accessToken, url(deliveryId), { courierUserId: c1.id }).expect(200);
    await post(ctx.accessToken, `/v1/delivery/${deliveryId}/dispatch`).expect(200);
    const [a, f] = await Promise.all([
      put(ctx.accessToken, url(deliveryId), { courierUserId: c2.id }),
      post(ctx.accessToken, `/v1/delivery/${deliveryId}/fail`, { reason: 'Cliente ausente' }),
    ]);
    expect([a.status, f.status]).toEqual([200, 200]);
    const r = await row(deliveryId);
    expect([r.status, r.courierUserId]).toEqual(['FAILED', c2.id]);
  });

  it('redeliver x assign: both land, courier assigned, delivery PENDING again', async () => {
    const ctx = await setup();
    const { deliveryId } = await readyDelivery(ctx);
    const [c1, c2] = await couriers(ctx, 2);
    await put(ctx.accessToken, url(deliveryId), { courierUserId: c1.id }).expect(200);
    await post(ctx.accessToken, `/v1/delivery/${deliveryId}/dispatch`).expect(200);
    await post(ctx.accessToken, `/v1/delivery/${deliveryId}/fail`, { reason: 'Cliente ausente' }).expect(200);
    const [rd, a] = await Promise.all([
      post(ctx.accessToken, `/v1/delivery/${deliveryId}/redeliver`),
      put(ctx.accessToken, url(deliveryId), { courierUserId: c2.id }),
    ]);
    expect([rd.status, a.status]).toEqual([200, 200]);
    const r = await row(deliveryId);
    expect([r.status, r.courierUserId]).toEqual(['PENDING', c2.id]);
  });

  it('cancel x assign: either order leaves a coherent, locked delivery', async () => {
    const ctx = await setup();
    const { deliveryId, orderId } = await readyDelivery(ctx);
    const c = await courier(ctx);
    await prisma().order.update({ where: { id: orderId }, data: { status: 'PENDING' } });
    const [cancel, assign] = await Promise.all([
      request(server).patch(`/v1/orders/${orderId}/status`).set(auth(ctx.accessToken)).send({ status: 'CANCELLED' }),
      put(ctx.accessToken, url(deliveryId), { courierUserId: c.id }),
    ]);
    expect(cancel.status).toBe(200);
    expect([200, 409]).toContain(assign.status);
    if (assign.status === 409) expect(assign.body.code).toBe('DELIVERY_ASSIGNMENT_LOCKED');
    const r = await row(deliveryId);
    expect(r.status).toBe('CANCELLED');
    expect(r.courierUserId).toBe(assign.status === 200 ? c.id : null);
    expect(await audits(ctx, 'DELIVERY_ASSIGNED')).toBe(assign.status === 200 ? 1 : 0);
    // once cancelled nothing moves any more
    const late = await del(ctx.accessToken, url(deliveryId));
    expect(late.status).toBe(r.courierUserId ? 409 : 200);
  });

  it('a deactivated courier is never assigned, even by simultaneous requests', async () => {
    const ctx = await setup();
    const { deliveryId } = await readyDelivery(ctx);
    const c = await courier(ctx);
    await prisma().user.update({ where: { id: c.id }, data: { status: 'INACTIVE' } });
    const res = await Promise.all(Array.from({ length: 5 }, () => put(ctx.accessToken, url(deliveryId), { courierUserId: c.id })));
    expect(res.map((r) => r.status)).toEqual(Array(5).fill(409));
    expect((await row(deliveryId)).courierUserId).toBeNull();
  });
});
