import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createActiveProductE2E, createTestApp, getPrisma, registerTenantE2E } from './test-app.util';

// B4 (piloto 2026-10-23): a sangria cannot take out more than the drawer holds, not even when
// two are sent at the same time.
describe('Cash withdrawal limit (e2e)', () => {
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

  async function setup(openingBalanceCents = 10000) {
    const tenant = await registerTenantE2E(server);
    const opened = await request(server)
      .post('/v1/cash/sessions')
      .set(auth(tenant.accessToken))
      .send({ branchId: tenant.branchId, openingBalanceCents })
      .expect(201);
    return { ...tenant, sessionId: opened.body.id as string };
  }

  const move = (token: string, sessionId: string, type: string, amountCents: number, reason = 'Teste do piloto') =>
    request(server).post(`/v1/cash/sessions/${sessionId}/movements`).set(auth(token)).send({ type, amountCents, reason });

  const expected = async (token: string, sessionId: string) =>
    (await request(server).get(`/v1/cash/sessions/${sessionId}`).set(auth(token)).expect(200)).body.expectedBalanceCents as number;

  it('a sangria smaller than the balance goes through', async () => {
    const { accessToken, sessionId } = await setup();
    await move(accessToken, sessionId, 'WITHDRAWAL', 3000).expect(201);
    expect(await expected(accessToken, sessionId)).toBe(7000);
  });

  it('a sangria equal to the balance empties the drawer', async () => {
    const { accessToken, sessionId } = await setup();
    await move(accessToken, sessionId, 'WITHDRAWAL', 10000).expect(201);
    expect(await expected(accessToken, sessionId)).toBe(0);
    // ...and from an empty drawer nothing else comes out.
    expect((await move(accessToken, sessionId, 'WITHDRAWAL', 1).expect(409)).body.code).toBe('WITHDRAWAL_EXCEEDS_BALANCE');
  });

  it('a sangria above the balance is refused with the available amount, and nothing is written', async () => {
    const { accessToken, sessionId } = await setup(17270);
    const res = await move(accessToken, sessionId, 'WITHDRAWAL', 1000000).expect(409);
    expect(res.body.code).toBe('WITHDRAWAL_EXCEEDS_BALANCE');
    expect(res.body.message).toContain('R$ 172,70');
    expect((await move(accessToken, sessionId, 'WITHDRAWAL', 17271).expect(409)).body.code).toBe('WITHDRAWAL_EXCEEDS_BALANCE');
    expect(await getPrisma(app).cashMovement.count({ where: { sessionId } })).toBe(0);
    expect(await expected(accessToken, sessionId)).toBe(17270);
  });

  it('counts everything that is in the drawer: supplies and cash sales raise the limit', async () => {
    const { accessToken, branchId, sessionId } = await setup(1000);
    await move(accessToken, sessionId, 'SUPPLY', 2000).expect(201);
    const product = await createActiveProductE2E(server, accessToken, 'X-Burger', 25);
    await request(server)
      .post('/v1/pos/orders')
      .set(auth(accessToken))
      .send({ branchId, items: [{ productId: product.id, quantity: 1 }], paymentMethod: 'CASH' })
      .expect(201);
    await move(accessToken, sessionId, 'WITHDRAWAL', 5501).expect(409);
    await move(accessToken, sessionId, 'WITHDRAWAL', 5500).expect(201);
  });

  it('zero and negative amounts are refused', async () => {
    const { accessToken, sessionId } = await setup();
    for (const amountCents of [0, -500]) {
      expect((await move(accessToken, sessionId, 'WITHDRAWAL', amountCents).expect(400)).body.code).toBe('VALIDATION_ERROR');
    }
    expect(await getPrisma(app).cashMovement.count({ where: { sessionId } })).toBe(0);
  });

  it('two (and five) sangrias at the same moment never take out more than the drawer holds', async () => {
    const { accessToken, sessionId } = await setup(10000);
    const two = await Promise.all([move(accessToken, sessionId, 'WITHDRAWAL', 6000), move(accessToken, sessionId, 'WITHDRAWAL', 6000)]);
    expect(two.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(await expected(accessToken, sessionId)).toBe(4000);

    const other = await setup(10000);
    const five = await Promise.all(Array.from({ length: 5 }, () => move(other.accessToken, other.sessionId, 'WITHDRAWAL', 3000)));
    expect(five.map((r) => r.status).sort()).toEqual([201, 201, 201, 409, 409]);
    expect(await expected(other.accessToken, other.sessionId)).toBe(1000);
  });
});
