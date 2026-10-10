import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createActiveProductE2E,
  createTestApp,
  getPrisma,
  injectAuditFailure,
  registerTenantE2E,
  removeAuditFailure,
} from './test-app.util';

type Json = Record<string, unknown>;

// Cancelling a sale that was paid in cash gives the money back from the drawer: a SALE_REFUND
// in the cash session open in the order's branch, in the same transaction as the cancellation.
// No open session, no cancellation.
describe('Cash sale refund on cancellation (e2e)', () => {
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
  afterEach(async () => {
    await removeAuditFailure(app, 'cash_sale_refund_audit_failure');
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) => request(server).get(path).set(auth(token));
  const post = (token: string, path: string, body: Json = {}) => request(server).post(path).set(auth(token)).send(body);
  const patch = (token: string, path: string, body: Json) => request(server).patch(path).set(auth(token)).send(body);
  const prisma = () => getPrisma(app);

  // A restaurant selling one R$ 40,00 product, with no stock control and no customer.
  async function setup() {
    const tenant = await registerTenantE2E(server);
    const product = await createActiveProductE2E(server, tenant.accessToken, 'X-Burger', 40);
    return { ...tenant, product };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const openCash = async (ctx: Ctx, openingBalanceCents = 10_000) =>
    (await post(ctx.accessToken, '/v1/cash/sessions', { branchId: ctx.branchId, openingBalanceCents }).expect(201)).body as { id: string };
  const closeCash = (ctx: Ctx, sessionId: string, countedClosingBalanceCents: number) =>
    patch(ctx.accessToken, `/v1/cash/sessions/${sessionId}/close`, { countedClosingBalanceCents });
  const drawer = async (ctx: Ctx, sessionId: string) => (await get(ctx.accessToken, `/v1/cash/sessions/${sessionId}`).expect(200)).body;
  const sell = async (ctx: Ctx, paymentMethod: string, quantity = 1) =>
    (
      await post(ctx.accessToken, '/v1/pos/orders', {
        branchId: ctx.branchId,
        items: [{ productId: ctx.product.id, quantity }],
        paymentMethod,
      }).expect(201)
    ).body as { id: string; orderNumber: string };
  const cancel = (ctx: Ctx, orderId: string) => patch(ctx.accessToken, `/v1/orders/${orderId}/status`, { status: 'CANCELLED' });
  const orderStatus = async (orderId: string) => (await prisma().order.findUniqueOrThrow({ where: { id: orderId } })).status;
  const refundsOf = (orderId: string) => prisma().cashMovement.findMany({ where: { refundedOrderId: orderId } });

  it('gives the cash back in the open session, so the drawer closes with no difference', async () => {
    const ctx = await setup();
    const session = await openCash(ctx);
    const order = await sell(ctx, 'CASH', 2); // R$ 80,00 in
    expect((await drawer(ctx, session.id)).expectedBalanceCents).toBe(18_000);

    await cancel(ctx, order.id).expect(200);
    expect(await orderStatus(order.id)).toBe('CANCELLED');

    const after = await drawer(ctx, session.id);
    // The sale stays in the history (gross); the refund takes it out of the expected balance.
    expect(after.totals).toMatchObject({ salesCents: 8_000, saleRefundsCents: 8_000 });
    expect(after.expectedBalanceCents).toBe(10_000);
    const movement = after.movements.find((m: { type: string }) => m.type === 'SALE_REFUND');
    expect(movement).toMatchObject({ amountCents: 8_000, orderId: order.id, orderNumber: order.orderNumber });
    expect(movement.reason).toContain(order.orderNumber);

    const rows = await refundsOf(order.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'SALE_REFUND', amountCents: 8_000, sessionId: session.id, orderId: null });
    // The original SALE is untouched: history is appended to, never rewritten.
    expect(await prisma().cashMovement.findUnique({ where: { orderId: order.id } })).toMatchObject({ type: 'SALE', amountCents: 8_000 });

    const audit = await prisma().auditLog.findMany({ where: { tenantId: ctx.tenantId, action: 'CASH_SALE_REFUNDED' } });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ entity: 'CashMovement', entityId: rows[0].id });
    expect(audit[0].afterData).toEqual({ orderId: order.id, sessionId: session.id, type: 'SALE_REFUND', amountCents: 8_000 });

    const closed = (await closeCash(ctx, session.id, 10_000).expect(200)).body;
    expect(closed).toMatchObject({ status: 'CLOSED', expectedBalanceCents: 10_000, differenceCents: 0 });
  });

  it('refuses the cancellation while no cash session is open, then refunds from the one opened next', async () => {
    const ctx = await setup();
    const first = await openCash(ctx);
    const order = await sell(ctx, 'CASH');
    await closeCash(ctx, first.id, 14_000).expect(200);

    const refused = await cancel(ctx, order.id).expect(409);
    expect(refused.body.code).toBe('CASH_REGISTER_NOT_OPEN');
    expect(refused.body.message).toMatch(/caixa/i);
    expect(await orderStatus(order.id)).toBe('PENDING');
    expect(await refundsOf(order.id)).toHaveLength(0);

    // The money leaves the drawer that exists now, not the one that took the sale.
    const second = await openCash(ctx, 5_000);
    await cancel(ctx, order.id).expect(200);
    const now = await drawer(ctx, second.id);
    expect(now.totals).toMatchObject({ salesCents: 0, saleRefundsCents: 4_000 });
    expect(now.expectedBalanceCents).toBe(1_000);
    // The closed session keeps what it was closed with.
    expect(await drawer(ctx, first.id)).toMatchObject({ status: 'CLOSED', expectedBalanceCents: 14_000, differenceCents: 0 });
    expect((await refundsOf(order.id))[0].sessionId).toBe(second.id);
  });

  it('asks for nothing when no cash entered the drawer: Pix, card and an online order', async () => {
    const ctx = await setup();
    const session = await openCash(ctx);
    const pix = await sell(ctx, 'PIX');
    const card = await sell(ctx, 'CARD');
    await closeCash(ctx, session.id, 10_000).expect(200);
    // Paid in cash on the online menu = to be paid on pickup: nothing was received yet.
    const online = await request(server)
      .post('/v1/public/orders')
      .send({
        restaurantSlug: ctx.slug,
        items: [{ productId: ctx.product.id, quantity: 1 }],
        customer: { name: 'Cliente Online', phone: '11987654321' },
        fulfillmentType: 'PICKUP',
        paymentMethod: 'CASH',
      })
      .expect(201);

    for (const id of [pix.id, card.id, online.body.id as string]) {
      await cancel(ctx, id).expect(200);
      expect(await orderStatus(id)).toBe('CANCELLED');
      expect(await refundsOf(id)).toHaveLength(0);
    }
    expect(await prisma().cashMovement.count({ where: { tenantId: ctx.tenantId, type: 'SALE_REFUND' } })).toBe(0);
  });

  it('refunds a cash sale exactly once under six simultaneous cancellations', async () => {
    const ctx = await setup();
    const session = await openCash(ctx);
    const order = await sell(ctx, 'CASH');

    const results = await Promise.all(Array.from({ length: 6 }, () => cancel(ctx, order.id)));
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(5);
    expect(await refundsOf(order.id)).toHaveLength(1);
    expect((await drawer(ctx, session.id)).expectedBalanceCents).toBe(10_000);

    // And once more, later: already cancelled, nothing moves.
    const again = await cancel(ctx, order.id).expect(409);
    expect(again.body.code).toBe('INVALID_STATUS_TRANSITION');
    expect(await refundsOf(order.id)).toHaveLength(1);
  });

  it('never lands a refund in a session that is being closed', async () => {
    const ctx = await setup();
    for (let round = 0; round < 4; round++) {
      const session = await openCash(ctx);
      const order = await sell(ctx, 'CASH');
      // Counted as if the sale had been given back: right only if the refund got in first.
      const [cancelled, closed] = await Promise.all([cancel(ctx, order.id), closeCash(ctx, session.id, 10_000)]);
      expect(closed.status).toBe(200);
      const refunds = await refundsOf(order.id);
      if (cancelled.status === 200) {
        // The refund got in before the close: the closing balance already counts it.
        expect(refunds).toHaveLength(1);
        expect(closed.body).toMatchObject({ expectedBalanceCents: 10_000, differenceCents: 0 });
      } else {
        // The close got in first: the cancellation found no open drawer and changed nothing.
        expect(cancelled.status).toBe(409);
        expect(cancelled.body.code).toBe('CASH_REGISTER_NOT_OPEN');
        expect(refunds).toHaveLength(0);
        expect(await orderStatus(order.id)).toBe('PENDING');
        expect(closed.body).toMatchObject({ expectedBalanceCents: 14_000, differenceCents: -4_000 });
      }
      const frozen = await drawer(ctx, session.id);
      expect(frozen.totals.saleRefundsCents).toBe(cancelled.status === 200 ? 4_000 : 0);
    }
  });

  it('cancels nothing when the refund cannot be audited', async () => {
    const ctx = await setup();
    const session = await openCash(ctx);
    const order = await sell(ctx, 'CASH');
    await injectAuditFailure(app, 'cash_sale_refund_audit_failure', ctx.tenantId, 'CASH_SALE_REFUNDED');

    await cancel(ctx, order.id).expect(500);
    expect(await orderStatus(order.id)).toBe('PENDING');
    expect(await refundsOf(order.id)).toHaveLength(0);
    expect((await drawer(ctx, session.id)).expectedBalanceCents).toBe(14_000);

    await removeAuditFailure(app, 'cash_sale_refund_audit_failure');
    await cancel(ctx, order.id).expect(200);
    expect(await refundsOf(order.id)).toHaveLength(1);
    expect((await drawer(ctx, session.id)).expectedBalanceCents).toBe(10_000);
  });

  it('keeps the database rules: one refund per order, and a refund always names its order', async () => {
    const ctx = await setup();
    const session = await openCash(ctx);
    const order = await sell(ctx, 'CASH');
    await cancel(ctx, order.id).expect(200);
    const userId = (await prisma().user.findFirstOrThrow({ where: { tenantId: ctx.tenantId } })).id;
    const base = { sessionId: session.id, tenantId: ctx.tenantId, amountCents: 100, createdByUserId: userId };

    await expect(
      prisma().cashMovement.create({ data: { ...base, type: 'SALE_REFUND', refundedOrderId: order.id } }),
    ).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma().cashMovement.create({ data: { ...base, type: 'SALE_REFUND' } })).rejects.toThrow(
      /cash_movements_refund_names_order/,
    );
    await expect(
      prisma().cashMovement.create({ data: { ...base, type: 'WITHDRAWAL', refundedOrderId: order.id } }),
    ).rejects.toThrow();
  });

  it('shows the refund in the cash report, apart from the sales', async () => {
    const ctx = await setup();
    const session = await openCash(ctx);
    const kept = await sell(ctx, 'CASH');
    const gone = await sell(ctx, 'CASH');
    await cancel(ctx, gone.id).expect(200);

    const cash = (await get(ctx.accessToken, '/v1/reports/cash').expect(200)).body;
    expect(cash.totals).toMatchObject({ salesCents: 8_000, saleRefundsCents: 4_000 });
    expect(cash.data[0]).toMatchObject({ id: session.id, expectedBalanceCents: 14_000 });
    expect(cash.data[0].totals).toMatchObject({ salesCents: 8_000, saleRefundsCents: 4_000 });
    // The sales report counts only what was not cancelled: cash sold = cash sales - refunds.
    const sales = (await get(ctx.accessToken, '/v1/reports/sales').expect(200)).body;
    const cashSold = sales.byPaymentMethod.find((row: { key: string }) => row.key === 'CASH');
    expect(cashSold.totalCents).toBe(cash.totals.salesCents - cash.totals.saleRefundsCents);
    expect(kept.id).not.toBe(gone.id);
  });
});
