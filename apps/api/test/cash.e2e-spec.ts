import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createActiveProductE2E,
  createStaffAndLoginE2E,
  createTestApp,
  getPrisma,
  registerTenantE2E,
} from './test-app.util';

// Requires the DB constraints from prisma/sql/cash_register_constraints.sql
// (`pnpm db:constraints` after `pnpm db:migrate`) for the DB-level
// immutability test below.
describe('Cash register (e2e)', () => {
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

  async function setup() {
    const tenant = await registerTenantE2E(server);
    const cashier = await createStaffAndLoginE2E(app, server, tenant.tenantId, 'CASHIER', [tenant.branchId]);
    return { ...tenant, cashier };
  }
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const open = (token: string, branchId: string, openingBalanceCents = 10000) =>
    request(server).post('/v1/cash/sessions').set(auth(token)).send({ branchId, openingBalanceCents });
  const move = (token: string, id: string, body: Record<string, unknown>) =>
    request(server).post(`/v1/cash/sessions/${id}/movements`).set(auth(token)).send(body);
  const close = (token: string, id: string, countedClosingBalanceCents: number) =>
    request(server).patch(`/v1/cash/sessions/${id}/close`).set(auth(token)).send({ countedClosingBalanceCents });
  const sell = (token: string, branchId: string, productId: string, paymentMethod: string, quantity = 1) =>
    request(server)
      .post('/v1/pos/orders')
      .set(auth(token))
      .send({ branchId, items: [{ productId, quantity }], paymentMethod });

  // 1, 3
  it('opens a session with the opening balance', async () => {
    const { cashier, branchId } = await setup();
    const res = await open(cashier, branchId, 12345).expect(201);
    expect(res.body).toMatchObject({ status: 'OPEN', branchId, openingBalanceCents: 12345, expectedBalanceCents: 12345 });
    const current = await request(server).get(`/v1/cash/sessions/current?branchId=${branchId}`).set(auth(cashier)).expect(200);
    expect(current.body.session.id).toBe(res.body.id);
  });

  // 2
  it('blocks a second open session for the same branch', async () => {
    const { cashier, branchId } = await setup();
    await open(cashier, branchId).expect(201);
    const res = await open(cashier, branchId).expect(409);
    expect(res.body.code).toBe('CASH_SESSION_ALREADY_OPEN');
  });

  it('rejects a negative opening balance', async () => {
    const { cashier, branchId } = await setup();
    await open(cashier, branchId, -1).expect(400);
  });

  // 4, 5, 6
  it('records supply and withdrawal; withdrawal requires a reason; amounts must be > 0', async () => {
    const { cashier, branchId } = await setup();
    const session = (await open(cashier, branchId).expect(201)).body;

    await move(cashier, session.id, { type: 'SUPPLY', amountCents: 5000 }).expect(201);
    await move(cashier, session.id, { type: 'WITHDRAWAL', amountCents: 3000 }).expect(400);
    await move(cashier, session.id, { type: 'WITHDRAWAL', amountCents: 3000, reason: 'Pagamento fornecedor' }).expect(201);
    await move(cashier, session.id, { type: 'SUPPLY', amountCents: 0 }).expect(400);
    await move(cashier, session.id, { type: 'SALE', amountCents: 999 }).expect(400); // SALE is backend-only

    const detail = (await request(server).get(`/v1/cash/sessions/${session.id}`).set(auth(cashier)).expect(200)).body;
    expect(detail.totals).toEqual({ salesCents: 0, suppliesCents: 5000, withdrawalsCents: 3000 });
    expect(detail.expectedBalanceCents).toBe(12000);
  });

  // 7, 8, 9
  it('CASH sale generates exactly one SALE movement; PIX and CARD generate none', async () => {
    const { accessToken, cashier, branchId } = await setup();
    const product = await createActiveProductE2E(server, accessToken, 'X-Burger', 24.9);
    const session = (await open(cashier, branchId).expect(201)).body;

    const cashOrder = (await sell(cashier, branchId, product.id, 'CASH', 2).expect(201)).body;
    await sell(cashier, branchId, product.id, 'PIX').expect(201);
    await sell(cashier, branchId, product.id, 'CARD').expect(201);

    const detail = (await request(server).get(`/v1/cash/sessions/${session.id}`).set(auth(cashier)).expect(200)).body;
    const sales = detail.movements.filter((m: { type: string }) => m.type === 'SALE');
    expect(sales).toHaveLength(1);
    expect(sales[0]).toMatchObject({ orderId: cashOrder.id, amountCents: 4980 });
    expect(detail.totals.salesCents).toBe(4980);
  });

  // 10
  it('rejects a CASH sale without an open session and persists nothing', async () => {
    const { accessToken, cashier, branchId, tenantId } = await setup();
    const product = await createActiveProductE2E(server, accessToken, 'Produto', 10);
    const res = await sell(cashier, branchId, product.id, 'CASH').expect(409);
    expect(res.body.code).toBe('CASH_REGISTER_NOT_OPEN');
    const prisma = getPrisma(app);
    expect(await prisma.order.count({ where: { tenantId } })).toBe(0);
    expect(await prisma.cashMovement.count({ where: { tenantId } })).toBe(0);
  });

  // 11, 12, 13
  it('closes with backend-computed expected balance and difference', async () => {
    const { accessToken, cashier, branchId } = await setup();
    const product = await createActiveProductE2E(server, accessToken, 'X-Burger', 24.9);
    const session = (await open(cashier, branchId, 10000).expect(201)).body;
    await move(cashier, session.id, { type: 'SUPPLY', amountCents: 5000 }).expect(201);
    await move(cashier, session.id, { type: 'WITHDRAWAL', amountCents: 3000, reason: 'Troco banco' }).expect(201);
    await sell(cashier, branchId, product.id, 'CASH', 2).expect(201); // 4980

    const closed = (await close(cashier, session.id, 17000).expect(200)).body;
    // 10000 + 5000 + 4980 - 3000 = 16980
    expect(closed).toMatchObject({
      status: 'CLOSED',
      expectedBalanceCents: 16980,
      countedClosingBalanceCents: 17000,
      differenceCents: 20,
    });
  });

  it('MANDATORY: rejects client-supplied expected/difference on close', async () => {
    const { cashier, branchId } = await setup();
    const session = (await open(cashier, branchId).expect(201)).body;
    await request(server)
      .patch(`/v1/cash/sessions/${session.id}/close`)
      .set(auth(cashier))
      .send({ countedClosingBalanceCents: 10000, expectedClosingBalanceCents: 10000, differenceCents: 0 })
      .expect(400);
  });

  // 14, 15
  it('a closed session accepts no movements, cannot be closed/reopened again, and a CASH sale then fails', async () => {
    const { accessToken, cashier, branchId } = await setup();
    const product = await createActiveProductE2E(server, accessToken, 'Produto', 10);
    const session = (await open(cashier, branchId).expect(201)).body;
    await close(cashier, session.id, 10000).expect(200);

    const moveRes = await move(cashier, session.id, { type: 'SUPPLY', amountCents: 100 }).expect(409);
    expect(moveRes.body.code).toBe('CASH_SESSION_CLOSED');
    const closeRes = await close(cashier, session.id, 1).expect(409);
    expect(closeRes.body.code).toBe('CASH_SESSION_ALREADY_CLOSED');
    await sell(cashier, branchId, product.id, 'CASH').expect(409);

    // Opening again creates a NEW session; the old one stays CLOSED forever.
    const next = (await open(cashier, branchId).expect(201)).body;
    expect(next.id).not.toBe(session.id);
    const old = (await request(server).get(`/v1/cash/sessions/${session.id}`).set(auth(cashier)).expect(200)).body;
    expect(old.status).toBe('CLOSED');
    expect(old.expectedBalanceCents).toBe(10000);
  });

  // 16, 17
  it('movements cannot be edited or deleted (no API route; DB trigger blocks direct writes)', async () => {
    const { cashier, branchId } = await setup();
    const session = (await open(cashier, branchId).expect(201)).body;
    const detail = (await move(cashier, session.id, { type: 'SUPPLY', amountCents: 500 }).expect(201)).body;
    const movementId = detail.movements[0].id;

    await request(server).patch(`/v1/cash/sessions/${session.id}/movements/${movementId}`).set(auth(cashier)).send({ amountCents: 1 }).expect(404);
    await request(server).delete(`/v1/cash/sessions/${session.id}/movements/${movementId}`).set(auth(cashier)).expect(404);

    const prisma = getPrisma(app);
    await expect(prisma.cashMovement.update({ where: { id: movementId }, data: { amountCents: 1 } })).rejects.toThrow();
    await expect(prisma.cashMovement.delete({ where: { id: movementId } })).rejects.toThrow();
  });

  // 18
  it('SALE is idempotent per order: a second SALE for the same order is rejected by the DB', async () => {
    const { accessToken, cashier, branchId, tenantId } = await setup();
    const product = await createActiveProductE2E(server, accessToken, 'Produto', 10);
    const session = (await open(cashier, branchId).expect(201)).body;
    const order = (await sell(cashier, branchId, product.id, 'CASH').expect(201)).body;

    const prisma = getPrisma(app);
    const existing = await prisma.cashMovement.findUniqueOrThrow({ where: { orderId: order.id } });
    await expect(
      prisma.cashMovement.create({
        data: {
          sessionId: session.id,
          tenantId,
          type: 'SALE',
          amountCents: 1000,
          orderId: order.id,
          createdByUserId: existing.createdByUserId,
        },
      }),
    ).rejects.toThrow();
    expect(await prisma.cashMovement.count({ where: { orderId: order.id } })).toBe(1);
  });

  // 19
  it("tenant A cannot read, close, move, or open using tenant B's session/branch", async () => {
    const a = await setup();
    const b = await setup();
    const sessionB = (await open(b.cashier, b.branchId).expect(201)).body;

    await request(server).get(`/v1/cash/sessions/${sessionB.id}`).set(auth(a.cashier)).expect(404);
    await close(a.cashier, sessionB.id, 0).expect(404);
    await move(a.cashier, sessionB.id, { type: 'SUPPLY', amountCents: 100 }).expect(404);
    await open(a.cashier, b.branchId).expect(404);
    await open(a.accessToken, b.branchId).expect(404); // even the OWNER of A
  });

  // 20
  it('a CASHIER linked to branch 1 cannot operate or list branch 2 of the same tenant', async () => {
    const { accessToken, cashier, branchId, tenantId } = await setup();
    const branch2 = await getPrisma(app).branch.create({ data: { tenantId, name: 'Filial', code: 'FILIAL' } });
    const session2 = (await open(accessToken, branch2.id).expect(201)).body; // OWNER may

    await open(cashier, branch2.id).expect(403);
    await request(server).get(`/v1/cash/sessions/${session2.id}`).set(auth(cashier)).expect(403);
    await request(server).get(`/v1/cash/sessions/current?branchId=${branch2.id}`).set(auth(cashier)).expect(403);
    await move(cashier, session2.id, { type: 'SUPPLY', amountCents: 100 }).expect(403);

    await open(cashier, branchId).expect(201);
    const list = (await request(server).get('/v1/cash/sessions').set(auth(cashier)).expect(200)).body;
    expect(list.data.map((s: { branchId: string }) => s.branchId)).toEqual([branchId]);
  });

  // 21
  it('RBAC: WAITER cannot open; KITCHEN cannot read', async () => {
    const { tenantId, branchId } = await setup();
    const waiter = await createStaffAndLoginE2E(app, server, tenantId, 'WAITER', [branchId]);
    const kitchen = await createStaffAndLoginE2E(app, server, tenantId, 'KITCHEN', [branchId]);
    await open(waiter, branchId).expect(403);
    await request(server).get(`/v1/cash/sessions/current?branchId=${branchId}`).set(auth(kitchen)).expect(403);
  });

  // 22
  it('concurrent opens for the same branch: exactly one wins', async () => {
    const { cashier, branchId, tenantId } = await setup();
    const results = await Promise.all([open(cashier, branchId), open(cashier, branchId), open(cashier, branchId)]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 409, 409]);
    expect(await getPrisma(app).cashRegisterSession.count({ where: { tenantId, branchId, status: 'OPEN' } })).toBe(1);
  });

  // 23
  it('concurrent closes of the same session: exactly one closes', async () => {
    const { cashier, branchId } = await setup();
    const session = (await open(cashier, branchId).expect(201)).body;
    const results = await Promise.all([close(cashier, session.id, 10000), close(cashier, session.id, 9000)]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const final = await getPrisma(app).cashRegisterSession.findUniqueOrThrow({ where: { id: session.id } });
    const winner = results.find((r) => r.status === 200)!;
    expect(final.countedClosingBalanceCents).toBe(winner.body.countedClosingBalanceCents);
  });

  it('records audit logs for open, movement and close (with computed values)', async () => {
    const { cashier, branchId, tenantId } = await setup();
    const session = (await open(cashier, branchId, 1000).expect(201)).body;
    await move(cashier, session.id, { type: 'SUPPLY', amountCents: 500 }).expect(201);
    await close(cashier, session.id, 1400).expect(200);

    const logs = await getPrisma(app).auditLog.findMany({ where: { tenantId, entity: { in: ['CashRegisterSession', 'CashMovement'] } } });
    const actions = logs.map((l) => l.action).sort();
    expect(actions).toEqual(['CASH_MOVEMENT_CREATED', 'CASH_SESSION_CLOSED', 'CASH_SESSION_OPENED']);
    const closedLog = logs.find((l) => l.action === 'CASH_SESSION_CLOSED')!;
    expect(closedLog.afterData).toMatchObject({ expectedClosingBalanceCents: 1500, countedClosingBalanceCents: 1400, differenceCents: -100 });
  });
});
