import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createActiveProductE2E, createTestApp, getPrisma, registerTenantE2E, statusBody } from './test-app.util';

// B3 (piloto 2026-10-23): an online order paid in cash enters the drawer when it is concluded
// (COMPLETED, or DELIVERED by the delivery flow), once, linked to the order.
describe('Online cash orders and the cash drawer (e2e)', () => {
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
  const ADDRESS = { street: 'Rua A', number: '1', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', zipCode: '01001-000' };

  async function setup({ openDrawer = true } = {}) {
    const tenant = await registerTenantE2E(server);
    const burger = await createActiveProductE2E(server, tenant.accessToken, 'X-Burger', 25);
    if (openDrawer) await openSession(tenant.accessToken, tenant.branchId);
    return { ...tenant, burger };
  }

  const openSession = (token: string, branchId: string) =>
    request(server).post('/v1/cash/sessions').set(auth(token)).send({ branchId, openingBalanceCents: 10000 }).expect(201);

  async function session(token: string, branchId: string) {
    return (await request(server).get(`/v1/cash/sessions/current?branchId=${branchId}`).set(auth(token)).expect(200)).body.session;
  }

  async function onlineOrder(slug: string, productId: string, paymentMethod: string, fulfillmentType = 'PICKUP') {
    const res = await request(server)
      .post('/v1/public/orders')
      .send({
        restaurantSlug: slug,
        items: [{ productId, quantity: 2 }],
        customer: { name: 'Cliente Teste', phone: '11987654321' },
        fulfillmentType,
        paymentMethod,
        ...(fulfillmentType === 'DELIVERY' ? { address: ADDRESS } : {}),
      })
      .expect(201);
    return res.body as { id: string };
  }

  const setStatus = (token: string, id: string, status: string) =>
    request(server).patch(`/v1/orders/${id}/status`).set(auth(token)).send(statusBody(status));

  async function toReady(token: string, id: string) {
    for (const status of ['CONFIRMED', 'PREPARING', 'READY']) await setStatus(token, id, status).expect(200);
  }

  const salesOf = (orderId: string) => getPrisma(app).cashMovement.findMany({ where: { orderId } });

  it('a pickup order paid in cash enters the drawer when COMPLETED, not before, linked to the order', async () => {
    const { accessToken, branchId, slug, burger } = await setup();
    const order = await onlineOrder(slug, burger.id, 'CASH');
    await toReady(accessToken, order.id);
    expect((await session(accessToken, branchId)).totals.salesCents).toBe(0);
    expect(await salesOf(order.id)).toHaveLength(0);

    await setStatus(accessToken, order.id, 'COMPLETED').expect(200);
    const after = await session(accessToken, branchId);
    expect(after.totals.salesCents).toBe(5000);
    expect(after.expectedBalanceCents).toBe(15000);
    const [sale] = await salesOf(order.id);
    expect(sale).toMatchObject({ type: 'SALE', amountCents: 5000, sessionId: after.id });
    expect(after.movements.find((m: { orderId: string }) => m.orderId === order.id)).toMatchObject({ type: 'SALE' });
  });

  it('Pix and card orders never create a cash movement', async () => {
    const { accessToken, branchId, slug, burger } = await setup();
    for (const method of ['PIX', 'CARD']) {
      const order = await onlineOrder(slug, burger.id, method);
      await toReady(accessToken, order.id);
      await setStatus(accessToken, order.id, 'COMPLETED').expect(200);
      expect(await salesOf(order.id)).toHaveLength(0);
    }
    expect((await session(accessToken, branchId)).totals.salesCents).toBe(0);
  });

  it('concluding twice, or twice at the same time, writes ONE movement', async () => {
    const { accessToken, branchId, slug, burger } = await setup();
    const a = await onlineOrder(slug, burger.id, 'CASH');
    await toReady(accessToken, a.id);
    await setStatus(accessToken, a.id, 'COMPLETED').expect(200);
    await setStatus(accessToken, a.id, 'COMPLETED').expect(409);
    expect(await salesOf(a.id)).toHaveLength(1);

    const b = await onlineOrder(slug, burger.id, 'CASH');
    await toReady(accessToken, b.id);
    const both = await Promise.all([setStatus(accessToken, b.id, 'COMPLETED'), setStatus(accessToken, b.id, 'COMPLETED')]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await salesOf(b.id)).toHaveLength(1);
    expect((await session(accessToken, branchId)).totals.salesCents).toBe(10000);
  });

  it('a delivery paid in cash enters the drawer when DELIVERED; repeating the confirmation changes nothing', async () => {
    const { accessToken, branchId, slug, burger } = await setup();
    const order = await onlineOrder(slug, burger.id, 'CASH', 'DELIVERY');
    await toReady(accessToken, order.id);
    const detail = (await request(server).get(`/v1/orders/${order.id}`).set(auth(accessToken)).expect(200)).body;
    const deliveryId = detail.delivery.id as string;
    await request(server).post(`/v1/delivery/${deliveryId}/dispatch`).set(auth(accessToken)).send({}).expect(200);
    expect(await salesOf(order.id)).toHaveLength(0);

    await request(server).post(`/v1/delivery/${deliveryId}/complete`).set(auth(accessToken)).send({}).expect(200);
    await request(server).post(`/v1/delivery/${deliveryId}/complete`).set(auth(accessToken)).send({}).expect(200);
    const sales = await salesOf(order.id);
    expect(sales).toHaveLength(1);
    expect(sales[0].amountCents).toBe(Math.round(Number(detail.total) * 100));
    expect((await session(accessToken, branchId)).totals.salesCents).toBe(sales[0].amountCents);
  });

  it('with the drawer closed the conclusion is refused and the order stays READY; it goes through once a drawer is open', async () => {
    const { accessToken, branchId, slug, burger } = await setup({ openDrawer: false });
    const order = await onlineOrder(slug, burger.id, 'CASH');
    await toReady(accessToken, order.id);
    const refused = await setStatus(accessToken, order.id, 'COMPLETED').expect(409);
    expect(refused.body.code).toBe('CASH_REGISTER_NOT_OPEN');
    expect(refused.body.message).toMatch(/Abra o caixa/);
    expect((await request(server).get(`/v1/orders/${order.id}`).set(auth(accessToken)).expect(200)).body.status).toBe('READY');

    await openSession(accessToken, branchId);
    await setStatus(accessToken, order.id, 'COMPLETED').expect(200);
    expect(await salesOf(order.id)).toHaveLength(1);
  });

  it('cancelling an online cash order before it is concluded leaves the drawer untouched', async () => {
    const { accessToken, branchId, slug, burger } = await setup();
    const order = await onlineOrder(slug, burger.id, 'CASH');
    await setStatus(accessToken, order.id, 'CONFIRMED').expect(200);
    await setStatus(accessToken, order.id, 'CANCELLED').expect(200);
    const s = await session(accessToken, branchId);
    expect(s.totals).toMatchObject({ salesCents: 0, saleRefundsCents: 0 });
    expect(s.movements).toHaveLength(0);
  });

  it('a PDV cash sale keeps exactly the one SALE it wrote when it was made, after it is completed', async () => {
    const { accessToken, branchId, burger } = await setup();
    const sale = await request(server)
      .post('/v1/pos/orders')
      .set(auth(accessToken))
      .send({ branchId, items: [{ productId: burger.id, quantity: 1 }], paymentMethod: 'CASH' })
      .expect(201);
    await toReady(accessToken, sale.body.id);
    await setStatus(accessToken, sale.body.id, 'COMPLETED').expect(200);
    expect(await salesOf(sale.body.id)).toHaveLength(1);
    expect((await session(accessToken, branchId)).totals.salesCents).toBe(2500);
  });

  it('closing the drawer counts the online cash that was received', async () => {
    const { accessToken, branchId, slug, burger } = await setup();
    const order = await onlineOrder(slug, burger.id, 'CASH');
    await toReady(accessToken, order.id);
    await setStatus(accessToken, order.id, 'COMPLETED').expect(200);
    const open = await session(accessToken, branchId);
    const closed = await request(server)
      .patch(`/v1/cash/sessions/${open.id}/close`)
      .set(auth(accessToken))
      .send({ countedClosingBalanceCents: 15000 })
      .expect(200);
    expect(closed.body).toMatchObject({ expectedBalanceCents: 15000, differenceCents: 0 });
  });
});
