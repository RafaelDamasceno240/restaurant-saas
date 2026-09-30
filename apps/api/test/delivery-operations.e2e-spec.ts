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

// Delivery, slice 2: failed delivery, redelivery, delivery observation, filters and
// pagination. Kept apart from delivery.e2e-spec.ts (slice 1) so each file has its own
// rate-limit window.
describe('Delivery operations (e2e)', () => {
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

  async function setup() {
    const tenant = await registerTenantE2E(server);
    const product = await createActiveProductE2E(server, tenant.accessToken, `Burger ${uniqueSuffix()}`, 25);
    return { ...tenant, product };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const address = {
    street: 'Rua das Flores',
    number: '120',
    complement: 'Ap 4',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    zipCode: '01310-100',
  };

  const publicOrder = (ctx: Ctx, extra: Json = {}) =>
    request(server)
      .post('/v1/public/orders')
      .send({
        restaurantSlug: ctx.slug,
        items: [{ productId: ctx.product.id, quantity: 2 }],
        customer: { name: 'Maria Cliente', phone: '11987654321' },
        fulfillmentType: 'DELIVERY',
        address,
        paymentMethod: 'PIX',
        ...extra,
      });

  // A dispatchable delivery (order READY). Test setup shortcut: the real
  // PENDING -> READY kitchen flow is covered by delivery.e2e-spec.ts.
  async function readyDelivery(ctx: Ctx, extra: Json = {}) {
    const order = (await publicOrder(ctx, extra).expect(201)).body as { id: string; orderNumber: string };
    await getPrisma(app).order.update({ where: { id: order.id }, data: { status: 'READY' } });
    const delivery = await getPrisma(app).delivery.findUniqueOrThrow({ where: { orderId: order.id } });
    return { orderId: order.id, orderNumber: order.orderNumber, deliveryId: delivery.id };
  }
  async function outForDelivery(ctx: Ctx) {
    const d = await readyDelivery(ctx);
    await post(ctx.accessToken, `/v1/delivery/${d.deliveryId}/dispatch`).expect(200);
    return d;
  }
  async function failedDelivery(ctx: Ctx, reason = 'Cliente ausente') {
    const d = await outForDelivery(ctx);
    await post(ctx.accessToken, `/v1/delivery/${d.deliveryId}/fail`, { reason }).expect(200);
    return d;
  }

  const prisma = () => getPrisma(app);
  const deliveryRow = (id: string) => prisma().delivery.findUniqueOrThrow({ where: { id } });
  const orderStatus = async (id: string) => (await prisma().order.findUniqueOrThrow({ where: { id } })).status;
  const auditCount = (ctx: Ctx, action: string) =>
    prisma().auditLog.count({ where: { tenantId: ctx.tenantId, action } });

  describe('failed delivery', () => {
    it('requires a reason of 3 to 300 characters and changes nothing when it is invalid', async () => {
      const ctx = await setup();
      const { deliveryId } = await outForDelivery(ctx);
      const url = `/v1/delivery/${deliveryId}/fail`;
      await post(ctx.accessToken, url, {}).expect(400);
      await post(ctx.accessToken, url, { reason: 'ab' }).expect(400);
      await post(ctx.accessToken, url, { reason: '     ' }).expect(400);
      await post(ctx.accessToken, url, { reason: 'x'.repeat(301) }).expect(400);
      await post(ctx.accessToken, url, { reason: 42 }).expect(400);
      expect((await deliveryRow(deliveryId)).status).toBe('OUT_FOR_DELIVERY');
      await post(ctx.accessToken, url, { reason: 'x'.repeat(300) }).expect(200);
    });

    it('fails only an out-for-delivery delivery', async () => {
      const ctx = await setup();
      const pending = await readyDelivery(ctx);
      const res = await post(ctx.accessToken, `/v1/delivery/${pending.deliveryId}/fail`, { reason: 'Cliente ausente' }).expect(409);
      expect(res.body.code).toBe('INVALID_DELIVERY_TRANSITION');

      const done = await outForDelivery(ctx);
      await post(ctx.accessToken, `/v1/delivery/${done.deliveryId}/complete`).expect(200);
      const late = await post(ctx.accessToken, `/v1/delivery/${done.deliveryId}/fail`, { reason: 'Tarde demais' }).expect(409);
      expect(late.body.code).toBe('INVALID_DELIVERY_TRANSITION');
      expect((await deliveryRow(done.deliveryId)).status).toBe('DELIVERED');
    });

    it('records the failure, sends the order back to READY (never cancelled) and audits it with context', async () => {
      const ctx = await setup();
      const { orderId, deliveryId } = await outForDelivery(ctx);
      const res = await post(ctx.accessToken, `/v1/delivery/${deliveryId}/fail`, { reason: '  Cliente ausente  ' }).expect(200);
      expect(res.body).toMatchObject({
        status: 'FAILED',
        orderStatus: 'READY',
        failureReason: 'Cliente ausente',
        attemptCount: 1,
        canRedeliver: true,
        canDispatch: false,
        canFail: false,
        idempotentReplay: false,
      });
      expect(res.body.failedAt).not.toBeNull();

      expect(await orderStatus(orderId)).toBe('READY');
      const log = await prisma().auditLog.findFirstOrThrow({ where: { tenantId: ctx.tenantId, action: 'DELIVERY_FAILED' } });
      expect(log).toMatchObject({ entity: 'Delivery', entityId: deliveryId });
      expect(log.userId).not.toBeNull();
      expect(log.beforeData).toEqual({ status: 'OUT_FOR_DELIVERY' });
      expect(log.afterData).toMatchObject({ status: 'FAILED', reason: 'Cliente ausente', attempt: 1, orderId });
      const orderLog = await prisma().auditLog.findMany({ where: { tenantId: ctx.tenantId, action: 'ORDER_STATUS_CHANGED', entityId: orderId } });
      expect(orderLog.some((l) => JSON.stringify(l.afterData).includes('"READY"'))).toBe(true);

      const page = (await request(server).get(`/v1/public/orders/${ctx.slug}/${orderId}`).expect(200)).body;
      expect(page.status).toBe('READY');
    });

    it('treats a repeated failure as a replay: no second audit and the first reason is kept', async () => {
      const ctx = await setup();
      const { deliveryId } = await outForDelivery(ctx);
      await post(ctx.accessToken, `/v1/delivery/${deliveryId}/fail`, { reason: 'Primeiro motivo' }).expect(200);
      const again = await post(ctx.accessToken, `/v1/delivery/${deliveryId}/fail`, { reason: 'Outro motivo' }).expect(200);
      expect(again.body).toMatchObject({ idempotentReplay: true, failureReason: 'Primeiro motivo' });
      expect(await auditCount(ctx, 'DELIVERY_FAILED')).toBe(1);
    });

    it('does not allow dispatching or completing straight from FAILED', async () => {
      const ctx = await setup();
      const { deliveryId } = await failedDelivery(ctx);
      expect((await post(ctx.accessToken, `/v1/delivery/${deliveryId}/dispatch`).expect(409)).body.code).toBe('INVALID_DELIVERY_TRANSITION');
      expect((await post(ctx.accessToken, `/v1/delivery/${deliveryId}/complete`).expect(409)).body.code).toBe('INVALID_DELIVERY_TRANSITION');
      expect((await deliveryRow(deliveryId)).status).toBe('FAILED');
    });
  });

  describe('redelivery', () => {
    it('runs the whole cycle: dispatch, fail, redeliver, dispatch again, complete — keeping the history in the audit log', async () => {
      const ctx = await setup();
      const { orderId, deliveryId } = await readyDelivery(ctx);
      const url = (action: string) => `/v1/delivery/${deliveryId}/${action}`;

      await post(ctx.accessToken, url('dispatch')).expect(200);
      await post(ctx.accessToken, url('fail'), { reason: 'Endereço não encontrado' }).expect(200);

      const requested = await post(ctx.accessToken, url('redeliver')).expect(200);
      expect(requested.body).toMatchObject({
        status: 'PENDING',
        orderStatus: 'READY',
        attemptCount: 1,
        failureReason: null,
        canDispatch: true,
        idempotentReplay: false,
      });

      const second = await post(ctx.accessToken, url('dispatch')).expect(200);
      expect(second.body).toMatchObject({ status: 'OUT_FOR_DELIVERY', attemptCount: 2, orderStatus: 'OUT_FOR_DELIVERY' });
      const done = await post(ctx.accessToken, url('complete')).expect(200);
      expect(done.body).toMatchObject({ status: 'DELIVERED', orderStatus: 'DELIVERED', attemptCount: 2 });
      expect(await orderStatus(orderId)).toBe('DELIVERED');

      const actions = (
        await prisma().auditLog.findMany({
          where: { tenantId: ctx.tenantId, entity: 'Delivery', entityId: deliveryId },
          orderBy: { createdAt: 'asc' },
        })
      ).map((l) => l.action);
      expect(actions).toEqual([
        'DELIVERY_DISPATCHED',
        'DELIVERY_FAILED',
        'DELIVERY_REDELIVERY_REQUESTED',
        'DELIVERY_DISPATCHED',
        'DELIVERY_COMPLETED',
      ]);
      const dispatches = await prisma().auditLog.findMany({
        where: { tenantId: ctx.tenantId, action: 'DELIVERY_DISPATCHED' },
        orderBy: { createdAt: 'asc' },
      });
      expect(dispatches.map((l) => (l.afterData as { attempt: number }).attempt)).toEqual([1, 2]);
    });

    it('allows several failed attempts in a row', async () => {
      const ctx = await setup();
      const { deliveryId } = await failedDelivery(ctx, 'Primeira falha');
      await post(ctx.accessToken, `/v1/delivery/${deliveryId}/redeliver`).expect(200);
      await post(ctx.accessToken, `/v1/delivery/${deliveryId}/dispatch`).expect(200);
      const second = await post(ctx.accessToken, `/v1/delivery/${deliveryId}/fail`, { reason: 'Segunda falha' }).expect(200);
      expect(second.body).toMatchObject({ status: 'FAILED', attemptCount: 2, failureReason: 'Segunda falha' });
    });

    it('refuses a redelivery unless the delivery is FAILED', async () => {
      const ctx = await setup();
      const fresh = await readyDelivery(ctx);
      const out = await outForDelivery(ctx);
      const delivered = await outForDelivery(ctx);
      await post(ctx.accessToken, `/v1/delivery/${delivered.deliveryId}/complete`).expect(200);
      const cancelled = await failedDelivery(ctx);
      await patch(ctx.accessToken, `/v1/orders/${cancelled.orderId}/status`, { status: 'CANCELLED' }).expect(200);

      for (const [label, id] of [
        ['never attempted', fresh.deliveryId],
        ['out for delivery', out.deliveryId],
        ['delivered', delivered.deliveryId],
        ['cancelled', cancelled.deliveryId],
      ]) {
        const res = await post(ctx.accessToken, `/v1/delivery/${id}/redeliver`);
        expect([label, res.status, res.body.code]).toEqual([label, 409, 'INVALID_DELIVERY_TRANSITION']);
      }
      expect((await deliveryRow(fresh.deliveryId)).attemptCount).toBe(0);
    });

    it('treats a repeated redelivery request as a replay', async () => {
      const ctx = await setup();
      const { deliveryId } = await failedDelivery(ctx);
      await post(ctx.accessToken, `/v1/delivery/${deliveryId}/redeliver`).expect(200);
      const again = await post(ctx.accessToken, `/v1/delivery/${deliveryId}/redeliver`).expect(200);
      expect(again.body).toMatchObject({ status: 'PENDING', idempotentReplay: true });
      expect(await auditCount(ctx, 'DELIVERY_REDELIVERY_REQUESTED')).toBe(1);
    });
  });

  describe('cancelling after a failed delivery', () => {
    it('lets the order be cancelled only as an explicit decision on a FAILED delivery', async () => {
      const ctx = await setup();
      const { orderId, deliveryId } = await failedDelivery(ctx);
      await patch(ctx.accessToken, `/v1/orders/${orderId}/status`, { status: 'CANCELLED' }).expect(200);

      expect(await orderStatus(orderId)).toBe('CANCELLED');
      const delivery = await deliveryRow(deliveryId);
      expect(delivery.status).toBe('CANCELLED');
      expect(delivery.cancelledAt).not.toBeNull();
      const log = await prisma().auditLog.findFirstOrThrow({ where: { tenantId: ctx.tenantId, action: 'DELIVERY_CANCELLED' } });
      expect(log.beforeData).toEqual({ deliveryStatus: 'FAILED' });
    });

    it('reverses the stock consumed by the order when it is cancelled after a failed delivery', async () => {
      const ctx = await setup();
      const meat = (
        await post(ctx.accessToken, '/v1/inventory/items', { name: `Carne ${uniqueSuffix()}`, unit: 'KG' }).expect(201)
      ).body as { id: string };
      await request(server)
        .put(`/v1/inventory/recipes/${ctx.product.id}`)
        .set(auth(ctx.accessToken))
        .send({ items: [{ inventoryItemId: meat.id, quantity: 150, unit: 'G' }] })
        .expect(200);
      await post(ctx.accessToken, '/v1/inventory/movements', {
        branchId: ctx.branchId,
        inventoryItemId: meat.id,
        type: 'ENTRY',
        quantity: 2,
        unitCostCents: 4000,
      }).expect(201);
      const stock = async () => {
        const rows = (await get(ctx.accessToken, `/v1/inventory/balances?branchId=${ctx.branchId}`).expect(200)).body;
        return rows.find((row: { id: string }) => row.id === meat.id).quantity as number;
      };

      // Real kitchen flow this time: confirming the order consumes 2 x 150 g.
      const order = (await publicOrder(ctx).expect(201)).body as { id: string };
      for (const status of ['CONFIRMED', 'PREPARING', 'READY']) {
        await patch(ctx.accessToken, `/v1/orders/${order.id}/status`, { status }).expect(200);
      }
      expect(await stock()).toBe(1.7);

      const delivery = await prisma().delivery.findUniqueOrThrow({ where: { orderId: order.id } });
      await post(ctx.accessToken, `/v1/delivery/${delivery.id}/dispatch`).expect(200);
      await post(ctx.accessToken, `/v1/delivery/${delivery.id}/fail`, { reason: 'Cliente ausente' }).expect(200);
      expect(await stock()).toBe(1.7);

      await patch(ctx.accessToken, `/v1/orders/${order.id}/status`, { status: 'CANCELLED' }).expect(200);
      expect(await stock()).toBe(2);
      expect(await prisma().stockMovement.count({ where: { referenceId: order.id, type: 'REVERSAL' } })).toBe(1);
      expect((await deliveryRow(delivery.id)).status).toBe('CANCELLED');
    });

    it('keeps refusing to cancel a READY order whose delivery did not fail', async () => {
      const ctx = await setup();
      const pending = await readyDelivery(ctx);
      expect((await patch(ctx.accessToken, `/v1/orders/${pending.orderId}/status`, { status: 'CANCELLED' }).expect(409)).body.code).toBe(
        'INVALID_STATUS_TRANSITION',
      );

      const requeued = await failedDelivery(ctx);
      await post(ctx.accessToken, `/v1/delivery/${requeued.deliveryId}/redeliver`).expect(200);
      expect((await patch(ctx.accessToken, `/v1/orders/${requeued.orderId}/status`, { status: 'CANCELLED' }).expect(409)).body.code).toBe(
        'INVALID_STATUS_TRANSITION',
      );
      expect(await orderStatus(requeued.orderId)).toBe('READY');
      expect((await deliveryRow(requeued.deliveryId)).status).toBe('PENDING');
    });

    it('requires the order permissions: a DELIVERY user can operate the flow but cannot cancel the order', async () => {
      const ctx = await setup();
      const { orderId, deliveryId } = await failedDelivery(ctx);
      const courier = await createStaffAndLoginE2E(app, server, ctx.tenantId, RoleName.DELIVERY, [ctx.branchId]);
      await patch(courier, `/v1/orders/${orderId}/status`, { status: 'CANCELLED' }).expect(403);
      await post(courier, `/v1/delivery/${deliveryId}/redeliver`).expect(200);
    });
  });

  describe('delivery observation', () => {
    it('is stored separately from the order observation when it comes from the checkout', async () => {
      const ctx = await setup();
      const { orderId, deliveryId } = await readyDelivery(ctx, { notes: 'Sem cebola', deliveryNotes: '  Portão azul  ' });
      expect((await prisma().order.findUniqueOrThrow({ where: { id: orderId } })).notes).toBe('Sem cebola');
      expect((await deliveryRow(deliveryId)).notes).toBe('Portão azul');

      const list = (await get(ctx.accessToken, `/v1/delivery?branchId=${ctx.branchId}`).expect(200)).body;
      expect(list.data[0]).toMatchObject({ orderNotes: 'Sem cebola', deliveryNotes: 'Portão azul', canEditNotes: true });
      const detail = (await get(ctx.accessToken, `/v1/orders/${orderId}`).expect(200)).body;
      expect(detail.notes).toBe('Sem cebola');
      expect(detail.delivery).toMatchObject({ id: deliveryId, notes: 'Portão azul' });
    });

    it('ignores delivery instructions on pickup orders and rejects text above 300 characters', async () => {
      const ctx = await setup();
      const pickup = await publicOrder(ctx, { fulfillmentType: 'PICKUP', address: undefined, deliveryNotes: 'Portão azul' }).expect(201);
      expect(await prisma().delivery.count({ where: { orderId: pickup.body.id } })).toBe(0);

      const before = await prisma().order.count({ where: { tenantId: ctx.tenantId } });
      await publicOrder(ctx, { deliveryNotes: 'x'.repeat(301) }).expect(400);
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(before);
      await publicOrder(ctx, { deliveryNotes: 'x'.repeat(300) }).expect(201);
    });

    it('can be edited, cleared and validated, without touching the order observation', async () => {
      const ctx = await setup();
      const { orderId, deliveryId } = await readyDelivery(ctx, { notes: 'Observação do pedido' });
      const url = `/v1/delivery/${deliveryId}/notes`;

      const set = await patch(ctx.accessToken, url, { notes: 'Interfone 204' }).expect(200);
      expect(set.body).toMatchObject({ deliveryNotes: 'Interfone 204', orderNotes: 'Observação do pedido', idempotentReplay: false });
      expect((await prisma().order.findUniqueOrThrow({ where: { id: orderId } })).notes).toBe('Observação do pedido');

      const log = await prisma().auditLog.findFirstOrThrow({ where: { tenantId: ctx.tenantId, action: 'DELIVERY_NOTES_UPDATED' } });
      expect(log.beforeData).toEqual({ notes: null });
      expect(log.afterData).toEqual({ notes: 'Interfone 204' });
      expect(log.userId).not.toBeNull();

      const same = await patch(ctx.accessToken, url, { notes: '  Interfone 204 ' }).expect(200);
      expect(same.body.idempotentReplay).toBe(true);
      expect(await auditCount(ctx, 'DELIVERY_NOTES_UPDATED')).toBe(1);

      await patch(ctx.accessToken, url, { notes: 'y'.repeat(300) }).expect(200);
      await patch(ctx.accessToken, url, { notes: 'y'.repeat(301) }).expect(400);
      await patch(ctx.accessToken, url, {}).expect(400);
      await patch(ctx.accessToken, url, { notes: 123 }).expect(400);
      expect((await deliveryRow(deliveryId)).notes).toBe('y'.repeat(300));

      expect((await patch(ctx.accessToken, url, { notes: '   ' }).expect(200)).body.deliveryNotes).toBeNull();
      await patch(ctx.accessToken, url, { notes: 'De novo' }).expect(200);
      expect((await patch(ctx.accessToken, url, { notes: null }).expect(200)).body.deliveryNotes).toBeNull();
    });

    it('stays editable after a failure but is read-only once delivered or cancelled', async () => {
      const ctx = await setup();
      const failed = await failedDelivery(ctx);
      await patch(ctx.accessToken, `/v1/delivery/${failed.deliveryId}/notes`, { notes: 'Ligar antes de sair' }).expect(200);

      const delivered = await outForDelivery(ctx);
      await post(ctx.accessToken, `/v1/delivery/${delivered.deliveryId}/complete`).expect(200);
      const res = await patch(ctx.accessToken, `/v1/delivery/${delivered.deliveryId}/notes`, { notes: 'Tarde' }).expect(409);
      expect(res.body.code).toBe('DELIVERY_NOTES_LOCKED');

      await patch(ctx.accessToken, `/v1/orders/${failed.orderId}/status`, { status: 'CANCELLED' }).expect(200);
      await patch(ctx.accessToken, `/v1/delivery/${failed.deliveryId}/notes`, { notes: 'Cancelada' }).expect(409);
      expect((await deliveryRow(failed.deliveryId)).notes).toBe('Ligar antes de sair');
    });
  });

  describe('filters and pagination', () => {
    async function seedList() {
      const ctx = await setup();
      const names = ['Ana Souza', 'Bruno Lima', 'Carla Souza', 'Diego Alves', 'Elisa Prado'];
      const created: { orderNumber: string; deliveryId: string; orderId: string; name: string }[] = [];
      for (const name of names) {
        const order = (await publicOrder(ctx, { customer: { name, phone: '11987654321' } }).expect(201)).body;
        const delivery = await prisma().delivery.findUniqueOrThrow({ where: { orderId: order.id } });
        created.push({ orderNumber: order.orderNumber, deliveryId: delivery.id, orderId: order.id, name });
      }
      // Bruno READY, Carla out for delivery, Diego failed, Elisa delivered.
      await prisma().order.update({ where: { id: created[1].orderId }, data: { status: 'READY' } });
      for (const index of [2, 3, 4]) {
        await prisma().order.update({ where: { id: created[index].orderId }, data: { status: 'READY' } });
        await post(ctx.accessToken, `/v1/delivery/${created[index].deliveryId}/dispatch`).expect(200);
      }
      await post(ctx.accessToken, `/v1/delivery/${created[3].deliveryId}/fail`, { reason: 'Cliente ausente' }).expect(200);
      await post(ctx.accessToken, `/v1/delivery/${created[4].deliveryId}/complete`).expect(200);
      return { ctx, created };
    }
    const list = (ctx: Ctx, query: string) => get(ctx.accessToken, `/v1/delivery?branchId=${ctx.branchId}${query}`);
    const ids = (body: { data: { id: string }[] }) => body.data.map((d) => d.id).sort();

    it('filters by delivery status and exposes the FAILED counter', async () => {
      const { ctx, created } = await seedList();
      const all = (await list(ctx, '').expect(200)).body;
      expect(all.summary).toEqual({ PENDING: 2, OUT_FOR_DELIVERY: 1, DELIVERED: 1, CANCELLED: 0, FAILED: 1 });
      expect(all.meta.total).toBe(5);
      const failed = (await list(ctx, '&status=FAILED').expect(200)).body;
      expect(ids(failed)).toEqual([created[3].deliveryId]);
      expect(failed.data[0]).toMatchObject({ failureReason: 'Cliente ausente', canRedeliver: true });
    });

    it('searches by customer name and by order number, ignoring case and accepting partial text', async () => {
      const { ctx, created } = await seedList();
      const byName = (await list(ctx, '&search=souza').expect(200)).body;
      expect(ids(byName)).toEqual([created[0].deliveryId, created[2].deliveryId].sort());

      const byNumber = (await list(ctx, `&search=${created[1].orderNumber.toLowerCase()}`).expect(200)).body;
      expect(ids(byNumber)).toEqual([created[1].deliveryId]);
      const byPartialNumber = (await list(ctx, `&search=${encodeURIComponent(created[1].orderNumber.slice(2, 8))}`).expect(200)).body;
      expect(ids(byPartialNumber)).toContain(created[1].deliveryId);

      const none = (await list(ctx, '&search=naoexiste').expect(200)).body;
      expect(none.data).toEqual([]);
      expect(none.meta).toMatchObject({ total: 0, totalPages: 1 });
      // Wildcard characters are plain text, not SQL patterns.
      expect((await list(ctx, `&search=${encodeURIComponent('%')}`).expect(200)).body.data).toEqual([]);
    });

    it('filters by order status and combines filters; the summary follows the filters except the status tab', async () => {
      const { ctx, created } = await seedList();
      const ready = (await list(ctx, '&orderStatus=READY').expect(200)).body;
      expect(ids(ready)).toEqual([created[1].deliveryId, created[3].deliveryId].sort());

      const combined = (await list(ctx, '&orderStatus=READY&status=FAILED&search=diego').expect(200)).body;
      expect(ids(combined)).toEqual([created[3].deliveryId]);

      const searched = (await list(ctx, '&search=souza').expect(200)).body;
      expect(searched.summary).toEqual({ PENDING: 1, OUT_FOR_DELIVERY: 1, DELIVERED: 0, CANCELLED: 0, FAILED: 0 });
      const mismatch = (await list(ctx, '&orderStatus=DELIVERED&status=FAILED').expect(200)).body;
      expect(mismatch.data).toEqual([]);
    });

    it('filters by creation period (ISO instants and bare dates)', async () => {
      const { ctx } = await seedList();
      const hour = 3_600_000;
      const now = Date.now();
      const iso = (ms: number) => encodeURIComponent(new Date(ms).toISOString());

      expect((await list(ctx, `&dateFrom=${iso(now - hour)}&dateTo=${iso(now + hour)}`).expect(200)).body.meta.total).toBe(5);
      expect((await list(ctx, `&dateFrom=${iso(now + hour)}`).expect(200)).body.meta.total).toBe(0);
      expect((await list(ctx, `&dateTo=${iso(now - hour)}`).expect(200)).body.meta.total).toBe(0);
      const today = new Date(now).toISOString().slice(0, 10);
      expect((await list(ctx, `&dateFrom=${today}&dateTo=${today}`).expect(200)).body.meta.total).toBe(5);
      expect((await list(ctx, `&dateFrom=${iso(now + hour)}&status=PENDING`).expect(200)).body.summary.PENDING).toBe(0);
    });

    it('paginates deterministically with a bounded page size', async () => {
      const { ctx } = await seedList();
      const page = async (n: number) => (await list(ctx, `&pageSize=2&page=${n}`).expect(200)).body;
      const [p1, p2, p3, p4] = [await page(1), await page(2), await page(3), await page(4)];
      expect(p1.meta).toEqual({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
      expect([p1.data.length, p2.data.length, p3.data.length, p4.data.length]).toEqual([2, 2, 1, 0]);
      const seen = [...p1.data, ...p2.data, ...p3.data].map((d: { id: string }) => d.id);
      expect(new Set(seen).size).toBe(5);

      const again = (await page(2)).data.map((d: { id: string }) => d.id);
      expect(again).toEqual(p2.data.map((d: { id: string }) => d.id));

      await list(ctx, '&pageSize=101').expect(400);
      await list(ctx, '&pageSize=0').expect(400);
      await list(ctx, '&page=0').expect(400);
      await list(ctx, '&page=1001').expect(400);
    });

    it('rejects malformed filters', async () => {
      const ctx = await setup();
      await list(ctx, '&orderStatus=NOPE').expect(400);
      await list(ctx, '&status=NOPE').expect(400);
      await list(ctx, '&dateFrom=ontem').expect(400);
      await list(ctx, '&dateTo=2026-13-45').expect(400);
      await list(ctx, `&search=${'a'.repeat(121)}`).expect(400);
      await get(ctx.accessToken, '/v1/delivery?search=ana').expect(400);
    });
  });

  describe('tenant and branch isolation', () => {
    it('never lets another tenant fail, re-request or annotate a delivery', async () => {
      const a = await setup();
      const b = await setup();
      const { deliveryId } = await outForDelivery(a);

      expect((await post(b.accessToken, `/v1/delivery/${deliveryId}/fail`, { reason: 'Invasão' }).expect(404)).body.code).toBe('DELIVERY_NOT_FOUND');
      await post(b.accessToken, `/v1/delivery/${deliveryId}/redeliver`).expect(404);
      await patch(b.accessToken, `/v1/delivery/${deliveryId}/notes`, { notes: 'Invasão' }).expect(404);
      await get(b.accessToken, `/v1/delivery?branchId=${a.branchId}&search=maria`).expect(404);

      const row = await deliveryRow(deliveryId);
      expect([row.status, row.notes, row.failureReason]).toEqual(['OUT_FOR_DELIVERY', null, null]);
      const searchOwn = (await get(b.accessToken, `/v1/delivery?branchId=${b.branchId}&search=maria`).expect(200)).body;
      expect(searchOwn.meta.total).toBe(0);
    });

    it('keeps branches apart for users linked to a single branch', async () => {
      const ctx = await setup();
      const branch2 = await prisma().branch.create({ data: { tenantId: ctx.tenantId, name: 'Filial 2', code: 'F2', status: 'ACTIVE' } });
      const { orderId, deliveryId } = await failedDelivery(ctx);
      await prisma().order.update({ where: { id: orderId }, data: { branchId: branch2.id } });
      await prisma().delivery.update({ where: { id: deliveryId }, data: { branchId: branch2.id } });

      const manager1 = await createStaffAndLoginE2E(app, server, ctx.tenantId, RoleName.MANAGER, [ctx.branchId]);
      const manager2 = await createStaffAndLoginE2E(app, server, ctx.tenantId, RoleName.MANAGER, [branch2.id]);

      expect((await get(manager1, `/v1/delivery?branchId=${branch2.id}&search=maria`).expect(403)).body.code).toBe('BRANCH_ACCESS_DENIED');
      await post(manager1, `/v1/delivery/${deliveryId}/redeliver`).expect(404);
      await post(manager1, `/v1/delivery/${deliveryId}/fail`, { reason: 'Sem acesso' }).expect(404);
      await patch(manager1, `/v1/delivery/${deliveryId}/notes`, { notes: 'Sem acesso' }).expect(404);
      expect((await deliveryRow(deliveryId)).status).toBe('FAILED');

      const visible = (await get(manager2, `/v1/delivery?branchId=${branch2.id}&status=FAILED&search=maria`).expect(200)).body;
      expect(visible.data.map((d: { id: string }) => d.id)).toEqual([deliveryId]);
      await post(manager2, `/v1/delivery/${deliveryId}/redeliver`).expect(200);
    });
  });

  describe('permissions (backend)', () => {
    it('allows the new actions to management and the DELIVERY role only', async () => {
      const ctx = await setup();
      const roles: [RoleName, boolean][] = [
        [RoleName.ADMIN, true],
        [RoleName.MANAGER, true],
        [RoleName.DELIVERY, true],
        [RoleName.CASHIER, false],
        [RoleName.WAITER, false],
        [RoleName.KITCHEN, false],
        [RoleName.VIEWER, false],
      ];
      for (const [role, allowed] of roles) {
        const token = await createStaffAndLoginE2E(app, server, ctx.tenantId, role, [ctx.branchId]);
        const out = await outForDelivery(ctx);
        const fail = await post(token, `/v1/delivery/${out.deliveryId}/fail`, { reason: 'Cliente ausente' });
        const notes = await patch(token, `/v1/delivery/${out.deliveryId}/notes`, { notes: `Nota ${role}` });
        const redeliver = await post(token, `/v1/delivery/${out.deliveryId}/redeliver`);
        const filtered = await get(token, `/v1/delivery?branchId=${ctx.branchId}&search=maria&status=FAILED`);
        expect([role, 'fail', fail.status === 200]).toEqual([role, 'fail', allowed]);
        expect([role, 'notes', notes.status === 200]).toEqual([role, 'notes', allowed]);
        expect([role, 'redeliver', redeliver.status === 200]).toEqual([role, 'redeliver', allowed]);
        expect([role, 'list', filtered.status === 200]).toEqual([role, 'list', allowed]);
        if (!allowed) {
          expect([fail.status, notes.status, redeliver.status, filtered.status]).toEqual([403, 403, 403, 403]);
          expect((await deliveryRow(out.deliveryId)).status).toBe('OUT_FOR_DELIVERY');
        }
      }
      const any = await readyDelivery(ctx);
      await request(server).post(`/v1/delivery/${any.deliveryId}/fail`).send({ reason: 'Sem token' }).expect(401);
      await request(server).post(`/v1/delivery/${any.deliveryId}/redeliver`).expect(401);
      await request(server).patch(`/v1/delivery/${any.deliveryId}/notes`).send({ notes: 'x' }).expect(401);
    });
  });

  describe('concurrency', () => {
    it('produces a single effective failure when many requests race', async () => {
      const ctx = await setup();
      const { orderId, deliveryId } = await outForDelivery(ctx);
      const results = await Promise.all(
        Array.from({ length: 10 }, () => post(ctx.accessToken, `/v1/delivery/${deliveryId}/fail`, { reason: 'Cliente ausente' })),
      );
      expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
      expect(results.filter((r) => r.body.idempotentReplay === false)).toHaveLength(1);
      expect(await orderStatus(orderId)).toBe('READY');
      expect(await auditCount(ctx, 'DELIVERY_FAILED')).toBe(1);
      const orderLogs = await prisma().auditLog.findMany({ where: { tenantId: ctx.tenantId, action: 'ORDER_STATUS_CHANGED', entityId: orderId } });
      expect(orderLogs.filter((l) => JSON.stringify(l.afterData).includes('"READY"'))).toHaveLength(1);
    });

    it('produces a single effective redelivery request when many requests race', async () => {
      const ctx = await setup();
      const { orderId, deliveryId } = await failedDelivery(ctx);
      const results = await Promise.all(Array.from({ length: 10 }, () => post(ctx.accessToken, `/v1/delivery/${deliveryId}/redeliver`)));
      expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
      expect(results.filter((r) => r.body.idempotentReplay === false)).toHaveLength(1);
      expect(await auditCount(ctx, 'DELIVERY_REDELIVERY_REQUESTED')).toBe(1);
      expect([(await deliveryRow(deliveryId)).status, await orderStatus(orderId)]).toEqual(['PENDING', 'READY']);
    });

    it('produces a single effective observation change when many identical requests race', async () => {
      const ctx = await setup();
      const { deliveryId } = await readyDelivery(ctx);
      const results = await Promise.all(
        Array.from({ length: 10 }, () => patch(ctx.accessToken, `/v1/delivery/${deliveryId}/notes`, { notes: 'Interfone 204' })),
      );
      expect(results.map((r) => r.status)).toEqual(Array(10).fill(200));
      expect(results.filter((r) => r.body.idempotentReplay === false)).toHaveLength(1);
      expect(await auditCount(ctx, 'DELIVERY_NOTES_UPDATED')).toBe(1);
    });

    it('serializes a failure racing with a completion: exactly one of them wins and order and delivery agree', async () => {
      const ctx = await setup();
      const { orderId, deliveryId } = await outForDelivery(ctx);
      const results = await Promise.all([
        ...Array.from({ length: 5 }, () => post(ctx.accessToken, `/v1/delivery/${deliveryId}/complete`)),
        ...Array.from({ length: 5 }, () => post(ctx.accessToken, `/v1/delivery/${deliveryId}/fail`, { reason: 'Cliente ausente' })),
      ]);
      expect(results.every((r) => [200, 409].includes(r.status))).toBe(true);

      const delivery = await deliveryRow(deliveryId);
      expect(['DELIVERED', 'FAILED']).toContain(delivery.status);
      expect(await orderStatus(orderId)).toBe(delivery.status === 'DELIVERED' ? 'DELIVERED' : 'READY');
      expect(await auditCount(ctx, 'DELIVERY_COMPLETED')).toBe(delivery.status === 'DELIVERED' ? 1 : 0);
      expect(await auditCount(ctx, 'DELIVERY_FAILED')).toBe(delivery.status === 'FAILED' ? 1 : 0);
    });
  });

  describe('audit is part of the transaction', () => {
    // A real trigger makes the audit INSERT fail for one tenant+action, so the rollback
    // is proven without mocking any service.
    const failAudit = async (tenantId: string, action: string) => {
      await prisma().$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION fail_audit_delivery_ops_test() RETURNS trigger LANGUAGE plpgsql AS $fn$
         BEGIN
           IF NEW."tenantId" = '${tenantId}' AND NEW."action" = '${action}' THEN
             RAISE EXCEPTION 'audit failure injected by test';
           END IF;
           RETURN NEW;
         END $fn$`,
      );
      await prisma().$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_audit_delivery_ops_test ON audit_logs`);
      await prisma().$executeRawUnsafe(
        `CREATE TRIGGER fail_audit_delivery_ops_test BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_audit_delivery_ops_test()`,
      );
    };
    const restoreAudit = async () => {
      await prisma().$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_audit_delivery_ops_test ON audit_logs`);
      await prisma().$executeRawUnsafe(`DROP FUNCTION IF EXISTS fail_audit_delivery_ops_test()`);
    };
    afterEach(restoreAudit);

    it('rolls back a failure (delivery and order) when its audit cannot be written', async () => {
      const ctx = await setup();
      const { orderId, deliveryId } = await outForDelivery(ctx);
      await failAudit(ctx.tenantId, 'DELIVERY_FAILED');
      await post(ctx.accessToken, `/v1/delivery/${deliveryId}/fail`, { reason: 'Cliente ausente' }).expect(500);
      const row = await deliveryRow(deliveryId);
      expect([row.status, row.failureReason, row.failedAt]).toEqual(['OUT_FOR_DELIVERY', null, null]);
      expect(await orderStatus(orderId)).toBe('OUT_FOR_DELIVERY');
      await restoreAudit();
      await post(ctx.accessToken, `/v1/delivery/${deliveryId}/fail`, { reason: 'Cliente ausente' }).expect(200);
    });

    it('rolls back a redelivery request when its audit cannot be written', async () => {
      const ctx = await setup();
      const { deliveryId } = await failedDelivery(ctx);
      await failAudit(ctx.tenantId, 'DELIVERY_REDELIVERY_REQUESTED');
      await post(ctx.accessToken, `/v1/delivery/${deliveryId}/redeliver`).expect(500);
      const row = await deliveryRow(deliveryId);
      expect([row.status, row.failureReason]).toEqual(['FAILED', 'Cliente ausente']);
    });

    it('rolls back an observation change when its audit cannot be written', async () => {
      const ctx = await setup();
      const { deliveryId } = await readyDelivery(ctx, { deliveryNotes: 'Original' });
      await failAudit(ctx.tenantId, 'DELIVERY_NOTES_UPDATED');
      await patch(ctx.accessToken, `/v1/delivery/${deliveryId}/notes`, { notes: 'Alterada' }).expect(500);
      expect((await deliveryRow(deliveryId)).notes).toBe('Original');
    });

    it('rolls back the cancellation of a failed delivery when its audit cannot be written', async () => {
      const ctx = await setup();
      const { orderId, deliveryId } = await failedDelivery(ctx);
      await failAudit(ctx.tenantId, 'DELIVERY_CANCELLED');
      await patch(ctx.accessToken, `/v1/orders/${orderId}/status`, { status: 'CANCELLED' }).expect(500);
      expect(await orderStatus(orderId)).toBe('READY');
      expect((await deliveryRow(deliveryId)).status).toBe('FAILED');
    });
  });
});
