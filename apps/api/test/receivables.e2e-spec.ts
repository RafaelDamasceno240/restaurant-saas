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
import { seedLegacyReceivableE2E } from './legacy-fiado.util';

type Json = Record<string, unknown>;

// Fase 11, fatia 6 (1/2), after remocao-fiado (2026-11-12): fiado is no longer sold and no route
// grants credit or opens a debt. What exists from before stays settleable: payments (total and
// partial), reversal, cancellation, overdue, cash drawer, idempotency, concurrency, atomic audit,
// isolation and permissions. The debts are written by seedLegacyReceivableE2E (test code), with
// the rows the removed code wrote. The order side is in fiado-disabled.e2e-spec.ts.
describe('Receivables ledger (e2e)', () => {
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
  const key = () => `rcv-${uniqueSuffix()}`;

  let seq = 0;
  const phone = () => `111${String(Date.now() + ++seq).slice(-8)}`;

  // The restaurant's calendar day (default zone America/Sao_Paulo), as the API computes it.
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const shift = (day: string, days: number) => {
    const date = new Date(`${day}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };

  const setup = () => registerTenantE2E(server);
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const newCustomer = async (ctx: Ctx, name = 'Maria Souza') =>
    (await post(ctx.accessToken, '/v1/customers', { name, phone: phone() }).expect(201)).body as { id: string };

  // A debt from before the change, with the call shape the tests always used: charge(...).expect(201)
  // gives the receivable as GET /v1/receivables/:id shows it.
  const charge = (_token: string, ctx: Ctx, customerId: string, totalCents: number, extra: Json = {}) => ({
    expect: async (status: number) => {
      if (status !== 201) throw new Error('a legacy debt is always written');
      const id = await seedLegacyReceivableE2E(app, {
        tenantId: ctx.tenantId,
        branchId: (extra.branchId as string | undefined) ?? ctx.branchId,
        customerId,
        totalCents,
        installments: (extra.installments as number | undefined) ?? 1,
        firstDueDate: (extra.firstDueDate as string | undefined) ?? shift(today(), 30),
        description: extra.description as string | undefined,
      });
      return get(ctx.accessToken, `/v1/receivables/${id}`).expect(200);
    },
  });
  const pay = (token: string, ctx: Ctx, receivableId: string, amountCents: number, extra: Json = {}) =>
    post(token, `/v1/receivables/${receivableId}/payments`, { amountCents, method: 'PIX', branchId: ctx.branchId, idempotencyKey: key(), ...extra });
  const reverse = (token: string, entryId: string, extra: Json = {}) =>
    post(token, `/v1/receivables/entries/${entryId}/reverse`, { reason: 'Estorno de teste', idempotencyKey: key(), ...extra });
  const account = async (ctx: Ctx, customerId: string) =>
    (await get(ctx.accessToken, `/v1/receivables/customers/${customerId}`).expect(200)).body as {
      customerId: string;
      balanceCents: number;
      overdueCents: number;
    };
  const openCash = (ctx: Ctx, openingBalanceCents = 0) =>
    post(ctx.accessToken, '/v1/cash/sessions', { branchId: ctx.branchId, openingBalanceCents }).expect(201).then((res) => res.body as { id: string });

  // The invariants of the whole module, straight from the database: the customer's debt is the
  // sum of the ledger; each receivable's paid amount is the sum of what its live payments
  // allocated; installments add up to the total and are never paid beyond their amount.
  async function expectLedgerConsistent(customerId: string) {
    const stored = await prisma().creditAccount.findUnique({ where: { customerId } });
    const entries = await prisma().receivableEntry.findMany({ where: { customerId }, include: { reversal: true, allocations: true } });
    expect(stored?.balanceCents ?? 0).toBe(entries.reduce((total, entry) => total + entry.amountCents, 0));
    expect(entries.every((entry) => entry.balanceAfterCents >= 0)).toBe(true);

    const receivables = await prisma().receivable.findMany({ where: { customerId }, include: { installments: true } });
    let debt = 0;
    for (const receivable of receivables) {
      const livePayments = entries.filter((entry) => entry.receivableId === receivable.id && entry.type === 'PAYMENT' && !entry.reversal);
      const paid = livePayments.reduce((total, entry) => total - entry.amountCents, 0);
      expect(receivable.paidCents).toBe(paid);
      expect(receivable.installments.reduce((total, i) => total + i.amountCents, 0)).toBe(receivable.totalCents);
      expect(receivable.installments.reduce((total, i) => total + i.paidCents, 0)).toBe(paid);
      for (const installment of receivable.installments) {
        const allocated = livePayments.flatMap((entry) => entry.allocations).filter((a) => a.installmentId === installment.id);
        expect(installment.paidCents).toBe(allocated.reduce((total, a) => total + a.amountCents, 0));
        expect(installment.paidCents).toBeLessThanOrEqual(installment.amountCents);
      }
      expect(receivable.status).toBe(receivable.status === 'CANCELLED' ? 'CANCELLED' : paid === receivable.totalCents ? 'PAID' : 'OPEN');
      if (receivable.status !== 'CANCELLED') debt += receivable.totalCents - paid;
    }
    expect(stored?.balanceCents ?? 0).toBe(debt);
  }

  describe('no new fiado', () => {
    it('the account shows only what is owed; no route grants credit or opens a debt', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      expect(await account(ctx, c.id)).toEqual({ customerId: c.id, balanceCents: 0, overdueCents: 0 });
      await put(ctx.accessToken, `/v1/receivables/customers/${c.id}/limit`, { creditLimitCents: 50_000 }).expect(404);
      await post(ctx.accessToken, '/v1/receivables', {
        customerId: c.id,
        branchId: ctx.branchId,
        description: 'Saldo anterior do caderno',
        totalCents: 12_000,
        installments: 1,
        firstDueDate: shift(today(), 30),
        idempotencyKey: key(),
      }).expect(404);
      expect(await prisma().receivable.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect(await prisma().creditAccount.count({ where: { customerId: c.id } })).toBe(0);
    });

    it('a debt from before keeps its installments and is owed in full', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const first = shift(today(), 5);
      const r = (await charge(ctx.accessToken, ctx, c.id, 10_000, { installments: 3, firstDueDate: first }).expect(201)).body;
      expect(r).toMatchObject({ totalCents: 10_000, paidCents: 0, status: 'OPEN' });
      expect(r.installments.map((i: { amountCents: number }) => i.amountCents)).toEqual([3_334, 3_333, 3_333]);
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 10_000, overdueCents: 0 });
      await expectLedgerConsistent(c.id);
    });
  });

  describe('payments', () => {
    it('a total payment settles the receivable and clears the debt', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const r = (await charge(ctx.accessToken, ctx, c.id, 8_000).expect(201)).body;

      const paid = await pay(ctx.accessToken, ctx, r.id, 8_000).expect(200);
      expect(paid.body).toMatchObject({ status: 'PAID', paidCents: 8_000, openCents: 0, nextDueDate: null, idempotentReplay: false });
      expect(paid.body.settledAt).not.toBeNull();
      expect(paid.body.entries[0]).toMatchObject({ type: 'PAYMENT', amountCents: -8_000, balanceAfterCents: 0, paymentMethod: 'PIX', allocations: [{ installmentNumber: 1, amountCents: 8_000 }] });
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 0 });

      expect((await pay(ctx.accessToken, ctx, r.id, 1).expect(409)).body.code).toBe('RECEIVABLE_NOT_OPEN');
      await expectLedgerConsistent(c.id);
    });

    it('partial payments pay the installment due first, then the next, and never more than what is open', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const r = (await charge(ctx.accessToken, ctx, c.id, 9_000, { installments: 3, firstDueDate: shift(today(), 1) }).expect(201)).body;

      const first = await pay(ctx.accessToken, ctx, r.id, 1_000).expect(200);
      expect(first.body.installments.map((i: { paidCents: number }) => i.paidCents)).toEqual([1_000, 0, 0]);
      const second = await pay(ctx.accessToken, ctx, r.id, 4_500).expect(200);
      expect(second.body.installments.map((i: { paidCents: number }) => i.paidCents)).toEqual([3_000, 2_500, 0]);
      expect(second.body).toMatchObject({ status: 'OPEN', paidCents: 5_500, openCents: 3_500 });
      expect(second.body.entries[0].allocations).toEqual([
        { installmentNumber: 1, amountCents: 2_000 },
        { installmentNumber: 2, amountCents: 2_500 },
      ]);

      const tooMuch = await pay(ctx.accessToken, ctx, r.id, 3_501).expect(409);
      expect(tooMuch.body).toMatchObject({ code: 'RECEIVABLE_OVERPAYMENT', details: { openCents: 3_500 } });
      const last = await pay(ctx.accessToken, ctx, r.id, 3_500).expect(200);
      expect(last.body.status).toBe('PAID');
      await expectLedgerConsistent(c.id);
    });

    it('can pay one chosen installment, limited to what that installment owes', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const r = (await charge(ctx.accessToken, ctx, c.id, 6_000, { installments: 3, firstDueDate: shift(today(), 1) }).expect(201)).body;
      const third = r.installments[2].id as string;

      const paid = await pay(ctx.accessToken, ctx, r.id, 2_000, { installmentId: third }).expect(200);
      expect(paid.body.installments.map((i: { paidCents: number }) => i.paidCents)).toEqual([0, 0, 2_000]);
      expect((await pay(ctx.accessToken, ctx, r.id, 1, { installmentId: third }).expect(409)).body.code).toBe('RECEIVABLE_OVERPAYMENT');
      expect((await pay(ctx.accessToken, ctx, r.id, 100, { installmentId: '00000000-0000-4000-8000-000000000000' }).expect(404)).body.code).toBe('RECEIVABLE_INSTALLMENT_NOT_FOUND');
      await expectLedgerConsistent(c.id);
    });

    it('accepts only real money, whole cents, and nothing else from the client', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const r = (await charge(ctx.accessToken, ctx, c.id, 5_000).expect(201)).body;
      for (const extra of [
        { method: 'ON_ACCOUNT' },
        { method: 'CASHBACK' },
        { amountCents: 0 },
        { amountCents: -100 },
        { amountCents: 10.5 },
        { paidCents: 5_000 },
        { status: 'PAID' },
        { tenantId: ctx.tenantId },
        { idempotencyKey: 'a b' },
      ]) {
        await pay(ctx.accessToken, ctx, r.id, 100, extra).expect(400);
      }
      await post(ctx.accessToken, `/v1/receivables/${r.id}/payments`, { amountCents: 100, method: 'PIX', branchId: ctx.branchId }).expect(400);
      expect((await get(ctx.accessToken, `/v1/receivables/${r.id}`).expect(200)).body.paidCents).toBe(0);
    });
  });

  describe('cash drawer', () => {
    it('a cash payment needs an open session and goes into it; PIX and card never touch the drawer', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const r = (await charge(ctx.accessToken, ctx, c.id, 10_000).expect(201)).body;

      const closed = await pay(ctx.accessToken, ctx, r.id, 1_000, { method: 'CASH' }).expect(409);
      expect(closed.body.code).toBe('CASH_REGISTER_NOT_OPEN');
      expect((await get(ctx.accessToken, `/v1/receivables/${r.id}`).expect(200)).body.paidCents).toBe(0);

      const session = await openCash(ctx, 2_000);
      await pay(ctx.accessToken, ctx, r.id, 4_000, { method: 'CASH' }).expect(200);
      await pay(ctx.accessToken, ctx, r.id, 1_500, { method: 'PIX' }).expect(200);
      await pay(ctx.accessToken, ctx, r.id, 500, { method: 'CARD' }).expect(200);

      const detail = await get(ctx.accessToken, `/v1/cash/sessions/${session.id}`).expect(200);
      expect(detail.body.totals).toMatchObject({ receivablePaymentsCents: 4_000, receivableRefundsCents: 0, salesCents: 0 });
      expect(detail.body.expectedBalanceCents).toBe(6_000);
      expect(detail.body.movements).toEqual([expect.objectContaining({ type: 'RECEIVABLE_PAYMENT', amountCents: 4_000 })]);

      const entry = await prisma().receivableEntry.findFirstOrThrow({ where: { receivableId: r.id, paymentMethod: 'CASH' } });
      expect(entry.cashMovementId).toBe(detail.body.movements[0].id);
      await expectLedgerConsistent(c.id);
    });

    it('reversing a cash payment takes the money out of the open drawer, and the closing still adds up', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const r = (await charge(ctx.accessToken, ctx, c.id, 10_000).expect(201)).body;
      const session = await openCash(ctx, 1_000);
      const paid = await pay(ctx.accessToken, ctx, r.id, 3_000, { method: 'CASH' }).expect(200);
      const entryId = paid.body.entryId as string;

      expect((await reverse(ctx.accessToken, entryId).expect(400)).body.code).toBe('RECEIVABLE_REFUND_BRANCH_REQUIRED');
      await reverse(ctx.accessToken, entryId, { branchId: ctx.branchId }).expect(200);

      const detail = await get(ctx.accessToken, `/v1/cash/sessions/${session.id}`).expect(200);
      expect(detail.body.totals).toMatchObject({ receivablePaymentsCents: 3_000, receivableRefundsCents: 3_000 });
      const closedSession = await patch(ctx.accessToken, `/v1/cash/sessions/${session.id}/close`, { countedClosingBalanceCents: 1_000 }).expect(200);
      expect(closedSession.body).toMatchObject({ expectedBalanceCents: 1_000, differenceCents: 0 });
      await expectLedgerConsistent(c.id);
    });

    it('the manual cash movement endpoint cannot create receivable movements', async () => {
      const ctx = await setup();
      const session = await openCash(ctx);
      for (const type of ['RECEIVABLE_PAYMENT', 'RECEIVABLE_REFUND']) {
        await post(ctx.accessToken, `/v1/cash/sessions/${session.id}/movements`, { type, amountCents: 5_000, reason: 'tentativa' }).expect(400);
      }
    });
  });

  describe('reversal and cancellation', () => {
    it('reversing a payment reopens exactly the installments it paid and brings the debt back', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const r = (await charge(ctx.accessToken, ctx, c.id, 6_000, { installments: 2, firstDueDate: shift(today(), 1) }).expect(201)).body;
      await pay(ctx.accessToken, ctx, r.id, 3_500).expect(200); // 3000 + 500
      const settle = await pay(ctx.accessToken, ctx, r.id, 2_500).expect(200);
      expect(settle.body.status).toBe('PAID');

      const undone = await reverse(ctx.accessToken, settle.body.entryId, { reason: 'Pix devolvido pelo banco' }).expect(200);
      expect(undone.body).toMatchObject({ status: 'OPEN', paidCents: 3_500, openCents: 2_500, settledAt: null });
      expect(undone.body.installments.map((i: { paidCents: number }) => i.paidCents)).toEqual([3_000, 500]);
      expect(undone.body.entries[0]).toMatchObject({ type: 'REVERSAL', amountCents: 2_500, reason: 'Pix devolvido pelo banco', paymentMethod: null });
      expect(undone.body.entries[1]).toMatchObject({ type: 'PAYMENT', reversed: true });
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 2_500 });

      expect((await reverse(ctx.accessToken, settle.body.entryId).expect(409)).body.code).toBe('RECEIVABLE_ENTRY_ALREADY_REVERSED');
      expect((await reverse(ctx.accessToken, undone.body.entryId).expect(409)).body.code).toBe('RECEIVABLE_ENTRY_NOT_REVERSIBLE');
      const chargeEntry = undone.body.entries.find((e: { type: string }) => e.type === 'CHARGE');
      expect((await reverse(ctx.accessToken, chargeEntry.id).expect(409)).body.code).toBe('RECEIVABLE_ENTRY_NOT_REVERSIBLE');
      await expectLedgerConsistent(c.id);
    });

    it('a receivable without payments can be cancelled, with a reason, once; with payments it cannot', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const clean = (await charge(ctx.accessToken, ctx, c.id, 4_000).expect(201)).body;
      const partly = (await charge(ctx.accessToken, ctx, c.id, 6_000).expect(201)).body;
      await pay(ctx.accessToken, ctx, partly.id, 1_000).expect(200);

      await post(ctx.accessToken, `/v1/receivables/${clean.id}/cancel`, {}).expect(400);
      const cancelled = await post(ctx.accessToken, `/v1/receivables/${clean.id}/cancel`, { reason: 'Lançada em duplicidade' }).expect(200);
      expect(cancelled.body).toMatchObject({ status: 'CANCELLED', openCents: 0, cancelReason: 'Lançada em duplicidade' });
      expect(cancelled.body.entries[0]).toMatchObject({ type: 'REVERSAL', amountCents: -4_000 });
      // Cancelling again changes nothing and writes nothing.
      await post(ctx.accessToken, `/v1/receivables/${clean.id}/cancel`, { reason: 'De novo' }).expect(200);
      expect(await prisma().receivableEntry.count({ where: { receivableId: clean.id } })).toBe(2);
      expect((await pay(ctx.accessToken, ctx, clean.id, 100).expect(409)).body.code).toBe('RECEIVABLE_NOT_OPEN');

      expect((await post(ctx.accessToken, `/v1/receivables/${partly.id}/cancel`, { reason: 'Tentativa' }).expect(409)).body.code).toBe('RECEIVABLE_HAS_PAYMENTS');
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 5_000 });
      await expectLedgerConsistent(c.id);
    });
  });

  describe('overdue', () => {
    // Moves the due dates of a receivable (installments are not the ledger).
    const dueOn = (receivableId: string, number: number, day: string) =>
      prisma().receivableInstallment.updateMany({ where: { receivableId, number }, data: { dueDate: new Date(`${day}T00:00:00.000Z`) } });

    it('an installment is overdue only after its due date, only while it owes, and paying it clears the delay', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const r = (await charge(ctx.accessToken, ctx, c.id, 6_000, { installments: 2, firstDueDate: today() }).expect(201)).body;
      expect((await get(ctx.accessToken, `/v1/receivables/${r.id}`).expect(200)).body).toMatchObject({ overdue: false, overdueCents: 0, daysOverdue: 0 });

      await dueOn(r.id, 1, shift(today(), -10));
      const late = (await get(ctx.accessToken, `/v1/receivables/${r.id}`).expect(200)).body;
      expect(late).toMatchObject({ overdue: true, overdueCents: 3_000, openCents: 6_000, daysOverdue: 10, nextDueDate: shift(today(), -10) });
      expect(late.installments.map((i: { overdue: boolean }) => i.overdue)).toEqual([true, false]);
      expect(await account(ctx, c.id)).toMatchObject({ overdueCents: 3_000 });

      await pay(ctx.accessToken, ctx, r.id, 1_000).expect(200);
      expect((await get(ctx.accessToken, `/v1/receivables/${r.id}`).expect(200)).body.overdueCents).toBe(2_000);
      await pay(ctx.accessToken, ctx, r.id, 2_000).expect(200);
      expect((await get(ctx.accessToken, `/v1/receivables/${r.id}`).expect(200)).body).toMatchObject({ overdue: false, overdueCents: 0, openCents: 3_000 });
    });

    it('the list filters open, overdue, paid and cancelled, and the totals describe what is open', async () => {
      const ctx = await setup();
      const a = await newCustomer(ctx, 'Ana Devedora');
      const b = await newCustomer(ctx, 'Bia Em Dia');
      const late = (await charge(ctx.accessToken, ctx, a.id, 5_000, { description: 'Conta atrasada' }).expect(201)).body;
      const onTime = (await charge(ctx.accessToken, ctx, b.id, 3_000, { description: 'Conta em dia' }).expect(201)).body;
      const paid = (await charge(ctx.accessToken, ctx, b.id, 2_000, { description: 'Conta quitada' }).expect(201)).body;
      const cancelled = (await charge(ctx.accessToken, ctx, b.id, 1_000, { description: 'Conta cancelada' }).expect(201)).body;
      await dueOn(late.id, 1, shift(today(), -3));
      await pay(ctx.accessToken, ctx, late.id, 1_200).expect(200);
      await pay(ctx.accessToken, ctx, paid.id, 2_000).expect(200);
      await post(ctx.accessToken, `/v1/receivables/${cancelled.id}/cancel`, { reason: 'Engano' }).expect(200);

      const ids = async (query: string) => ((await get(ctx.accessToken, `/v1/receivables${query}`).expect(200)).body.data as { id: string }[]).map((row) => row.id).sort();
      expect(await ids('')).toEqual([late.id, onTime.id].sort());
      expect(await ids('?status=overdue')).toEqual([late.id]);
      expect(await ids('?status=paid')).toEqual([paid.id]);
      expect(await ids('?status=cancelled')).toEqual([cancelled.id]);
      expect(await ids('?status=all')).toHaveLength(4);
      expect(await ids(`?status=all&customerId=${a.id}`)).toEqual([late.id]);
      expect(await ids('?status=all&search=quitada')).toEqual([paid.id]);
      expect(await ids('?status=all&search=ana dev')).toEqual([late.id]);
      expect(await ids(`?status=all&search=${encodeURIComponent("' OR 1=1 --")}`)).toEqual([]);
      await get(ctx.accessToken, '/v1/receivables?status=late').expect(400);

      const listed = (await get(ctx.accessToken, '/v1/receivables').expect(200)).body;
      expect(listed.summary).toEqual({ openCents: 6_800, openCount: 2, overdueCents: 3_800, overdueCount: 1, customersInDebt: 2 });
      expect(listed.today).toBe(today());
      expect(JSON.stringify(listed)).not.toMatch(/tenantId/);
    });

    it('paginates newest first without overlap', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      for (let i = 1; i <= 5; i++) await charge(ctx.accessToken, ctx, c.id, i * 100, { description: `Conta ${i}` }).expect(201);
      const seen: number[] = [];
      for (let page = 1; page <= 3; page++) {
        const result = (await get(ctx.accessToken, `/v1/receivables?pageSize=2&page=${page}`).expect(200)).body;
        expect(result.meta).toMatchObject({ total: 5, totalPages: 3 });
        seen.push(...result.data.map((row: { totalCents: number }) => row.totalCents));
      }
      expect(seen).toEqual([500, 400, 300, 200, 100]);
    });
  });

  describe('concurrency and idempotency', () => {
    it('twenty simultaneous payments of 100 against 350 open: three land, the rest are refused, never overpaid', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const r = (await charge(ctx.accessToken, ctx, c.id, 350).expect(201)).body;

      const results = await Promise.all(Array.from({ length: 20 }, () => pay(ctx.accessToken, ctx, r.id, 100)));
      const statuses = results.map((res) => res.status);
      expect(statuses.filter((s) => s === 200)).toHaveLength(3);
      expect(statuses.filter((s) => s === 409)).toHaveLength(17);
      expect(results.filter((res) => res.status === 409).every((res) => res.body.code === 'RECEIVABLE_OVERPAYMENT')).toBe(true);

      const final = (await get(ctx.accessToken, `/v1/receivables/${r.id}`).expect(200)).body;
      expect(final).toMatchObject({ status: 'OPEN', paidCents: 300, openCents: 50 });
      await expectLedgerConsistent(c.id);
    });

    it('simultaneous cash payments are serialized with the drawer and all recorded once', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const r = (await charge(ctx.accessToken, ctx, c.id, 10_000).expect(201)).body;
      const session = await openCash(ctx);

      const results = await Promise.all(Array.from({ length: 8 }, () => pay(ctx.accessToken, ctx, r.id, 1_000, { method: 'CASH' })));
      expect(results.every((res) => res.status === 200)).toBe(true);
      const detail = await get(ctx.accessToken, `/v1/cash/sessions/${session.id}`).expect(200);
      expect(detail.body.totals.receivablePaymentsCents).toBe(8_000);
      expect(detail.body.movements).toHaveLength(8);
      expect((await get(ctx.accessToken, `/v1/receivables/${r.id}`).expect(200)).body.paidCents).toBe(8_000);
      await expectLedgerConsistent(c.id);
    });

    it('the same key returns the same payment, under simultaneous duplicates too, and never pays twice', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const r = (await charge(ctx.accessToken, ctx, c.id, 1_000).expect(201)).body;
      const k = key();

      const results = await Promise.all(Array.from({ length: 6 }, () => pay(ctx.accessToken, ctx, r.id, 1_000, { idempotencyKey: k })));
      expect(results.map((res) => res.status)).toEqual(Array(6).fill(200));
      expect(results.filter((res) => res.body.idempotentReplay === false)).toHaveLength(1);
      expect(await prisma().receivableEntry.count({ where: { receivableId: r.id, type: 'PAYMENT' } })).toBe(1);

      // Later: the receivable is already paid, the cash drawer is closed - a retry still answers.
      const retry = await pay(ctx.accessToken, ctx, r.id, 1_000, { idempotencyKey: k }).expect(200);
      expect(retry.body).toMatchObject({ status: 'PAID', idempotentReplay: true });
      expect((await pay(ctx.accessToken, ctx, r.id, 999, { idempotencyKey: k }).expect(409)).body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      await expectLedgerConsistent(c.id);
    });

    it('six simultaneous reversals of one payment reverse it once', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const r = (await charge(ctx.accessToken, ctx, c.id, 2_000).expect(201)).body;
      const paid = await pay(ctx.accessToken, ctx, r.id, 2_000).expect(200);
      const results = await Promise.all(Array.from({ length: 6 }, () => reverse(ctx.accessToken, paid.body.entryId)));
      expect(results.map((res) => res.status).sort()).toEqual([200, 409, 409, 409, 409, 409]);
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 2_000 });
      await expectLedgerConsistent(c.id);
    });
  });

  describe('the ledger cannot be rewritten', () => {
    it('the database refuses edits and deletions of entries and allocations, and impossible states', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const r = (await charge(ctx.accessToken, ctx, c.id, 5_000).expect(201)).body;
      const paid = await pay(ctx.accessToken, ctx, r.id, 1_000).expect(200);
      const entryId = paid.body.entryId as string;

      await expect(prisma().receivableEntry.update({ where: { id: entryId }, data: { amountCents: -5_000 } })).rejects.toThrow(/append-only/);
      await expect(prisma().receivableEntry.delete({ where: { id: entryId } })).rejects.toThrow(/append-only/);
      await expect(prisma().receivablePaymentAllocation.deleteMany({ where: { entryId } })).rejects.toThrow(/append-only/);
      await expect(prisma().receivablePaymentAllocation.updateMany({ where: { entryId }, data: { amountCents: 1 } })).rejects.toThrow(/append-only/);

      // paid beyond the total; PAID without being paid; a negative debt; an installment overpaid.
      await expect(prisma().receivable.update({ where: { id: r.id }, data: { paidCents: 5_001 } })).rejects.toThrow();
      await expect(prisma().receivable.update({ where: { id: r.id }, data: { status: 'PAID' } })).rejects.toThrow();
      await expect(prisma().receivable.update({ where: { id: r.id }, data: { status: 'CANCELLED', cancelReason: 'motivo' } })).rejects.toThrow();
      await expect(prisma().creditAccount.update({ where: { customerId: c.id }, data: { balanceCents: -1 } })).rejects.toThrow();
      await expect(prisma().receivableInstallment.updateMany({ where: { receivableId: r.id }, data: { paidCents: 5_001 } })).rejects.toThrow();

      const stored = await prisma().creditAccount.findUniqueOrThrow({ where: { customerId: c.id } });
      const base = { tenantId: ctx.tenantId, accountId: stored.id, customerId: c.id, receivableId: r.id, balanceAfterCents: 1, createdByUserId: paid.body.entries[0].createdBy.id as string };
      // a payment without a method, a payment "on account", a charge with a method, a reversal without its target.
      await expect(prisma().receivableEntry.create({ data: { ...base, type: 'PAYMENT', amountCents: -1 } })).rejects.toThrow();
      await expect(prisma().receivableEntry.create({ data: { ...base, type: 'PAYMENT', amountCents: -1, paymentMethod: 'ON_ACCOUNT' } })).rejects.toThrow();
      await expect(prisma().receivableEntry.create({ data: { ...base, type: 'CHARGE', amountCents: 1, paymentMethod: 'PIX' } })).rejects.toThrow();
      await expect(prisma().receivableEntry.create({ data: { ...base, type: 'REVERSAL', amountCents: 1, reason: 'motivo' } })).rejects.toThrow();
      await expect(prisma().receivableEntry.create({ data: { ...base, type: 'CHARGE', amountCents: 0 } })).rejects.toThrow();

      await expectLedgerConsistent(c.id);
    });
  });

  describe('audit is part of the transaction', () => {
    afterEach(() => removeAuditFailure(app, 'fail_audit_receivables_test'));

    it.each([
      ['RECEIVABLE_PAYMENT_RECORDED', 'pay'],
      ['RECEIVABLE_PAYMENT_REVERSED', 'reverse'],
      ['RECEIVABLE_CANCELLED', 'cancel'],
    ])('%s: when the audit cannot be written, nothing is written (cash drawer included)', async (action, operation) => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const session = await openCash(ctx);
      const paidOne = (await charge(ctx.accessToken, ctx, c.id, 3_000).expect(201)).body;
      const payment = await pay(ctx.accessToken, ctx, paidOne.id, 1_000, { method: 'CASH' }).expect(200);
      const clean = (await charge(ctx.accessToken, ctx, c.id, 2_000).expect(201)).body;
      const before = {
        entries: await prisma().receivableEntry.count({ where: { customerId: c.id } }),
        receivables: await prisma().receivable.count({ where: { customerId: c.id } }),
        movements: await prisma().cashMovement.count({ where: { sessionId: session.id } }),
      };

      await injectAuditFailure(app, 'fail_audit_receivables_test', ctx.tenantId, action);
      const run = () =>
        operation === 'pay'
          ? pay(ctx.accessToken, ctx, paidOne.id, 500, { method: 'CASH' })
          : operation === 'reverse'
            ? reverse(ctx.accessToken, payment.body.entryId, { branchId: ctx.branchId })
            : post(ctx.accessToken, `/v1/receivables/${clean.id}/cancel`, { reason: 'Engano' });
      await run().expect(500);

      expect({
        entries: await prisma().receivableEntry.count({ where: { customerId: c.id } }),
        receivables: await prisma().receivable.count({ where: { customerId: c.id } }),
        movements: await prisma().cashMovement.count({ where: { sessionId: session.id } }),
      }).toEqual(before);
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 4_000 });
      await expectLedgerConsistent(c.id);

      await removeAuditFailure(app, 'fail_audit_receivables_test');
      const ok = await run();
      expect([200, 201]).toContain(ok.status);
      await expectLedgerConsistent(c.id);
    });
  });

  describe('isolation', () => {
    it('tenant A cannot see, pay, reverse or cancel anything of tenant B', async () => {
      const a = await setup();
      const b = await setup();
      const theirs = await newCustomer(b);
      const r = (await charge(b.accessToken, b, theirs.id, 5_000).expect(201)).body;
      const payment = await pay(b.accessToken, b, r.id, 1_000).expect(200);

      await get(a.accessToken, `/v1/receivables/${r.id}`).expect(404);
      await get(a.accessToken, `/v1/receivables/customers/${theirs.id}`).expect(404);
      await pay(a.accessToken, a, r.id, 100).expect(404);
      await reverse(a.accessToken, payment.body.entryId).expect(404);
      await post(a.accessToken, `/v1/receivables/${r.id}/cancel`, { reason: 'Tentativa' }).expect(404);
      // ...nor register a payment of my receivable at their branch.
      const mine = await newCustomer(a);
      const myReceivable = (await charge(a.accessToken, a, mine.id, 1_000).expect(201)).body;
      await pay(a.accessToken, a, myReceivable.id, 100, { branchId: b.branchId }).expect(404);

      const listed = (await get(a.accessToken, '/v1/receivables?status=all').expect(200)).body;
      expect(listed.data.map((row: { id: string }) => row.id)).toEqual([myReceivable.id]);
      expect(listed.summary).toMatchObject({ openCents: 1_000, customersInDebt: 1 });
      expect((await get(b.accessToken, `/v1/receivables/${r.id}`).expect(200)).body.paidCents).toBe(1_000);
    });

    it('a branch-limited user sees and operates only the receivables of their branches', async () => {
      const ctx = await setup();
      const second = await prisma().branch.create({ data: { tenantId: ctx.tenantId, name: 'Filial', code: 'FILIAL' } });
      const manager = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'MANAGER', [second.id]);
      const c = await newCustomer(ctx);
      const matriz = (await charge(ctx.accessToken, ctx, c.id, 4_000).expect(201)).body;
      const filial = (await charge(ctx.accessToken, ctx, c.id, 2_000, { branchId: second.id }).expect(201)).body;

      const listed = (await get(manager, '/v1/receivables').expect(200)).body;
      expect(listed.data.map((row: { id: string }) => row.id)).toEqual([filial.id]);
      expect(listed.summary).toMatchObject({ openCents: 2_000, openCount: 1 });
      await get(manager, `/v1/receivables/${matriz.id}`).expect(404);
      await pay(manager, ctx, matriz.id, 100, { branchId: second.id }).expect(404);
      await get(manager, `/v1/receivables?branchId=${ctx.branchId}`).expect(403);
      await pay(manager, ctx, filial.id, 500, { branchId: second.id }).expect(200);
      // The customer's debt is the customer's, whatever the branch.
      expect((await get(manager, `/v1/receivables/customers/${c.id}`).expect(200)).body.balanceCents).toBe(5_500);
    });
  });

  describe('permissions (backend)', () => {
    it.each([
      // role, read, receive payment, manage (reverse, cancel)
      ['OWNER', 200, 200, 200],
      ['ADMIN', 200, 200, 200],
      ['MANAGER', 200, 200, 200],
      ['CASHIER', 200, 200, 403],
      ['WAITER', 403, 403, 403],
      ['KITCHEN', 403, 403, 403],
      ['DELIVERY', 403, 403, 403],
      ['VIEWER', 403, 403, 403],
    ] as [RoleName, number, number, number][])('%s: read %i, receive %i, manage %i', async (role, read, receive, manage) => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const r = (await charge(ctx.accessToken, ctx, c.id, 5_000).expect(201)).body;
      const seedPayment = await pay(ctx.accessToken, ctx, r.id, 500).expect(200);
      const spare = (await charge(ctx.accessToken, ctx, c.id, 700).expect(201)).body;
      const token = role === 'OWNER' ? ctx.accessToken : await createStaffAndLoginE2E(app, server, ctx.tenantId, role, [ctx.branchId]);

      await get(token, '/v1/receivables').expect(read);
      await get(token, `/v1/receivables/${r.id}`).expect(read);
      await get(token, `/v1/receivables/customers/${c.id}`).expect(read);
      await pay(token, ctx, r.id, 100).expect(receive);
      await reverse(token, seedPayment.body.entryId).expect(manage);
      await post(token, `/v1/receivables/${spare.id}/cancel`, { reason: 'Teste de permissão' }).expect(manage);
    });

    it('every route needs a session', async () => {
      const id = '00000000-0000-4000-8000-000000000000';
      await request(server).get('/v1/receivables').expect(401);
      await request(server).get(`/v1/receivables/${id}`).expect(401);
      await request(server).get(`/v1/receivables/customers/${id}`).expect(401);
      await request(server).post(`/v1/receivables/${id}/payments`).send({}).expect(401);
      await request(server).post(`/v1/receivables/${id}/cancel`).send({}).expect(401);
      await request(server).post(`/v1/receivables/entries/${id}/reverse`).send({}).expect(401);
    });

    it('the permission matrix really stored in the database', async () => {
      const rows = await prisma().rolePermission.findMany({
        where: { permission: { key: { startsWith: 'receivables.' } } },
        select: { role: { select: { name: true } }, permission: { select: { key: true } } },
      });
      const byRole: Record<string, string[]> = {};
      for (const row of rows) (byRole[row.role.name] ??= []).push(row.permission.key);
      for (const role of Object.keys(byRole)) byRole[role].sort();
      // receivables.sell (selling on account) is gone from the matrix (remocao-fiado).
      const all = ['receivables.manage', 'receivables.read', 'receivables.receive'];
      expect(byRole).toEqual({ OWNER: all, ADMIN: all, MANAGER: all, CASHIER: ['receivables.read', 'receivables.receive'] });
    });
  });
});
