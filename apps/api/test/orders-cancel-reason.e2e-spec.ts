import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createActiveProductE2E, createTestApp, getPrisma, registerTenantE2E } from './test-app.util';

// B5 (piloto 2026-10-23): cancelling an order needs a reason, enforced by the API, recorded in the
// audit log with the cancellation; everything else a cancellation does stays as it was.
describe('Order cancellation with a reason (e2e)', () => {
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
  const prisma = () => getPrisma(app);

  async function setup() {
    const tenant = await registerTenantE2E(server);
    const t = tenant.accessToken;
    const burger = await createActiveProductE2E(server, t, 'X-Burger', 25);
    const bread = await request(server).post('/v1/inventory/items').set(auth(t)).send({ name: 'Pão', unit: 'UNIT' }).expect(201);
    await request(server)
      .put(`/v1/inventory/recipes/${burger.id}`)
      .set(auth(t))
      .send({ items: [{ inventoryItemId: bread.body.id, quantity: 1 }] })
      .expect(200);
    await request(server)
      .post('/v1/inventory/movements')
      .set(auth(t))
      .send({ branchId: tenant.branchId, inventoryItemId: bread.body.id, type: 'ENTRY', quantity: 10, unitCostCents: 100 })
      .expect(201);
    const session = await request(server).post('/v1/cash/sessions').set(auth(t)).send({ branchId: tenant.branchId, openingBalanceCents: 10000 }).expect(201);
    return { ...tenant, burger, breadId: bread.body.id as string, sessionId: session.body.id as string };
  }

  const sell = (ctx: { accessToken: string; branchId: string }, body: Record<string, unknown>) =>
    request(server).post('/v1/pos/orders').set(auth(ctx.accessToken)).send({ branchId: ctx.branchId, ...body }).expect(201);
  const patchStatus = (token: string, id: string, body: Record<string, unknown>) =>
    request(server).patch(`/v1/orders/${id}/status`).set(auth(token)).send(body);
  const statusOf = async (id: string) => (await prisma().order.findUniqueOrThrow({ where: { id } })).status;
  const cancelAudits = (orderId: string) => prisma().auditLog.findMany({ where: { action: 'ORDER_CANCELLED', entityId: orderId } });
  const breadBalance = async (ctx: { branchId: string; breadId: string }) =>
    Number((await prisma().inventoryBalance.findFirstOrThrow({ where: { branchId: ctx.branchId, inventoryItemId: ctx.breadId } })).quantity);

  it('refuses a cancellation without a valid reason, and the order stays as it was', async () => {
    const ctx = await setup();
    const sale = await sell(ctx, { items: [{ productId: ctx.burger.id, quantity: 1 }], paymentMethod: 'PIX' });
    for (const body of [
      { status: 'CANCELLED' },
      { status: 'CANCELLED', reason: '' },
      { status: 'CANCELLED', reason: '      ' },
      { status: 'CANCELLED', reason: ' ab ' },
      { status: 'CANCELLED', reason: 'x'.repeat(301) },
      { status: 'CANCELLED', reason: 123 },
    ]) {
      const res = await patchStatus(ctx.accessToken, sale.body.id, body).expect(400);
      expect(JSON.stringify(res.body.message)).toContain('motivo do cancelamento');
    }
    expect(await statusOf(sale.body.id)).toBe('PENDING');
    expect(await cancelAudits(sale.body.id)).toHaveLength(0);
  });

  it('cancels with a reason and records who, which order, when and why in the audit log', async () => {
    const ctx = await setup();
    const sale = await sell(ctx, { items: [{ productId: ctx.burger.id, quantity: 1 }], paymentMethod: 'PIX' });
    await patchStatus(ctx.accessToken, sale.body.id, { status: 'CANCELLED', reason: '  Cliente desistiu do pedido  ' }).expect(200);
    expect(await statusOf(sale.body.id)).toBe('CANCELLED');
    const [log] = await cancelAudits(sale.body.id);
    const owner = await prisma().user.findFirstOrThrow({ where: { tenantId: ctx.tenantId } });
    expect(log).toMatchObject({ tenantId: ctx.tenantId, userId: owner.id, entity: 'Order', entityId: sale.body.id });
    expect(log.createdAt).toBeInstanceOf(Date);
    expect(log.afterData).toMatchObject({ status: 'CANCELLED', reason: 'Cliente desistiu do pedido', orderNumber: sale.body.orderNumber });
    expect(log.beforeData).toMatchObject({ status: 'PENDING' });
  });

  it('a 300-character reason is accepted, and other statuses need no reason', async () => {
    const ctx = await setup();
    const sale = await sell(ctx, { items: [{ productId: ctx.burger.id, quantity: 1 }], paymentMethod: 'PIX' });
    await patchStatus(ctx.accessToken, sale.body.id, { status: 'CONFIRMED' }).expect(200);
    await patchStatus(ctx.accessToken, sale.body.id, { status: 'CANCELLED', reason: 'm'.repeat(300) }).expect(200);
  });

  it('keeps giving the cash back through the drawer and the stock back to the balance', async () => {
    const ctx = await setup();
    const sale = await sell(ctx, { items: [{ productId: ctx.burger.id, quantity: 2 }], paymentMethod: 'CASH' });
    await patchStatus(ctx.accessToken, sale.body.id, { status: 'CONFIRMED' }).expect(200);
    expect(await breadBalance(ctx)).toBe(8);
    await patchStatus(ctx.accessToken, sale.body.id, { status: 'CANCELLED', reason: 'Lançado em duplicidade' }).expect(200);
    expect(await breadBalance(ctx)).toBe(10);
    const s = (await request(server).get(`/v1/cash/sessions/${ctx.sessionId}`).set(auth(ctx.accessToken)).expect(200)).body;
    expect(s.totals).toMatchObject({ salesCents: 5000, saleRefundsCents: 5000 });
    expect(s.expectedBalanceCents).toBe(10000);
  });

  it('keeps returning cashback and cancelling the fiado debt', async () => {
    const ctx = await setup();
    const t = ctx.accessToken;
    const customer = await request(server).post('/v1/customers').set(auth(t)).send({ name: 'Cliente Cancelamento', phone: '11988887777' }).expect(201);
    await request(server).put('/v1/cashback/program').set(auth(t)).send({ enabled: true, earnRateBps: 500, expireAfterDays: null }).expect(200);
    await request(server)
      .post(`/v1/cashback/customers/${customer.body.id}/adjust`)
      .set(auth(t))
      .send({ amountCents: 1000, reason: 'Saldo de teste', idempotencyKey: `adj-${customer.body.id}` })
      .expect(200);
    await request(server).put(`/v1/receivables/customers/${customer.body.id}/limit`).set(auth(t)).send({ creditLimitCents: 10000 }).expect(200);

    const cashbackSale = await sell(ctx, {
      items: [{ productId: ctx.burger.id, quantity: 1 }],
      paymentMethod: 'PIX',
      customerId: customer.body.id,
      cashbackToUseCents: 1000,
    });
    const fiadoSale = await sell(ctx, { items: [{ productId: ctx.burger.id, quantity: 1 }], paymentMethod: 'ON_ACCOUNT', customerId: customer.body.id });
    const balance = async () => (await request(server).get(`/v1/cashback/customers/${customer.body.id}`).set(auth(t)).expect(200)).body.balanceCents;
    expect(await balance()).toBe(0);

    await patchStatus(t, cashbackSale.body.id, { status: 'CANCELLED', reason: 'Cliente desistiu' }).expect(200);
    expect(await balance()).toBe(1000);

    await patchStatus(t, fiadoSale.body.id, { status: 'CANCELLED', reason: 'Venda fiado lançada errada' }).expect(200);
    const receivable = await prisma().receivable.findFirstOrThrow({ where: { orderId: fiadoSale.body.id } });
    expect(receivable.status).toBe('CANCELLED');
  });

  it('never cancels twice: a repeat is refused, and two at the same time leave one cancellation, one refund and one record', async () => {
    const ctx = await setup();
    const a = await sell(ctx, { items: [{ productId: ctx.burger.id, quantity: 1 }], paymentMethod: 'PIX' });
    await patchStatus(ctx.accessToken, a.body.id, { status: 'CANCELLED', reason: 'Primeiro cancelamento' }).expect(200);
    await patchStatus(ctx.accessToken, a.body.id, { status: 'CANCELLED', reason: 'Segundo cancelamento' }).expect(409);
    expect(await cancelAudits(a.body.id)).toHaveLength(1);

    const b = await sell(ctx, { items: [{ productId: ctx.burger.id, quantity: 1 }], paymentMethod: 'CASH' });
    const both = await Promise.all([
      patchStatus(ctx.accessToken, b.body.id, { status: 'CANCELLED', reason: 'Clique um' }),
      patchStatus(ctx.accessToken, b.body.id, { status: 'CANCELLED', reason: 'Clique dois' }),
    ]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await cancelAudits(b.body.id)).toHaveLength(1);
    expect(await prisma().cashMovement.count({ where: { refundedOrderId: b.body.id } })).toBe(1);
  });
});
