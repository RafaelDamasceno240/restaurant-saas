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

// Fase 11, fatia 5 (1/2): the cashback LEDGER by itself - program, manual adjustment, reversal,
// expiration, idempotency, concurrency, atomic audit, isolation and permissions. How orders earn
// and spend cashback is in cashback-orders.e2e-spec.ts.
describe('Cashback ledger (e2e)', () => {
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
  const prisma = () => getPrisma(app);
  const key = () => `cbk-${uniqueSuffix()}`;
  const DAY = 86_400_000;

  let seq = 0;
  const phone = () => `113${String(Date.now() + ++seq).slice(-8)}`;

  const PROGRAM = { enabled: true, earnRateBps: 500, expireAfterDays: null };

  async function setup(program: Json | null = PROGRAM) {
    const tenant = await registerTenantE2E(server);
    if (program) await put(tenant.accessToken, '/v1/cashback/program', program).expect(200);
    return tenant;
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const newCustomer = async (ctx: Ctx, name = 'Maria Souza') =>
    (await post(ctx.accessToken, '/v1/customers', { name, phone: phone() }).expect(201)).body as { id: string };

  const adjust = (token: string, customerId: string, amountCents: number, extra: Json = {}) =>
    post(token, `/v1/cashback/customers/${customerId}/adjust`, { amountCents, reason: 'Ajuste de teste', idempotencyKey: key(), ...extra });
  const reverse = (token: string, entryId: string, extra: Json = {}) =>
    post(token, `/v1/cashback/entries/${entryId}/reverse`, { reason: 'Estorno de teste', idempotencyKey: key(), ...extra });
  const account = async (ctx: Ctx, customerId: string) =>
    (await get(ctx.accessToken, `/v1/cashback/customers/${customerId}`).expect(200)).body as {
      balanceCents: number;
      expiredPendingCents: number;
      expiresAt: string | null;
    };
  const balance = async (ctx: Ctx, customerId: string) => (await account(ctx, customerId)).balanceCents;

  // The invariant of the whole module: the stored balance is the sum of the ledger and no entry
  // ever left it negative.
  async function expectLedgerConsistent(customerId: string) {
    const stored = await prisma().cashbackAccount.findUnique({ where: { customerId } });
    const entries = await prisma().cashbackEntry.findMany({ where: { customerId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    const sum = entries.reduce((total, entry) => total + entry.amountCents, 0);
    expect(stored?.balanceCents ?? 0).toBe(sum);
    expect(entries.every((entry) => entry.balanceAfterCents >= 0)).toBe(true);
    return { stored, entries, sum };
  }

  describe('program', () => {
    it('is disabled until configured, and the configuration is stored and audited once per change', async () => {
      const ctx = await setup(null);
      expect((await get(ctx.accessToken, '/v1/cashback/program').expect(200)).body).toEqual({ enabled: false, earnRateBps: 500, expireAfterDays: null });

      const saved = await put(ctx.accessToken, '/v1/cashback/program', { enabled: true, earnRateBps: 250, expireAfterDays: 90 }).expect(200);
      expect(saved.body).toEqual({ enabled: true, earnRateBps: 250, expireAfterDays: 90 });
      await put(ctx.accessToken, '/v1/cashback/program', { enabled: true, earnRateBps: 250, expireAfterDays: 90 }).expect(200);

      const audits = await prisma().auditLog.findMany({ where: { tenantId: ctx.tenantId, action: 'CASHBACK_PROGRAM_UPDATED' } });
      expect(audits).toHaveLength(1);
      expect(audits[0].afterData).toEqual({ enabled: true, earnRateBps: 250, expireAfterDays: 90 });
    });

    it('rejects invalid configuration and fields the client must not send', async () => {
      const ctx = await setup(null);
      for (const body of [
        { enabled: true, earnRateBps: 0, expireAfterDays: null },
        { enabled: true, earnRateBps: 5001, expireAfterDays: null },
        { enabled: true, earnRateBps: 2.5, expireAfterDays: null },
        { enabled: true, earnRateBps: 500, expireAfterDays: 0 },
        { enabled: true, earnRateBps: 500, expireAfterDays: 3651 },
        { enabled: true, earnRateBps: 500 },
        { earnRateBps: 500, expireAfterDays: null },
        { enabled: true, earnRateBps: 500, expireAfterDays: null, tenantId: ctx.tenantId },
      ]) {
        await put(ctx.accessToken, '/v1/cashback/program', body as Json).expect(400);
      }
      expect(await prisma().cashbackProgram.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
    });
  });

  describe('administrative adjustment', () => {
    it('credits and debits cents with a reason, keeps the running balance and audits each movement', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 0, expiredPendingCents: 0, expiresAt: null });

      const credit = await adjust(ctx.accessToken, c.id, 1_500, { reason: 'Cortesia pelo erro no pedido' }).expect(200);
      expect(credit.body).toMatchObject({ type: 'ADJUSTMENT', amountCents: 1_500, balanceAfterCents: 1_500, reversed: false, idempotentReplay: false });
      const debit = await adjust(ctx.accessToken, c.id, -400).expect(200);
      expect(debit.body).toMatchObject({ amountCents: -400, balanceAfterCents: 1_100 });
      expect(await balance(ctx, c.id)).toBe(1_100);
      await expectLedgerConsistent(c.id);

      const audits = await prisma().auditLog.findMany({ where: { tenantId: ctx.tenantId, action: 'CASHBACK_ADJUSTED' }, orderBy: { createdAt: 'asc' } });
      expect(audits.map((a) => a.entityId)).toEqual([credit.body.id, debit.body.id]);
      expect(audits.every((a) => a.userId !== null)).toBe(true);
      expect(JSON.stringify(audits)).not.toMatch(/Maria|113\d{8}/);
    });

    it('never lets the balance go below zero', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await adjust(ctx.accessToken, c.id, 300).expect(200);
      const refused = await adjust(ctx.accessToken, c.id, -301).expect(409);
      expect(refused.body.code).toBe('CASHBACK_INSUFFICIENT_BALANCE');
      expect(refused.body.details).toEqual({ balanceCents: 300, neededCents: 301 });
      await adjust(ctx.accessToken, c.id, -300).expect(200);
      await adjust(ctx.accessToken, c.id, -1).expect(409);
      expect(await balance(ctx, c.id)).toBe(0);
      await expectLedgerConsistent(c.id);
    });

    it('works with the program disabled (a correction is always possible) and rejects invalid bodies', async () => {
      const ctx = await setup({ enabled: false, earnRateBps: 500, expireAfterDays: null });
      const c = await newCustomer(ctx);
      await adjust(ctx.accessToken, c.id, 100).expect(200);

      const base = { amountCents: 10, reason: 'Motivo valido', idempotencyKey: key() };
      for (const body of [
        { ...base, amountCents: 0 },
        { ...base, amountCents: 1.5 },
        { ...base, amountCents: 10_000_001 },
        { ...base, amountCents: '10' },
        { ...base, reason: 'ab' },
        { amountCents: 10, idempotencyKey: key() },
        { amountCents: 10, reason: 'Motivo valido' },
        { ...base, balanceAfterCents: 999 },
        { ...base, tenantId: ctx.tenantId },
        { ...base, type: 'EARN' },
      ]) {
        await post(ctx.accessToken, `/v1/cashback/customers/${c.id}/adjust`, body as Json).expect(400);
      }
      expect(await prisma().cashbackEntry.count({ where: { customerId: c.id } })).toBe(1);
    });
  });

  describe('concurrency', () => {
    it('twenty simultaneous debits with balance for exactly three: three succeed, never negative, never a 500', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await adjust(ctx.accessToken, c.id, 350).expect(200);

      const results = await Promise.all(Array.from({ length: 20 }, () => adjust(ctx.accessToken, c.id, -100)));
      const statuses = results.map((res) => res.status);
      expect(statuses.filter((s) => s === 200)).toHaveLength(3);
      expect(statuses.filter((s) => s === 409)).toHaveLength(17);
      expect(await balance(ctx, c.id)).toBe(50);
      const { entries } = await expectLedgerConsistent(c.id);
      expect(entries.filter((entry) => entry.amountCents < 0).map((entry) => entry.balanceAfterCents).sort((a, b) => b - a)).toEqual([250, 150, 50]);
    });

    it('simultaneous first movements create one account and all land', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const credits = await Promise.all(Array.from({ length: 12 }, () => adjust(ctx.accessToken, c.id, 10)));
      expect(credits.every((res) => res.status === 200)).toBe(true);
      expect(await prisma().cashbackAccount.count({ where: { customerId: c.id } })).toBe(1);
      expect(await balance(ctx, c.id)).toBe(120);
      await expectLedgerConsistent(c.id);
    });
  });

  describe('idempotency', () => {
    it('the same key returns the same entry and moves the balance once, even under simultaneous duplicates', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await adjust(ctx.accessToken, c.id, 100).expect(200);
      const k = key();

      const results = await Promise.all(Array.from({ length: 8 }, () => adjust(ctx.accessToken, c.id, -100, { idempotencyKey: k })));
      // The balance only covers one debit, and every duplicate still answers with that debit.
      expect(results.map((res) => res.status)).toEqual(Array(8).fill(200));
      expect(new Set(results.map((res) => res.body.id)).size).toBe(1);
      expect(results.filter((res) => res.body.idempotentReplay === false)).toHaveLength(1);
      expect(await balance(ctx, c.id)).toBe(0);

      const later = await adjust(ctx.accessToken, c.id, -100, { idempotencyKey: k }).expect(200);
      expect(later.body.idempotentReplay).toBe(true);
    });

    it('a key cannot be reused for another amount or customer; another tenant may use the same key', async () => {
      const ctx = await setup();
      const a = await newCustomer(ctx, 'Cliente A');
      const b = await newCustomer(ctx, 'Cliente B');
      const k = key();
      await adjust(ctx.accessToken, a.id, 500, { idempotencyKey: k }).expect(200);
      expect((await adjust(ctx.accessToken, a.id, 600, { idempotencyKey: k }).expect(409)).body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect((await adjust(ctx.accessToken, b.id, 500, { idempotencyKey: k }).expect(409)).body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await balance(ctx, b.id)).toBe(0);

      const other = await setup();
      const theirs = await newCustomer(other);
      expect((await adjust(other.accessToken, theirs.id, 700, { idempotencyKey: k }).expect(200)).body.idempotentReplay).toBe(false);
    });
  });

  describe('reversal', () => {
    it('undoes an adjustment once and marks it in the statement', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const credit = await adjust(ctx.accessToken, c.id, 800).expect(200);

      const undone = await reverse(ctx.accessToken, credit.body.id, { reason: 'Crédito no cliente errado' }).expect(200);
      expect(undone.body).toMatchObject({ type: 'REVERSAL', amountCents: -800, balanceAfterCents: 0, reversedEntryId: credit.body.id });
      expect((await reverse(ctx.accessToken, credit.body.id).expect(409)).body.code).toBe('CASHBACK_ENTRY_ALREADY_REVERSED');
      expect((await reverse(ctx.accessToken, undone.body.id).expect(409)).body.code).toBe('CASHBACK_ENTRY_NOT_REVERSIBLE');

      const statement = await get(ctx.accessToken, `/v1/cashback/customers/${c.id}/entries`).expect(200);
      expect(statement.body.data.map((e: { type: string; reversed: boolean }) => [e.type, e.reversed])).toEqual([
        ['REVERSAL', false],
        ['ADJUSTMENT', true],
      ]);
      await expectLedgerConsistent(c.id);
    });

    it('refuses to reverse a credit already spent, and six simultaneous reversals reverse once', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const credit = await adjust(ctx.accessToken, c.id, 1_000).expect(200);
      await adjust(ctx.accessToken, c.id, -600).expect(200);
      expect((await reverse(ctx.accessToken, credit.body.id).expect(409)).body.code).toBe('CASHBACK_INSUFFICIENT_BALANCE');

      const other = await adjust(ctx.accessToken, c.id, 50).expect(200);
      const results = await Promise.all(Array.from({ length: 6 }, () => reverse(ctx.accessToken, other.body.id)));
      expect(results.map((res) => res.status).sort()).toEqual([200, 409, 409, 409, 409, 409]);
      expect(await balance(ctx, c.id)).toBe(400);
      await expectLedgerConsistent(c.id);
    });

    it('needs a reason and answers 404 for unknown entries', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const credit = await adjust(ctx.accessToken, c.id, 10).expect(200);
      await post(ctx.accessToken, `/v1/cashback/entries/${credit.body.id}/reverse`, { idempotencyKey: key() }).expect(400);
      await reverse(ctx.accessToken, '00000000-0000-4000-8000-000000000000').expect(404);
      await reverse(ctx.accessToken, 'not-a-uuid').expect(400);
    });
  });

  describe('expiration', () => {
    // Makes the last activity of the account `days` old (the account row is not the ledger).
    const idle = (customerId: string, days: number) =>
      prisma().cashbackAccount.update({ where: { customerId }, data: { lastActivityAt: new Date(Date.now() - days * DAY) } });

    it('reports when the balance expires, counted from the last credit', async () => {
      const ctx = await setup({ enabled: true, earnRateBps: 500, expireAfterDays: 30 });
      const c = await newCustomer(ctx);
      await adjust(ctx.accessToken, c.id, 1_000).expect(200);
      const state = await account(ctx, c.id);
      const days = (new Date(state.expiresAt as string).getTime() - Date.now()) / DAY;
      expect(days).toBeGreaterThan(29.9);
      expect(days).toBeLessThan(30.1);
      expect(state).toMatchObject({ balanceCents: 1_000, expiredPendingCents: 0 });
    });

    it('an idle balance stops being available at once and is written off by the next movement', async () => {
      const ctx = await setup({ enabled: true, earnRateBps: 500, expireAfterDays: 30 });
      const c = await newCustomer(ctx);
      await adjust(ctx.accessToken, c.id, 1_000).expect(200);
      await idle(c.id, 31);

      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 0, expiredPendingCents: 1_000, expiresAt: null });
      // Reading wrote nothing.
      expect(await prisma().cashbackEntry.count({ where: { customerId: c.id } })).toBe(1);

      // A debit against the expired money is refused: the balance it sees is zero.
      await adjust(ctx.accessToken, c.id, -100).expect(409);

      // A new credit first writes the EXPIRATION, then lands on a clean balance.
      const fresh = await adjust(ctx.accessToken, c.id, 250).expect(200);
      expect(fresh.body.balanceAfterCents).toBe(250);
      const entries = await prisma().cashbackEntry.findMany({ where: { customerId: c.id }, orderBy: [{ createdAt: 'asc' }, { balanceAfterCents: 'asc' }] });
      expect(entries.map((e) => [e.type, e.amountCents, e.balanceAfterCents])).toEqual([
        ['ADJUSTMENT', 1_000, 1_000],
        ['EXPIRATION', -1_000, 0],
        ['ADJUSTMENT', 250, 250],
      ]);
      expect(entries[1].createdByUserId).toBeNull();
      expect(await prisma().auditLog.count({ where: { tenantId: ctx.tenantId, action: 'CASHBACK_EXPIRED' } })).toBe(1);
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 250, expiredPendingCents: 0 });
      await expectLedgerConsistent(c.id);
    });

    it('the bulk write-off settles only the accounts that are really past the limit, once', async () => {
      const ctx = await setup({ enabled: true, earnRateBps: 500, expireAfterDays: 30 });
      const old = await newCustomer(ctx, 'Saldo Parado');
      const recent = await newCustomer(ctx, 'Saldo Recente');
      const empty = await newCustomer(ctx, 'Sem Saldo');
      await adjust(ctx.accessToken, old.id, 700).expect(200);
      await adjust(ctx.accessToken, recent.id, 300).expect(200);
      await adjust(ctx.accessToken, empty.id, 50).expect(200);
      await adjust(ctx.accessToken, empty.id, -50).expect(200);
      await idle(old.id, 45);
      await idle(recent.id, 29);
      await idle(empty.id, 400);

      const first = await post(ctx.accessToken, '/v1/cashback/expire').expect(200);
      expect(first.body).toEqual({ expiredAccounts: 1, expiredCents: 700, moreToProcess: false });
      const second = await post(ctx.accessToken, '/v1/cashback/expire').expect(200);
      expect(second.body).toEqual({ expiredAccounts: 0, expiredCents: 0, moreToProcess: false });

      expect(await balance(ctx, old.id)).toBe(0);
      expect(await balance(ctx, recent.id)).toBe(300);
      const expiration = await prisma().cashbackEntry.findFirstOrThrow({ where: { customerId: old.id, type: 'EXPIRATION' } });
      expect(expiration.createdByUserId).not.toBeNull();
      await expectLedgerConsistent(old.id);
    });

    it('nothing ever expires without an expiration rule, and an expiration cannot be reversed', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await adjust(ctx.accessToken, c.id, 500).expect(200);
      await idle(c.id, 5_000);
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 500, expiredPendingCents: 0, expiresAt: null });
      expect((await post(ctx.accessToken, '/v1/cashback/expire').expect(200)).body.expiredAccounts).toBe(0);

      await put(ctx.accessToken, '/v1/cashback/program', { enabled: true, earnRateBps: 500, expireAfterDays: 10 }).expect(200);
      await post(ctx.accessToken, '/v1/cashback/expire').expect(200);
      const expiration = await prisma().cashbackEntry.findFirstOrThrow({ where: { customerId: c.id, type: 'EXPIRATION' } });
      expect((await reverse(ctx.accessToken, expiration.id).expect(409)).body.code).toBe('CASHBACK_ENTRY_NOT_REVERSIBLE');
    });
  });

  describe('the ledger cannot be rewritten', () => {
    it('the database refuses to update or delete an entry, a negative balance and an entry without its origin', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const credit = await adjust(ctx.accessToken, c.id, 500).expect(200);

      await expect(prisma().cashbackEntry.update({ where: { id: credit.body.id }, data: { amountCents: 50_000 } })).rejects.toThrow(/append-only/);
      await expect(prisma().cashbackEntry.delete({ where: { id: credit.body.id } })).rejects.toThrow(/append-only/);
      await expect(prisma().cashbackAccount.update({ where: { customerId: c.id }, data: { balanceCents: -1 } })).rejects.toThrow();

      const stored = await prisma().cashbackAccount.findUniqueOrThrow({ where: { customerId: c.id } });
      const base = { tenantId: ctx.tenantId, accountId: stored.id, customerId: c.id, balanceAfterCents: 600 };
      await expect(prisma().cashbackEntry.create({ data: { ...base, type: 'ADJUSTMENT', amountCents: 0, reason: 'motivo' } })).rejects.toThrow();
      await expect(prisma().cashbackEntry.create({ data: { ...base, type: 'EARN', amountCents: 10 } })).rejects.toThrow();
      await expect(prisma().cashbackEntry.create({ data: { ...base, type: 'USE', amountCents: -10 } })).rejects.toThrow();
      await expect(prisma().cashbackEntry.create({ data: { ...base, type: 'EXPIRATION', amountCents: 10 } })).rejects.toThrow();
      await expect(prisma().cashbackEntry.create({ data: { ...base, type: 'ADJUSTMENT', amountCents: 10 } })).rejects.toThrow();
      await expect(prisma().cashbackEntry.create({ data: { ...base, type: 'ADJUSTMENT', amountCents: 10, reason: 'motivo', balanceAfterCents: -1 } })).rejects.toThrow();

      expect(await balance(ctx, c.id)).toBe(500);
      await expectLedgerConsistent(c.id);
    });
  });

  describe('audit is part of the transaction', () => {
    afterEach(() => removeAuditFailure(app, 'fail_audit_cashback_test'));

    it.each([
      ['CASHBACK_ADJUSTED', 'adjust'],
      ['CASHBACK_ENTRY_REVERSED', 'reverse'],
    ])('%s: when the audit cannot be written, nothing is written', async (action, operation) => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const credit = await adjust(ctx.accessToken, c.id, 100).expect(200);

      await injectAuditFailure(app, 'fail_audit_cashback_test', ctx.tenantId, action);
      const run = () => (operation === 'adjust' ? adjust(ctx.accessToken, c.id, 50) : reverse(ctx.accessToken, credit.body.id));
      await run().expect(500);
      expect(await prisma().cashbackEntry.count({ where: { customerId: c.id } })).toBe(1);
      expect(await balance(ctx, c.id)).toBe(100);

      await removeAuditFailure(app, 'fail_audit_cashback_test');
      await run().expect(200);
      await expectLedgerConsistent(c.id);
    });
  });

  describe('tenant isolation', () => {
    it('tenant A cannot read, adjust or reverse anything of tenant B, and each has its own program', async () => {
      const a = await setup();
      const b = await setup({ enabled: true, earnRateBps: 1000, expireAfterDays: 60 });
      const theirs = await newCustomer(b);
      const theirEntry = await adjust(b.accessToken, theirs.id, 900).expect(200);

      await get(a.accessToken, `/v1/cashback/customers/${theirs.id}`).expect(404);
      await get(a.accessToken, `/v1/cashback/customers/${theirs.id}/entries`).expect(404);
      await adjust(a.accessToken, theirs.id, 10).expect(404);
      await reverse(a.accessToken, theirEntry.body.id).expect(404);
      expect(await balance(b, theirs.id)).toBe(900);

      await put(a.accessToken, '/v1/cashback/program', { enabled: false, earnRateBps: 1, expireAfterDays: 1 }).expect(200);
      expect((await get(b.accessToken, '/v1/cashback/program').expect(200)).body).toEqual({ enabled: true, earnRateBps: 1000, expireAfterDays: 60 });
      // The bulk write-off of A never touches B.
      await prisma().cashbackAccount.update({ where: { customerId: theirs.id }, data: { lastActivityAt: new Date(Date.now() - 500 * DAY) } });
      await post(a.accessToken, '/v1/cashback/expire').expect(200);
      expect(await prisma().cashbackEntry.count({ where: { customerId: theirs.id, type: 'EXPIRATION' } })).toBe(0);
    });
  });

  describe('permissions (backend)', () => {
    it.each([
      // role, read, adjust/reverse, configure/expire
      ['OWNER', 200, 200, 200],
      ['ADMIN', 200, 200, 200],
      ['MANAGER', 200, 200, 403],
      ['CASHIER', 200, 403, 403],
      ['WAITER', 403, 403, 403],
      ['KITCHEN', 403, 403, 403],
      ['DELIVERY', 403, 403, 403],
      ['VIEWER', 403, 403, 403],
    ] as [RoleName, number, number, number][])('%s: read %i, adjust %i, configure %i', async (role, read, canAdjust, configure) => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const seed = await adjust(ctx.accessToken, c.id, 100).expect(200);
      const token = role === 'OWNER' ? ctx.accessToken : await createStaffAndLoginE2E(app, server, ctx.tenantId, role, [ctx.branchId]);

      await get(token, '/v1/cashback/program').expect(read);
      await get(token, `/v1/cashback/customers/${c.id}`).expect(read);
      await get(token, `/v1/cashback/customers/${c.id}/entries`).expect(read);
      await adjust(token, c.id, 5).expect(canAdjust);
      await reverse(token, seed.body.id).expect(canAdjust);
      await put(token, '/v1/cashback/program', { enabled: true, earnRateBps: 300, expireAfterDays: null }).expect(configure);
      await post(token, '/v1/cashback/expire').expect(configure);
    });

    it('every route needs a session', async () => {
      const id = '00000000-0000-4000-8000-000000000000';
      await request(server).get('/v1/cashback/program').expect(401);
      await request(server).put('/v1/cashback/program').send(PROGRAM).expect(401);
      await request(server).post('/v1/cashback/expire').expect(401);
      await request(server).get(`/v1/cashback/customers/${id}`).expect(401);
      await request(server).post(`/v1/cashback/customers/${id}/adjust`).send({}).expect(401);
      await request(server).post(`/v1/cashback/entries/${id}/reverse`).send({}).expect(401);
    });

    it('the permission matrix really stored in the database', async () => {
      const rows = await prisma().rolePermission.findMany({
        where: { permission: { key: { startsWith: 'cashback.' } } },
        select: { role: { select: { name: true } }, permission: { select: { key: true } } },
      });
      const byRole: Record<string, string[]> = {};
      for (const row of rows) (byRole[row.role.name] ??= []).push(row.permission.key);
      for (const role of Object.keys(byRole)) byRole[role].sort();
      const all = ['cashback.adjust', 'cashback.configure', 'cashback.read', 'cashback.use'];
      expect(byRole).toEqual({
        OWNER: all,
        ADMIN: all,
        MANAGER: ['cashback.adjust', 'cashback.read', 'cashback.use'],
        CASHIER: ['cashback.read', 'cashback.use'],
      });
    });
  });
});
