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

// Delivery, slice 3: courier assignment and the operational history. Own file = own
// rate-limit window; the concurrency races live in delivery-couriers-races.e2e-spec.ts.
describe('Delivery couriers (e2e)', () => {
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
  const del = (token: string, path: string) => request(server).delete(path).set(auth(token));
  const prisma = () => getPrisma(app);

  async function setup() {
    const tenant = await registerTenantE2E(server);
    const product = await createActiveProductE2E(server, tenant.accessToken, `Burger ${uniqueSuffix()}`, 25);
    return { ...tenant, product };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  // User + token; the id comes from the JWT subject.
  async function staff(ctx: Ctx, role: RoleName, branchIds: string[] = [ctx.branchId]) {
    const token = await createStaffAndLoginE2E(app, server, ctx.tenantId, role, branchIds);
    const id = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()).sub as string;
    return { token, id };
  }

  const address = {
    street: 'Rua das Flores',
    number: '120',
    complement: 'Ap 4',
    neighborhood: 'Centro',
    city: 'São Paulo',
    state: 'SP',
    zipCode: '01310-100',
  };

  async function readyDelivery(ctx: Ctx) {
    const order = (
      await request(server)
        .post('/v1/public/orders')
        .send({
          restaurantSlug: ctx.slug,
          items: [{ productId: ctx.product.id, quantity: 1 }],
          customer: { name: 'Maria Cliente', phone: '11987654321' },
          fulfillmentType: 'DELIVERY',
          address,
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
  const url = (id: string) => `/v1/delivery/${id}/courier`;

  describe('assign / reassign / remove', () => {
    it('assigns, reassigns and removes a courier with atomic audit and idempotent replays', async () => {
      const ctx = await setup();
      const { deliveryId } = await readyDelivery(ctx);
      const c1 = await staff(ctx, RoleName.DELIVERY);
      const c2 = await staff(ctx, RoleName.DELIVERY);

      const a = await put(ctx.accessToken, url(deliveryId), { courierUserId: c1.id }).expect(200);
      expect(a.body).toMatchObject({ courier: { id: c1.id }, idempotentReplay: false, canAssign: true });
      expect(a.body.assignedAt).not.toBeNull();
      expect(await audits(ctx, 'DELIVERY_ASSIGNED')).toBe(1);

      const replay = await put(ctx.accessToken, url(deliveryId), { courierUserId: c1.id }).expect(200);
      expect(replay.body.idempotentReplay).toBe(true);
      expect(await audits(ctx, 'DELIVERY_ASSIGNED')).toBe(1);

      const r = await put(ctx.accessToken, url(deliveryId), { courierUserId: c2.id }).expect(200);
      expect(r.body.courier.id).toBe(c2.id);
      const log = await prisma().auditLog.findFirstOrThrow({ where: { tenantId: ctx.tenantId, action: 'DELIVERY_REASSIGNED' } });
      expect(log.beforeData).toEqual({ courierUserId: c1.id });
      expect(log.afterData).toMatchObject({ courierUserId: c2.id, previousCourierUserId: c1.id, branchId: ctx.branchId });

      const removed = await del(ctx.accessToken, url(deliveryId)).expect(200);
      expect(removed.body).toMatchObject({ courier: null, assignedAt: null, idempotentReplay: false });
      const again = await del(ctx.accessToken, url(deliveryId)).expect(200);
      expect(again.body.idempotentReplay).toBe(true);
      expect(await audits(ctx, 'DELIVERY_UNASSIGNED')).toBe(1);
      expect((await row(deliveryId)).courierUserId).toBeNull();
    });

    it('validates the body and ignores tenant/branch smuggled by the client', async () => {
      const ctx = await setup();
      const { deliveryId } = await readyDelivery(ctx);
      await put(ctx.accessToken, url(deliveryId), {}).expect(400);
      await put(ctx.accessToken, url(deliveryId), { courierUserId: 'nope' }).expect(400);
      await put(ctx.accessToken, url(deliveryId), { courierUserId: 42 }).expect(400);
      const c = await staff(ctx, RoleName.DELIVERY);
      const res = await put(ctx.accessToken, url(deliveryId), { courierUserId: c.id, tenantId: 'x', branchId: 'y' });
      expect(res.status).toBe(400); // forbidNonWhitelisted
      expect((await row(deliveryId)).courierUserId).toBeNull();
    });

    it('rejects ineligible couriers with a reason and changes nothing', async () => {
      const ctx = await setup();
      const { deliveryId } = await readyDelivery(ctx);
      const branch2 = await prisma().branch.create({ data: { tenantId: ctx.tenantId, name: 'F2', code: 'F2', status: 'ACTIVE' } });

      const inactive = await staff(ctx, RoleName.DELIVERY);
      await prisma().user.update({ where: { id: inactive.id }, data: { status: 'INACTIVE' } });
      const waiter = await staff(ctx, RoleName.WAITER);
      const otherBranch = await staff(ctx, RoleName.DELIVERY, [branch2.id]);

      const cases: [string, string][] = [
        [inactive.id, 'INACTIVE'],
        [waiter.id, 'NOT_COURIER'],
        [otherBranch.id, 'NO_BRANCH_ACCESS'],
      ];
      for (const [courierUserId, reason] of cases) {
        const res = await put(ctx.accessToken, url(deliveryId), { courierUserId }).expect(409);
        expect(res.body.code).toBe('COURIER_NOT_ELIGIBLE');
        expect(res.body.details).toEqual({ reason });
      }
      expect((await row(deliveryId)).courierUserId).toBeNull();
      expect(await audits(ctx, 'DELIVERY_ASSIGNED')).toBe(0);
    });

    it('treats a user of another tenant (or a random id) as not found', async () => {
      const ctx = await setup();
      const other = await setup();
      const foreign = await staff(other, RoleName.DELIVERY);
      const { deliveryId } = await readyDelivery(ctx);
      for (const id of [foreign.id, '11111111-1111-4111-8111-111111111111']) {
        const res = await put(ctx.accessToken, url(deliveryId), { courierUserId: id }).expect(404);
        expect(res.body.code).toBe('COURIER_NOT_FOUND');
      }
    });

    it('accepts a tenant-wide ADMIN holding the DELIVERY role without a branch link', async () => {
      const ctx = await setup();
      const { deliveryId } = await readyDelivery(ctx);
      const admin = await staff(ctx, RoleName.ADMIN, []);
      const dRole = await prisma().role.findUniqueOrThrow({ where: { name: 'DELIVERY' } });
      await prisma().userRole.create({ data: { userId: admin.id, roleId: dRole.id, tenantId: ctx.tenantId } });
      await put(ctx.accessToken, url(deliveryId), { courierUserId: admin.id }).expect(200);
    });

    it('is tenant/branch scoped: other tenants and unlinked managers get 404', async () => {
      const ctx = await setup();
      const other = await setup();
      const { deliveryId } = await readyDelivery(ctx);
      const c = await staff(ctx, RoleName.DELIVERY);
      await put(other.accessToken, url(deliveryId), { courierUserId: c.id }).expect(404);
      await del(other.accessToken, url(deliveryId)).expect(404);
      await get(other.accessToken, `/v1/delivery/${deliveryId}/history`).expect(404);

      const branch2 = await prisma().branch.create({ data: { tenantId: ctx.tenantId, name: 'F2', code: 'F3', status: 'ACTIVE' } });
      const manager2 = await staff(ctx, RoleName.MANAGER, [branch2.id]);
      await put(manager2.token, url(deliveryId), { courierUserId: c.id }).expect(404);
      await get(manager2.token, `/v1/delivery/${deliveryId}/history`).expect(404);
      const crossBranch = await get(manager2.token, `/v1/delivery/couriers?branchId=${ctx.branchId}`);
      expect([403, 404]).toContain(crossBranch.status);
    });
  });

  describe('lifecycle integration', () => {
    it('keeps the courier across dispatch, failure, redelivery and completion, then locks it', async () => {
      const ctx = await setup();
      const { deliveryId } = await readyDelivery(ctx);
      const c = await staff(ctx, RoleName.DELIVERY);
      await put(ctx.accessToken, url(deliveryId), { courierUserId: c.id }).expect(200);

      await post(c.token, `/v1/delivery/${deliveryId}/dispatch`).expect(200);
      // assignment may change while out for delivery
      const c2 = await staff(ctx, RoleName.DELIVERY);
      await put(ctx.accessToken, url(deliveryId), { courierUserId: c2.id }).expect(200);
      const failed = await post(c2.token, `/v1/delivery/${deliveryId}/fail`, { reason: 'Cliente ausente' }).expect(200);
      expect(failed.body.courier.id).toBe(c2.id);
      const redo = await post(ctx.accessToken, `/v1/delivery/${deliveryId}/redeliver`).expect(200);
      expect(redo.body.courier.id).toBe(c2.id);
      await post(c2.token, `/v1/delivery/${deliveryId}/dispatch`).expect(200);
      const done = await post(c2.token, `/v1/delivery/${deliveryId}/complete`).expect(200);
      expect(done.body).toMatchObject({ status: 'DELIVERED', canAssign: false, courier: { id: c2.id } });

      for (const res of [
        await put(ctx.accessToken, url(deliveryId), { courierUserId: c.id }).expect(409),
        await del(ctx.accessToken, url(deliveryId)).expect(409),
      ]) {
        expect(res.body.code).toBe('DELIVERY_ASSIGNMENT_LOCKED');
      }
      // same courier on a finished delivery is still a harmless replay
      await put(ctx.accessToken, url(deliveryId), { courierUserId: c2.id }).expect(200);

      const audit = await prisma().auditLog.findFirstOrThrow({ where: { tenantId: ctx.tenantId, action: 'DELIVERY_COMPLETED' } });
      expect(audit.afterData).toMatchObject({ courierUserId: c2.id });
    });

    it('locks the courier of a cancelled delivery and keeps it in the history', async () => {
      const ctx = await setup();
      const { deliveryId, orderId } = await readyDelivery(ctx);
      const c = await staff(ctx, RoleName.DELIVERY);
      await put(ctx.accessToken, url(deliveryId), { courierUserId: c.id }).expect(200);
      // a still-PENDING order is the plain cancellation path (READY ones need a failed delivery)
      await prisma().order.update({ where: { id: orderId }, data: { status: 'PENDING' } });
      await request(server)
        .patch(`/v1/orders/${orderId}/status`)
        .set(auth(ctx.accessToken))
        .send({ status: 'CANCELLED' })
        .expect(200);
      expect((await row(deliveryId)).courierUserId).toBe(c.id);
      const res = await del(ctx.accessToken, url(deliveryId)).expect(409);
      expect(res.body.code).toBe('DELIVERY_ASSIGNMENT_LOCKED');

      const hist = await get(ctx.accessToken, `/v1/delivery/${deliveryId}/history`).expect(200);
      expect(hist.body.data.map((e: { kind: string }) => e.kind)).toEqual(['CREATED', 'ASSIGNED', 'CANCELLED']);
    });
  });

  describe('history', () => {
    it('rebuilds the attempts from the audit log, with names, reasons and couriers', async () => {
      const ctx = await setup();
      const { deliveryId } = await readyDelivery(ctx);
      const c1 = await staff(ctx, RoleName.DELIVERY);
      const c2 = await staff(ctx, RoleName.DELIVERY);

      await put(ctx.accessToken, url(deliveryId), { courierUserId: c1.id }).expect(200);
      await post(c1.token, `/v1/delivery/${deliveryId}/dispatch`).expect(200);
      await post(c1.token, `/v1/delivery/${deliveryId}/fail`, { reason: 'Cliente ausente' }).expect(200);
      await put(ctx.accessToken, url(deliveryId), { courierUserId: c2.id }).expect(200);
      await post(ctx.accessToken, `/v1/delivery/${deliveryId}/redeliver`).expect(200);
      await post(c2.token, `/v1/delivery/${deliveryId}/dispatch`).expect(200);
      await post(c2.token, `/v1/delivery/${deliveryId}/complete`).expect(200);

      const hist = (await get(ctx.accessToken, `/v1/delivery/${deliveryId}/history`).expect(200)).body.data as Array<{
        kind: string;
        attempt: number | null;
        reason: string | null;
        courier: { id: string; name: string } | null;
        previousCourier: { id: string } | null;
        actor: { id: string; name: string } | null;
      }>;
      expect(hist.map((e) => [e.kind, e.attempt])).toEqual([
        ['CREATED', null],
        ['ASSIGNED', null],
        ['DISPATCHED', 1],
        ['FAILED', 1],
        ['REASSIGNED', null],
        ['REDELIVERY_REQUESTED', 1],
        ['DISPATCHED', 2],
        ['COMPLETED', 2],
      ]);
      expect(hist[3].reason).toBe('Cliente ausente');
      expect(hist[4]).toMatchObject({ courier: { id: c2.id }, previousCourier: { id: c1.id } });
      expect(hist[1].courier?.name).toBe('Staff DELIVERY');
      expect(hist[2].actor?.id).toBe(c1.id);
      expect(hist[0].actor).toBeNull();
    });

    it('is readable by the DELIVERY role and other tenants never see it', async () => {
      const ctx = await setup();
      const { deliveryId } = await readyDelivery(ctx);
      const c = await staff(ctx, RoleName.DELIVERY);
      await get(c.token, `/v1/delivery/${deliveryId}/history`).expect(200);
      await get(ctx.accessToken, '/v1/delivery/not-a-uuid/history').expect(400);
    });
  });

  describe('listing and filters', () => {
    it('filters by me / none / courier id, scopes the summary and lists eligible couriers', async () => {
      const ctx = await setup();
      const d1 = await readyDelivery(ctx);
      await readyDelivery(ctx);
      const d3 = await readyDelivery(ctx);
      const c1 = await staff(ctx, RoleName.DELIVERY);
      const c2 = await staff(ctx, RoleName.DELIVERY);
      await put(ctx.accessToken, url(d1.deliveryId), { courierUserId: c1.id }).expect(200);
      await put(ctx.accessToken, url(d3.deliveryId), { courierUserId: c2.id }).expect(200);

      const list = (token: string, q: string) => get(token, `/v1/delivery?branchId=${ctx.branchId}&${q}`).expect(200);
      const mine = await list(c1.token, 'courier=me');
      expect(mine.body.data.map((d: { id: string }) => d.id)).toEqual([d1.deliveryId]);
      expect(mine.body.summary.PENDING).toBe(1);
      expect(mine.body.data[0].courier).toEqual({ id: c1.id, name: 'Staff DELIVERY' });

      const none = await list(ctx.accessToken, 'courier=none');
      expect(none.body.meta.total).toBe(1);
      const byId = await list(ctx.accessToken, `courier=${c2.id}`);
      expect(byId.body.data.map((d: { id: string }) => d.id)).toEqual([d3.deliveryId]);
      await get(ctx.accessToken, `/v1/delivery?branchId=${ctx.branchId}&courier=bogus`).expect(400);
      expect((await list(ctx.accessToken, '')).body.meta.total).toBe(3);

      const other = await setup();
      const foreign = await get(other.accessToken, `/v1/delivery?branchId=${ctx.branchId}&courier=${c2.id}`);
      expect([403, 404]).toContain(foreign.status); // another tenant cannot even use this branch id

      const couriers = await get(ctx.accessToken, `/v1/delivery/couriers?branchId=${ctx.branchId}`).expect(200);
      expect(couriers.body.data.map((u: { id: string }) => u.id).sort()).toEqual([c1.id, c2.id].sort());
      await prisma().user.update({ where: { id: c2.id }, data: { status: 'INACTIVE' } });
      const after = await get(ctx.accessToken, `/v1/delivery/couriers?branchId=${ctx.branchId}`).expect(200);
      expect(after.body.data.map((u: { id: string }) => u.id)).toEqual([c1.id]);
    });
  });

  describe('permission matrix', () => {
    it('only OWNER, ADMIN and MANAGER may assign; everyone with delivery.read may read history', async () => {
      const ctx = await setup();
      const { deliveryId } = await readyDelivery(ctx);
      const target = await staff(ctx, RoleName.DELIVERY);
      const expected: [RoleName, boolean, boolean][] = [
        [RoleName.ADMIN, true, true],
        [RoleName.MANAGER, true, true],
        [RoleName.DELIVERY, false, true],
        [RoleName.CASHIER, false, false],
        [RoleName.WAITER, false, false],
        [RoleName.KITCHEN, false, false],
        [RoleName.VIEWER, false, false],
      ];
      for (const [role, canAssign, canRead] of expected) {
        const u = await staff(ctx, role);
        const a = await put(u.token, url(deliveryId), { courierUserId: target.id });
        expect([role, a.status]).toEqual([role, canAssign ? 200 : 403]);
        const r = await del(u.token, url(deliveryId));
        expect([role, r.status]).toEqual([role, canAssign ? 200 : 403]);
        const l = await get(u.token, `/v1/delivery/couriers?branchId=${ctx.branchId}`);
        expect([role, l.status]).toEqual([role, canAssign ? 200 : 403]);
        const h = await get(u.token, `/v1/delivery/${deliveryId}/history`);
        expect([role, h.status]).toEqual([role, canRead ? 200 : 403]);
      }
      await put(ctx.accessToken, url(deliveryId), { courierUserId: target.id }).expect(200);
      await get(ctx.accessToken, `/v1/delivery/couriers?branchId=${ctx.branchId}`).expect(200);
    });

    it('a courier cannot assign another courier or themselves', async () => {
      const ctx = await setup();
      const { deliveryId } = await readyDelivery(ctx);
      const c1 = await staff(ctx, RoleName.DELIVERY);
      const c2 = await staff(ctx, RoleName.DELIVERY);
      await put(c1.token, url(deliveryId), { courierUserId: c2.id }).expect(403);
      await put(c1.token, url(deliveryId), { courierUserId: c1.id }).expect(403);
      expect((await row(deliveryId)).courierUserId).toBeNull();
    });
  });

  describe('audit is part of the transaction', () => {
    const failAudit = async (tenantId: string, action: string) => {
      await prisma().$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION fail_audit_delivery_courier_test() RETURNS trigger LANGUAGE plpgsql AS $fn$
         BEGIN
           IF NEW."tenantId" = '${tenantId}' AND NEW."action" = '${action}' THEN
             RAISE EXCEPTION 'audit failure injected by test';
           END IF;
           RETURN NEW;
         END $fn$`,
      );
      await prisma().$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_audit_delivery_courier_test ON audit_logs`);
      await prisma().$executeRawUnsafe(
        `CREATE TRIGGER fail_audit_delivery_courier_test BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_audit_delivery_courier_test()`,
      );
    };
    const restoreAudit = async () => {
      await prisma().$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_audit_delivery_courier_test ON audit_logs`);
      await prisma().$executeRawUnsafe(`DROP FUNCTION IF EXISTS fail_audit_delivery_courier_test()`);
    };
    afterEach(restoreAudit);

    it.each([
      ['DELIVERY_ASSIGNED', null],
      ['DELIVERY_REASSIGNED', 'first'],
      ['DELIVERY_UNASSIGNED', 'first'],
    ] as const)('rolls back %s when its audit cannot be written', async (action, initial) => {
      const ctx = await setup();
      const { deliveryId } = await readyDelivery(ctx);
      const c1 = await staff(ctx, RoleName.DELIVERY);
      const c2 = await staff(ctx, RoleName.DELIVERY);
      if (initial) await put(ctx.accessToken, url(deliveryId), { courierUserId: c1.id }).expect(200);
      const before = await row(deliveryId);

      await failAudit(ctx.tenantId, action);
      const res =
        action === 'DELIVERY_UNASSIGNED'
          ? await del(ctx.accessToken, url(deliveryId))
          : await put(ctx.accessToken, url(deliveryId), { courierUserId: c2.id });
      expect(res.status).toBe(500);
      const after = await row(deliveryId);
      expect([after.courierUserId, after.assignedAt]).toEqual([before.courierUserId, before.assignedAt]);

      await restoreAudit();
      if (action === 'DELIVERY_UNASSIGNED') await del(ctx.accessToken, url(deliveryId)).expect(200);
      else await put(ctx.accessToken, url(deliveryId), { courierUserId: c2.id }).expect(200);
    });
  });
});
