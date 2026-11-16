import { INestApplication } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import request from 'supertest';
import {
  createStaffAndLoginE2E,
  createTestApp,
  getPrisma,
  injectAuditFailure,
  registerTenantE2E,
  removeAuditFailure,
  uniqueSuffix,
} from './test-app.util';

type Json = Record<string, unknown>;

// Fase 11, fatia 4 (1/2): the points LEDGER by itself - program, rewards, redeem, adjust,
// reverse, idempotency, concurrency, atomic audit, isolation and permissions. How orders earn
// points is in loyalty-orders.e2e-spec.ts.
describe('Loyalty ledger (e2e)', () => {
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
  const prisma = () => getPrisma(app);
  const key = () => `loy-${uniqueSuffix()}`;

  let seq = 0;
  const phone = () => `115${String(Date.now() + ++seq).slice(-8)}`;

  async function setup(options: { enabled?: boolean } = {}) {
    const tenant = await registerTenantE2E(server);
    if (options.enabled !== false) {
      await put(tenant.accessToken, '/v1/loyalty/program', { enabled: true, pointsPerReal: 1 }).expect(200);
    }
    return tenant;
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const newCustomer = async (ctx: Ctx, name = 'Maria Souza') =>
    (await post(ctx.accessToken, '/v1/customers', { name, phone: phone() }).expect(201)).body as { id: string };
  const newReward = async (ctx: Ctx, pointsCost: number, name = 'Sobremesa da casa') =>
    (await post(ctx.accessToken, '/v1/loyalty/rewards', { name, pointsCost }).expect(201)).body as { id: string; pointsCost: number };

  const adjust = (token: string, customerId: string, points: number, extra: Json = {}) =>
    post(token, `/v1/loyalty/customers/${customerId}/adjust`, { points, reason: 'Ajuste de teste', idempotencyKey: key(), ...extra });
  const redeem = (token: string, ctx: Ctx, customerId: string, rewardId: string, extra: Json = {}) =>
    post(token, `/v1/loyalty/customers/${customerId}/redeem`, { rewardId, branchId: ctx.branchId, idempotencyKey: key(), ...extra });
  const reverse = (token: string, entryId: string, extra: Json = {}) =>
    post(token, `/v1/loyalty/entries/${entryId}/reverse`, { reason: 'Estorno de teste', idempotencyKey: key(), ...extra });
  const balance = async (ctx: Ctx, customerId: string) =>
    (await get(ctx.accessToken, `/v1/loyalty/customers/${customerId}`).expect(200)).body.balancePoints as number;

  // The invariant of the whole module: the stored balance is the sum of the ledger, the last
  // entry carries it, and no entry ever left it negative.
  async function expectLedgerConsistent(customerId: string) {
    const account = await prisma().loyaltyAccount.findUnique({ where: { customerId } });
    const entries = await prisma().loyaltyEntry.findMany({ where: { customerId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const sum = entries.reduce((total, entry) => total + entry.points, 0);
    expect(account?.balancePoints ?? 0).toBe(sum);
    expect(entries.every((entry) => entry.balanceAfter >= 0)).toBe(true);
    if (entries.length > 0) expect(Math.max(...entries.map((entry) => entry.balanceAfter))).toBeGreaterThanOrEqual(sum);
    return { account, entries, sum };
  }

  describe('program', () => {
    it('is disabled until configured, and the configuration is stored and audited', async () => {
      const ctx = await setup({ enabled: false });
      expect((await get(ctx.accessToken, '/v1/loyalty/program').expect(200)).body).toEqual({ enabled: false, pointsPerReal: 1 });

      const saved = await put(ctx.accessToken, '/v1/loyalty/program', { enabled: true, pointsPerReal: 3 }).expect(200);
      expect(saved.body).toEqual({ enabled: true, pointsPerReal: 3 });
      expect((await get(ctx.accessToken, '/v1/loyalty/program').expect(200)).body).toEqual({ enabled: true, pointsPerReal: 3 });

      // Saving the same values again writes no second audit entry.
      await put(ctx.accessToken, '/v1/loyalty/program', { enabled: true, pointsPerReal: 3 }).expect(200);
      const audits = await prisma().auditLog.findMany({ where: { tenantId: ctx.tenantId, action: 'LOYALTY_PROGRAM_UPDATED' } });
      expect(audits).toHaveLength(1);
      expect(audits[0].afterData).toEqual({ enabled: true, pointsPerReal: 3 });
    });

    it('rejects invalid configuration and fields the client must not send', async () => {
      const ctx = await setup({ enabled: false });
      for (const body of [
        { enabled: true, pointsPerReal: 0 },
        { enabled: true, pointsPerReal: 1001 },
        { enabled: true, pointsPerReal: 1.5 },
        { enabled: 'yes', pointsPerReal: 1 },
        { pointsPerReal: 1 },
        { enabled: true, pointsPerReal: 1, tenantId: ctx.tenantId },
      ]) {
        await put(ctx.accessToken, '/v1/loyalty/program', body as Json).expect(400);
      }
      expect(await prisma().loyaltyProgram.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
    });
  });

  describe('rewards', () => {
    it('creates, lists by cost, edits, deactivates and reactivates; never deletes', async () => {
      const ctx = await setup();
      const expensive = await newReward(ctx, 300, 'Combo completo');
      const cheap = await newReward(ctx, 50, 'Refrigerante');

      const listed = await get(ctx.accessToken, '/v1/loyalty/rewards').expect(200);
      expect(listed.body.data.map((r: { name: string }) => r.name)).toEqual(['Refrigerante', 'Combo completo']);
      expect(JSON.stringify(listed.body)).not.toMatch(/tenantId/);

      const edited = await patch(ctx.accessToken, `/v1/loyalty/rewards/${cheap.id}`, { pointsCost: 60, description: 'Lata 350ml' }).expect(200);
      expect(edited.body).toMatchObject({ pointsCost: 60, description: 'Lata 350ml', active: true });
      await patch(ctx.accessToken, `/v1/loyalty/rewards/${expensive.id}`, { active: false }).expect(200);

      expect((await get(ctx.accessToken, '/v1/loyalty/rewards').expect(200)).body.data).toHaveLength(1);
      expect((await get(ctx.accessToken, '/v1/loyalty/rewards?status=inactive').expect(200)).body.data).toHaveLength(1);
      expect((await get(ctx.accessToken, '/v1/loyalty/rewards?status=all').expect(200)).body.data).toHaveLength(2);
      await request(server).delete(`/v1/loyalty/rewards/${cheap.id}`).set(auth(ctx.accessToken)).expect(404);
    });

    it('rejects invalid rewards', async () => {
      const ctx = await setup();
      for (const body of [
        { name: 'A', pointsCost: 10 },
        { name: 'Sobremesa', pointsCost: 0 },
        { name: 'Sobremesa', pointsCost: -5 },
        { name: 'Sobremesa', pointsCost: 1.5 },
        { name: 'Sobremesa' },
        { name: 'Sobremesa', pointsCost: 10, active: false },
        { name: 'Sobremesa', pointsCost: 10, tenantId: ctx.tenantId },
      ]) {
        await post(ctx.accessToken, '/v1/loyalty/rewards', body as Json).expect(400);
      }
      expect(await prisma().loyaltyReward.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
    });
  });

  describe('adjustment', () => {
    it('credits and debits with a reason, keeps the running balance and audits each movement', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      expect(await balance(ctx, c.id)).toBe(0);

      const credit = await adjust(ctx.accessToken, c.id, 120, { reason: 'Cortesia pelo atraso' }).expect(200);
      expect(credit.body).toMatchObject({ type: 'ADJUSTMENT', points: 120, balanceAfter: 120, reason: 'Cortesia pelo atraso', reversed: false, idempotentReplay: false });
      const debit = await adjust(ctx.accessToken, c.id, -20).expect(200);
      expect(debit.body).toMatchObject({ points: -20, balanceAfter: 100 });
      expect(await balance(ctx, c.id)).toBe(100);
      await expectLedgerConsistent(c.id);

      const audits = await prisma().auditLog.findMany({ where: { tenantId: ctx.tenantId, action: 'LOYALTY_POINTS_ADJUSTED' }, orderBy: { createdAt: 'asc' } });
      expect(audits.map((a) => a.entityId)).toEqual([credit.body.id, debit.body.id]);
      expect(audits.every((a) => a.userId !== null)).toBe(true);
      // The trail names the customer by id, never by name or phone.
      expect(JSON.stringify(audits)).not.toMatch(/Maria|115\d{8}/);
    });

    it('never lets the balance go below zero', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await adjust(ctx.accessToken, c.id, 30).expect(200);
      const refused = await adjust(ctx.accessToken, c.id, -31).expect(409);
      expect(refused.body.code).toBe('LOYALTY_INSUFFICIENT_POINTS');
      expect(refused.body.details).toEqual({ balancePoints: 30, neededPoints: 31 });
      await adjust(ctx.accessToken, c.id, -30).expect(200);
      expect(await balance(ctx, c.id)).toBe(0);
      await adjust(ctx.accessToken, c.id, -1).expect(409);
      await expectLedgerConsistent(c.id);
    });

    it('rejects zero, fractions, huge values, a missing reason and extra fields', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const base = { points: 10, reason: 'Motivo valido', idempotencyKey: key() };
      for (const body of [
        { ...base, points: 0 },
        { ...base, points: 1.5 },
        { ...base, points: 1_000_001 },
        { ...base, points: '10' },
        { ...base, reason: 'ab' },
        { ...base, reason: '   ' },
        { points: 10, idempotencyKey: key() },
        { points: 10, reason: 'Motivo valido' },
        { ...base, idempotencyKey: 'a b c d e f g' },
        { ...base, balanceAfter: 999 },
        { ...base, tenantId: ctx.tenantId },
        { ...base, type: 'EARN' },
      ]) {
        await post(ctx.accessToken, `/v1/loyalty/customers/${c.id}/adjust`, body as Json).expect(400);
      }
      expect(await prisma().loyaltyEntry.count({ where: { customerId: c.id } })).toBe(0);
    });
  });

  describe('redeem', () => {
    it('debits the cost of the reward decided by the server and records where it happened', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const reward = await newReward(ctx, 80);
      await adjust(ctx.accessToken, c.id, 200).expect(200);

      const redeemed = await redeem(ctx.accessToken, ctx, c.id, reward.id).expect(200);
      expect(redeemed.body).toMatchObject({ type: 'REDEEM', points: -80, balanceAfter: 120, reward: { id: reward.id, name: 'Sobremesa da casa' } });
      const row = await prisma().loyaltyEntry.findUniqueOrThrow({ where: { id: redeemed.body.id } });
      expect(row).toMatchObject({ tenantId: ctx.tenantId, branchId: ctx.branchId, rewardId: reward.id, orderId: null });
      expect(await balance(ctx, c.id)).toBe(120);

      // A price change of the reward never rewrites what was already debited.
      await patch(ctx.accessToken, `/v1/loyalty/rewards/${reward.id}`, { pointsCost: 500 }).expect(200);
      expect((await prisma().loyaltyEntry.findUniqueOrThrow({ where: { id: redeemed.body.id } })).points).toBe(-80);
      await expectLedgerConsistent(c.id);
    });

    it('is refused without enough points, for an inactive reward, an inactive customer or a disabled program', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const reward = await newReward(ctx, 100);
      await adjust(ctx.accessToken, c.id, 99).expect(200);

      expect((await redeem(ctx.accessToken, ctx, c.id, reward.id).expect(409)).body.code).toBe('LOYALTY_INSUFFICIENT_POINTS');
      await adjust(ctx.accessToken, c.id, 1).expect(200);

      await patch(ctx.accessToken, `/v1/loyalty/rewards/${reward.id}`, { active: false }).expect(200);
      expect((await redeem(ctx.accessToken, ctx, c.id, reward.id).expect(409)).body.code).toBe('LOYALTY_REWARD_INACTIVE');
      await patch(ctx.accessToken, `/v1/loyalty/rewards/${reward.id}`, { active: true }).expect(200);

      await patch(ctx.accessToken, `/v1/customers/${c.id}`, { active: false }).expect(200);
      expect((await redeem(ctx.accessToken, ctx, c.id, reward.id).expect(409)).body.code).toBe('CUSTOMER_INACTIVE');
      await patch(ctx.accessToken, `/v1/customers/${c.id}`, { active: true }).expect(200);

      await put(ctx.accessToken, '/v1/loyalty/program', { enabled: false, pointsPerReal: 1 }).expect(200);
      expect((await redeem(ctx.accessToken, ctx, c.id, reward.id).expect(409)).body.code).toBe('LOYALTY_DISABLED');

      expect(await balance(ctx, c.id)).toBe(100);
      await put(ctx.accessToken, '/v1/loyalty/program', { enabled: true, pointsPerReal: 1 }).expect(200);
      await redeem(ctx.accessToken, ctx, c.id, reward.id).expect(200);
      expect(await balance(ctx, c.id)).toBe(0);
    });

    it('accepts no amount from the client', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const reward = await newReward(ctx, 100);
      await adjust(ctx.accessToken, c.id, 100).expect(200);
      for (const extra of [{ points: -1 }, { pointsCost: 1 }, { balanceAfter: 100 }, { tenantId: ctx.tenantId }]) {
        await redeem(ctx.accessToken, ctx, c.id, reward.id, extra).expect(400);
      }
      await redeem(ctx.accessToken, ctx, c.id, 'not-a-uuid').expect(400);
      expect(await balance(ctx, c.id)).toBe(100);
    });
  });

  describe('concurrency', () => {
    it('twenty simultaneous redemptions with points for exactly three: three succeed, never negative, never a 500', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const reward = await newReward(ctx, 100);
      await adjust(ctx.accessToken, c.id, 350).expect(200);

      const results = await Promise.all(Array.from({ length: 20 }, () => redeem(ctx.accessToken, ctx, c.id, reward.id)));
      const statuses = results.map((res) => res.status);
      expect(statuses.filter((s) => s === 200)).toHaveLength(3);
      expect(statuses.filter((s) => s === 409)).toHaveLength(17);
      expect(results.filter((res) => res.status === 409).every((res) => res.body.code === 'LOYALTY_INSUFFICIENT_POINTS')).toBe(true);

      expect(await balance(ctx, c.id)).toBe(50);
      const { entries } = await expectLedgerConsistent(c.id);
      expect(entries.filter((entry) => entry.type === 'REDEEM')).toHaveLength(3);
      // Each redemption saw the balance the previous one left.
      expect(entries.filter((entry) => entry.type === 'REDEEM').map((entry) => entry.balanceAfter).sort((a, b) => b - a)).toEqual([250, 150, 50]);
    });

    it('simultaneous credits and debits on a new account all land and add up', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      // The very first movements of this customer race to create the account too.
      const credits = await Promise.all(Array.from({ length: 12 }, () => adjust(ctx.accessToken, c.id, 10)));
      expect(credits.every((res) => res.status === 200)).toBe(true);
      expect(await prisma().loyaltyAccount.count({ where: { customerId: c.id } })).toBe(1);

      const mixed = await Promise.all([
        ...Array.from({ length: 6 }, () => adjust(ctx.accessToken, c.id, 5)),
        ...Array.from({ length: 6 }, () => adjust(ctx.accessToken, c.id, -5)),
      ]);
      expect(mixed.every((res) => res.status === 200)).toBe(true);
      expect(await balance(ctx, c.id)).toBe(120);
      const { entries } = await expectLedgerConsistent(c.id);
      expect(entries).toHaveLength(24);
    });
  });

  describe('idempotency', () => {
    it('repeating a request with the same key returns the same entry and moves the balance once', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const k = key();
      const first = await adjust(ctx.accessToken, c.id, 40, { idempotencyKey: k }).expect(200);
      const again = await adjust(ctx.accessToken, c.id, 40, { idempotencyKey: k }).expect(200);
      expect(again.body.id).toBe(first.body.id);
      expect(again.body.idempotentReplay).toBe(true);
      expect(await balance(ctx, c.id)).toBe(40);
      expect(await prisma().auditLog.count({ where: { tenantId: ctx.tenantId, action: 'LOYALTY_POINTS_ADJUSTED' } })).toBe(1);
    });

    it('eight simultaneous duplicates of one redemption debit once, even when the points only cover one', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const reward = await newReward(ctx, 100);
      await adjust(ctx.accessToken, c.id, 100).expect(200);
      const k = key();

      const results = await Promise.all(Array.from({ length: 8 }, () => redeem(ctx.accessToken, ctx, c.id, reward.id, { idempotencyKey: k })));
      // Every duplicate answers with the one redemption - none is told "insufficient points".
      expect(results.map((res) => res.status)).toEqual(Array(8).fill(200));
      expect(new Set(results.map((res) => res.body.id)).size).toBe(1);
      expect(results.filter((res) => res.body.idempotentReplay === false)).toHaveLength(1);
      expect(await balance(ctx, c.id)).toBe(0);
      expect(await prisma().loyaltyEntry.count({ where: { customerId: c.id, type: 'REDEEM' } })).toBe(1);
    });

    it('a key cannot be reused for a different operation, customer or amount', async () => {
      const ctx = await setup();
      const a = await newCustomer(ctx, 'Cliente A');
      const b = await newCustomer(ctx, 'Cliente B');
      const reward = await newReward(ctx, 10);
      const k = key();
      await adjust(ctx.accessToken, a.id, 50, { idempotencyKey: k }).expect(200);

      // Built one at a time: a supertest request binds its own ephemeral server when created.
      for (const attempt of [
        () => adjust(ctx.accessToken, a.id, 60, { idempotencyKey: k }),
        () => adjust(ctx.accessToken, b.id, 50, { idempotencyKey: k }),
        () => redeem(ctx.accessToken, ctx, a.id, reward.id, { idempotencyKey: k }),
      ]) {
        expect((await attempt().expect(409)).body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      }
      expect(await balance(ctx, a.id)).toBe(50);
      expect(await balance(ctx, b.id)).toBe(0);
    });

    it('a replay still answers after the program was disabled or the customer deactivated', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const reward = await newReward(ctx, 10);
      await adjust(ctx.accessToken, c.id, 10).expect(200);
      const k = key();
      const first = await redeem(ctx.accessToken, ctx, c.id, reward.id, { idempotencyKey: k }).expect(200);
      await put(ctx.accessToken, '/v1/loyalty/program', { enabled: false, pointsPerReal: 1 }).expect(200);
      await patch(ctx.accessToken, `/v1/customers/${c.id}`, { active: false }).expect(200);
      const replay = await redeem(ctx.accessToken, ctx, c.id, reward.id, { idempotencyKey: k }).expect(200);
      expect(replay.body).toMatchObject({ id: first.body.id, idempotentReplay: true });
    });

    it('the same key in another tenant is another operation', async () => {
      const a = await setup();
      const b = await setup();
      const ca = await newCustomer(a);
      const cb = await newCustomer(b);
      const k = key();
      await adjust(a.accessToken, ca.id, 10, { idempotencyKey: k }).expect(200);
      const other = await adjust(b.accessToken, cb.id, 20, { idempotencyKey: k }).expect(200);
      expect(other.body).toMatchObject({ points: 20, idempotentReplay: false });
    });
  });

  describe('reversal', () => {
    it('undoes a redemption once, gives the points back and marks the original in the statement', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const reward = await newReward(ctx, 70);
      await adjust(ctx.accessToken, c.id, 100).expect(200);
      const redeemed = await redeem(ctx.accessToken, ctx, c.id, reward.id).expect(200);

      const undone = await reverse(ctx.accessToken, redeemed.body.id, { reason: 'Lançado no cliente errado' }).expect(200);
      expect(undone.body).toMatchObject({ type: 'REVERSAL', points: 70, balanceAfter: 100, reversedEntryId: redeemed.body.id, reward: { id: reward.id } });
      expect(await balance(ctx, c.id)).toBe(100);

      expect((await reverse(ctx.accessToken, redeemed.body.id).expect(409)).body.code).toBe('LOYALTY_ENTRY_ALREADY_REVERSED');
      expect((await reverse(ctx.accessToken, undone.body.id).expect(409)).body.code).toBe('LOYALTY_ENTRY_NOT_REVERSIBLE');

      const statement = await get(ctx.accessToken, `/v1/loyalty/customers/${c.id}/entries`).expect(200);
      expect(statement.body.data.map((e: { type: string; reversed: boolean }) => [e.type, e.reversed])).toEqual([
        ['REVERSAL', false],
        ['REDEEM', true],
        ['ADJUSTMENT', false],
      ]);
      await expectLedgerConsistent(c.id);
    });

    it('refuses to reverse a credit whose points were already spent', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const reward = await newReward(ctx, 80);
      const credit = await adjust(ctx.accessToken, c.id, 100).expect(200);
      await redeem(ctx.accessToken, ctx, c.id, reward.id).expect(200);

      const refused = await reverse(ctx.accessToken, credit.body.id).expect(409);
      expect(refused.body.code).toBe('LOYALTY_INSUFFICIENT_POINTS');
      expect(await balance(ctx, c.id)).toBe(20);
      expect(await prisma().loyaltyEntry.count({ where: { customerId: c.id, type: 'REVERSAL' } })).toBe(0);
    });

    it('six simultaneous reversals of the same entry reverse it exactly once', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const credit = await adjust(ctx.accessToken, c.id, 100).expect(200);
      const results = await Promise.all(Array.from({ length: 6 }, () => reverse(ctx.accessToken, credit.body.id)));
      const statuses = results.map((res) => res.status).sort();
      expect(statuses).toEqual([200, 409, 409, 409, 409, 409]);
      expect(await balance(ctx, c.id)).toBe(0);
      expect(await prisma().loyaltyEntry.count({ where: { reversedEntryId: credit.body.id } })).toBe(1);
    });

    it('needs a reason and answers 404 for unknown entries', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const credit = await adjust(ctx.accessToken, c.id, 10).expect(200);
      await post(ctx.accessToken, `/v1/loyalty/entries/${credit.body.id}/reverse`, { idempotencyKey: key() }).expect(400);
      await post(ctx.accessToken, `/v1/loyalty/entries/${credit.body.id}/reverse`, { reason: 'x', idempotencyKey: key() }).expect(400);
      await reverse(ctx.accessToken, '00000000-0000-4000-8000-000000000000').expect(404);
      await reverse(ctx.accessToken, 'not-a-uuid').expect(400);
    });
  });

  describe('statement', () => {
    it('is paginated newest first, with a stable order', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      for (let i = 1; i <= 5; i++) await adjust(ctx.accessToken, c.id, i).expect(200);

      const first = await get(ctx.accessToken, `/v1/loyalty/customers/${c.id}/entries?pageSize=2`).expect(200);
      const second = await get(ctx.accessToken, `/v1/loyalty/customers/${c.id}/entries?pageSize=2&page=2`).expect(200);
      const third = await get(ctx.accessToken, `/v1/loyalty/customers/${c.id}/entries?pageSize=2&page=3`).expect(200);
      expect(first.body.meta).toEqual({ page: 1, pageSize: 2, total: 5, totalPages: 3 });
      const points = [...first.body.data, ...second.body.data, ...third.body.data].map((e: { points: number }) => e.points);
      expect(points).toEqual([5, 4, 3, 2, 1]);
      expect(first.body.data[0].balanceAfter).toBe(15);
      await get(ctx.accessToken, `/v1/loyalty/customers/${c.id}/entries?pageSize=101`).expect(400);
    });

    it('a customer without movements has balance zero and an empty statement, and no account row is created by reading', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      expect((await get(ctx.accessToken, `/v1/loyalty/customers/${c.id}`).expect(200)).body).toEqual({
        customerId: c.id,
        balancePoints: 0,
        program: { enabled: true, pointsPerReal: 1 },
      });
      expect((await get(ctx.accessToken, `/v1/loyalty/customers/${c.id}/entries`).expect(200)).body.data).toEqual([]);
      expect(await prisma().loyaltyAccount.count({ where: { customerId: c.id } })).toBe(0);
    });
  });

  describe('the ledger cannot be rewritten', () => {
    it('the database refuses to update or delete an entry, a negative balance and an entry without its origin', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const credit = await adjust(ctx.accessToken, c.id, 50).expect(200);

      await expect(prisma().loyaltyEntry.update({ where: { id: credit.body.id }, data: { points: 5000 } })).rejects.toThrow(/append-only/);
      await expect(prisma().loyaltyEntry.delete({ where: { id: credit.body.id } })).rejects.toThrow(/append-only/);
      await expect(prisma().loyaltyAccount.update({ where: { customerId: c.id }, data: { balancePoints: -1 } })).rejects.toThrow();

      const account = await prisma().loyaltyAccount.findUniqueOrThrow({ where: { customerId: c.id } });
      const base = { tenantId: ctx.tenantId, accountId: account.id, customerId: c.id, balanceAfter: 60 };
      // zero points; EARN without order; REDEEM with a positive sign; adjustment without reason.
      await expect(prisma().loyaltyEntry.create({ data: { ...base, type: 'ADJUSTMENT', points: 0, reason: 'motivo' } })).rejects.toThrow();
      await expect(prisma().loyaltyEntry.create({ data: { ...base, type: 'EARN', points: 10 } })).rejects.toThrow();
      await expect(prisma().loyaltyEntry.create({ data: { ...base, type: 'REDEEM', points: 10 } })).rejects.toThrow();
      await expect(prisma().loyaltyEntry.create({ data: { ...base, type: 'ADJUSTMENT', points: 10 } })).rejects.toThrow();
      await expect(prisma().loyaltyEntry.create({ data: { ...base, type: 'ADJUSTMENT', points: 10, reason: 'motivo', balanceAfter: -1 } })).rejects.toThrow();

      expect(await balance(ctx, c.id)).toBe(50);
      await expectLedgerConsistent(c.id);
    });
  });

  describe('audit is part of the transaction', () => {
    afterEach(() => removeAuditFailure(app, 'fail_audit_loyalty_test'));

    it.each([
      ['LOYALTY_POINTS_ADJUSTED', 'adjust'],
      ['LOYALTY_POINTS_REDEEMED', 'redeem'],
      ['LOYALTY_ENTRY_REVERSED', 'reverse'],
    ])('%s: when the audit cannot be written, nothing is written', async (action, operation) => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const reward = await newReward(ctx, 10);
      const credit = await adjust(ctx.accessToken, c.id, 100).expect(200);
      const entriesBefore = await prisma().loyaltyEntry.count({ where: { customerId: c.id } });

      await injectAuditFailure(app, 'fail_audit_loyalty_test', ctx.tenantId, action);
      const run = () =>
        operation === 'adjust'
          ? adjust(ctx.accessToken, c.id, 5)
          : operation === 'redeem'
            ? redeem(ctx.accessToken, ctx, c.id, reward.id)
            : reverse(ctx.accessToken, credit.body.id);
      await run().expect(500);

      expect(await prisma().loyaltyEntry.count({ where: { customerId: c.id } })).toBe(entriesBefore);
      expect(await balance(ctx, c.id)).toBe(100);
      await expectLedgerConsistent(c.id);

      await removeAuditFailure(app, 'fail_audit_loyalty_test');
      await run().expect(200);
    });
  });

  describe('tenant isolation', () => {
    it('tenant A cannot read, redeem, adjust or reverse anything of tenant B', async () => {
      const a = await setup();
      const b = await setup();
      const theirCustomer = await newCustomer(b);
      const theirReward = await newReward(b, 10);
      const theirEntry = await adjust(b.accessToken, theirCustomer.id, 100).expect(200);
      const myCustomer = await newCustomer(a);
      await adjust(a.accessToken, myCustomer.id, 100).expect(200);

      await get(a.accessToken, `/v1/loyalty/customers/${theirCustomer.id}`).expect(404);
      await get(a.accessToken, `/v1/loyalty/customers/${theirCustomer.id}/entries`).expect(404);
      await adjust(a.accessToken, theirCustomer.id, 10).expect(404);
      await redeem(a.accessToken, a, theirCustomer.id, theirReward.id).expect(404);
      await reverse(a.accessToken, theirEntry.body.id).expect(404);
      await patch(a.accessToken, `/v1/loyalty/rewards/${theirReward.id}`, { pointsCost: 1 }).expect(404);
      // My customer cannot spend on a reward of another restaurant either.
      expect((await redeem(a.accessToken, a, myCustomer.id, theirReward.id).expect(404)).body.code).toBe('LOYALTY_REWARD_NOT_FOUND');
      // ...nor at a branch of another restaurant.
      const mine = await newReward(a, 10);
      await redeem(a.accessToken, a, myCustomer.id, mine.id, { branchId: b.branchId }).expect(404);

      expect((await get(a.accessToken, '/v1/loyalty/rewards?status=all').expect(200)).body.data).toHaveLength(1);
      expect(await balance(b, theirCustomer.id)).toBe(100);
      expect(await balance(a, myCustomer.id)).toBe(100);
      // Each restaurant has its own program.
      await put(a.accessToken, '/v1/loyalty/program', { enabled: false, pointsPerReal: 9 }).expect(200);
      expect((await get(b.accessToken, '/v1/loyalty/program').expect(200)).body).toEqual({ enabled: true, pointsPerReal: 1 });
    });

    it('a branch-limited user redeems only at a branch they work at', async () => {
      const ctx = await setup();
      const second = await prisma().branch.create({ data: { tenantId: ctx.tenantId, name: 'Filial', code: 'FILIAL' } });
      const cashier = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'CASHIER', [second.id]);
      const c = await newCustomer(ctx);
      const reward = await newReward(ctx, 10);
      await adjust(ctx.accessToken, c.id, 30).expect(200);

      expect((await redeem(cashier, ctx, c.id, reward.id).expect(403)).body.code).toBe('BRANCH_ACCESS_DENIED');
      await redeem(cashier, ctx, c.id, reward.id, { branchId: second.id }).expect(200);
      expect(await balance(ctx, c.id)).toBe(20);
    });
  });

  describe('permissions (backend)', () => {
    it.each([
      // role, read, redeem, adjust/reverse, configure
      ['OWNER', 200, 200, 200, 200],
      ['ADMIN', 200, 200, 200, 200],
      ['MANAGER', 200, 200, 200, 403],
      ['CASHIER', 200, 200, 403, 403],
      ['WAITER', 403, 403, 403, 403],
      ['KITCHEN', 403, 403, 403, 403],
      ['DELIVERY', 403, 403, 403, 403],
      ['VIEWER', 403, 403, 403, 403],
    ] as [RoleName, number, number, number, number][])('%s: read %i, redeem %i, adjust %i, configure %i', async (role, read, canRedeem, canAdjust, configure) => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const reward = await newReward(ctx, 10);
      const seed = await adjust(ctx.accessToken, c.id, 100).expect(200);
      const token = role === 'OWNER' ? ctx.accessToken : await createStaffAndLoginE2E(app, server, ctx.tenantId, role, [ctx.branchId]);

      await get(token, '/v1/loyalty/program').expect(read);
      await get(token, '/v1/loyalty/rewards').expect(read);
      await get(token, `/v1/loyalty/customers/${c.id}`).expect(read);
      await get(token, `/v1/loyalty/customers/${c.id}/entries`).expect(read);
      await redeem(token, ctx, c.id, reward.id).expect(canRedeem);
      await adjust(token, c.id, 5).expect(canAdjust);
      await reverse(token, seed.body.id).expect(canAdjust === 200 ? 409 : 403); // 409: points already spent
      await put(token, '/v1/loyalty/program', { enabled: true, pointsPerReal: 2 }).expect(configure);
      await post(token, '/v1/loyalty/rewards', { name: 'Outra recompensa', pointsCost: 5 }).expect(configure === 200 ? 201 : 403);
      await patch(token, `/v1/loyalty/rewards/${reward.id}`, { pointsCost: 11 }).expect(configure);
    });

    it('every route needs a session', async () => {
      const id = '00000000-0000-4000-8000-000000000000';
      await request(server).get('/v1/loyalty/program').expect(401);
      await request(server).put('/v1/loyalty/program').send({ enabled: true, pointsPerReal: 1 }).expect(401);
      await request(server).get('/v1/loyalty/rewards').expect(401);
      await request(server).get(`/v1/loyalty/customers/${id}`).expect(401);
      await request(server).post(`/v1/loyalty/customers/${id}/adjust`).send({}).expect(401);
      await request(server).post(`/v1/loyalty/customers/${id}/redeem`).send({}).expect(401);
      await request(server).post(`/v1/loyalty/entries/${id}/reverse`).send({}).expect(401);
    });

    it('the permission matrix really stored in the database', async () => {
      const rows = await prisma().rolePermission.findMany({
        where: { permission: { key: { startsWith: 'loyalty.' } } },
        select: { role: { select: { name: true } }, permission: { select: { key: true } } },
      });
      const byRole: Record<string, string[]> = {};
      for (const row of rows) (byRole[row.role.name] ??= []).push(row.permission.key);
      for (const role of Object.keys(byRole)) byRole[role].sort();
      const all = ['loyalty.adjust', 'loyalty.configure', 'loyalty.read', 'loyalty.redeem'];
      expect(byRole).toEqual({
        OWNER: all,
        ADMIN: all,
        MANAGER: ['loyalty.adjust', 'loyalty.read', 'loyalty.redeem'],
        CASHIER: ['loyalty.read', 'loyalty.redeem'],
      });
    });
  });
});
