import { INestApplication } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import request from 'supertest';
import {
  createActiveProductE2E,
  createStaffAndLoginE2E,
  createTestApp,
  getPrisma,
  injectAuditFailure,
  registerTenantE2E,
  removeAuditFailure,
  uniqueSuffix,
  statusBody,
  roundBody,
} from './test-app.util';

type Json = Record<string, unknown>;

// Fase 11, fatia 6 (2/2): selling ON ACCOUNT (fiado) in the order flows. The sale opens the
// customer's debt in the transaction that creates the order, against the locked credit account;
// a cancelled order takes its debt with it; nothing is received, so nothing reaches the drawer.
describe('Receivables x orders (e2e)', () => {
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
  const key = () => `rco-${uniqueSuffix()}`;

  let seq = 0;
  const phone = () => `113${String(Date.now() + ++seq).slice(-8)}`;
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const shift = (day: string, days: number) => {
    const date = new Date(`${day}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };

  // Burger R$ 40,00 (4000 cents).
  async function setup() {
    const tenant = await registerTenantE2E(server);
    const product = await createActiveProductE2E(server, tenant.accessToken, `Burger ${uniqueSuffix()}`, 40);
    return { ...tenant, product };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  // A customer allowed to buy on account up to `limitCents` (0 = not allowed).
  async function newCustomer(ctx: Ctx, limitCents = 20_000, name = 'Maria Souza') {
    const customer = (await post(ctx.accessToken, '/v1/customers', { name, phone: phone() }).expect(201)).body as { id: string };
    if (limitCents > 0) await put(ctx.accessToken, `/v1/receivables/customers/${customer.id}/limit`, { creditLimitCents: limitCents }).expect(200);
    return customer;
  }

  const pdvAs = (token: string, ctx: Ctx, extra: Json = {}, quantity = 1) =>
    post(token, '/v1/pos/orders', {
      branchId: ctx.branchId,
      items: [{ productId: ctx.product.id, quantity }],
      paymentMethod: 'ON_ACCOUNT',
      ...extra,
    });
  const pdv = (ctx: Ctx, extra: Json = {}, quantity = 1) => pdvAs(ctx.accessToken, ctx, extra, quantity);

  async function openTab(ctx: Ctx, quantity = 1, number = 1) {
    const table = (await post(ctx.accessToken, '/v1/tables', { branchId: ctx.branchId, number }).expect(201)).body;
    const tab = (await post(ctx.accessToken, '/v1/tabs', { branchId: ctx.branchId, tableId: table.id }).expect(201)).body;
    await post(ctx.accessToken, `/v1/tabs/${tab.id}/rounds`, roundBody([{ productId: ctx.product.id, quantity }])).expect(201);
    return tab as { id: string };
  }
  const checkoutAs = (token: string, tabId: string, extra: Json = {}) =>
    post(token, `/v1/tabs/${tabId}/checkout`, { paymentMethod: 'ON_ACCOUNT', idempotencyKey: key(), ...extra });

  const status = (ctx: Ctx, orderId: string, next: string) => patch(ctx.accessToken, `/v1/orders/${orderId}/status`, statusBody(next));
  async function complete(ctx: Ctx, orderId: string) {
    for (const next of ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED']) await status(ctx, orderId, next).expect(200);
  }

  const account = async (ctx: Ctx, customerId: string) =>
    (await get(ctx.accessToken, `/v1/receivables/customers/${customerId}`).expect(200)).body as {
      creditLimitCents: number;
      balanceCents: number;
      availableCents: number;
      overdueCents: number;
      canBuyOnAccount: boolean;
    };
  const payDebt = (ctx: Ctx, receivableId: string, amountCents: number, method = 'PIX') =>
    post(ctx.accessToken, `/v1/receivables/${receivableId}/payments`, { amountCents, method, branchId: ctx.branchId, idempotencyKey: key() });
  const receivableOf = (orderId: string) => prisma().receivable.findUnique({ where: { orderId }, include: { installments: { orderBy: { number: 'asc' } } } });
  const day = (date: Date) => date.toISOString().slice(0, 10);

  // The customer's debt is the sum of the ledger and the sum of what each live receivable owes.
  async function expectLedgerConsistent(customerId: string) {
    const stored = await prisma().creditAccount.findUnique({ where: { customerId } });
    const entries = await prisma().receivableEntry.findMany({ where: { customerId } });
    expect(stored?.balanceCents ?? 0).toBe(entries.reduce((total, entry) => total + entry.amountCents, 0));
    const live = await prisma().receivable.findMany({ where: { customerId, status: { not: 'CANCELLED' } } });
    expect(stored?.balanceCents ?? 0).toBe(live.reduce((total, r) => total + r.totalCents - r.paidCents, 0));
  }

  describe('selling on account at the PDV', () => {
    it('opens the debt for the order total, due in 30 days by default, and takes it from the available limit', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx, 20_000);

      const sale = await pdv(ctx, { customerId: c.id }, 2).expect(201); // 8000
      expect(sale.body).toMatchObject({ paymentMethod: 'ON_ACCOUNT', total: 80 });

      const receivable = await receivableOf(sale.body.id);
      expect(receivable).toMatchObject({ status: 'OPEN', totalCents: 8_000, paidCents: 0, customerId: c.id, branchId: ctx.branchId, tenantId: ctx.tenantId });
      expect(receivable!.description).toBe(`Pedido ${sale.body.orderNumber}`);
      expect(receivable!.installments.map((i) => [i.number, i.amountCents, day(i.dueDate)])).toEqual([[1, 8_000, shift(today(), 30)]]);
      expect(await account(ctx, c.id)).toMatchObject({ creditLimitCents: 20_000, balanceCents: 8_000, availableCents: 12_000, canBuyOnAccount: true });

      const audit = await prisma().auditLog.findFirstOrThrow({ where: { tenantId: ctx.tenantId, action: 'RECEIVABLE_CREATED' } });
      expect(audit.afterData).toMatchObject({ customerId: c.id, orderId: sale.body.id, totalCents: 8_000 });
      expect(audit.userId).not.toBeNull();

      // It shows in contas a receber, linked to its order.
      const listed = (await get(ctx.accessToken, '/v1/receivables').expect(200)).body;
      expect(listed.data).toEqual([
        expect.objectContaining({ id: receivable!.id, openCents: 8_000, order: expect.objectContaining({ id: sale.body.id, orderNumber: sale.body.orderNumber }) }),
      ]);
      await expectLedgerConsistent(c.id);
    });

    it('accepts installments and a first due date chosen at the counter', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx, 50_000);
      const first = shift(today(), 7);
      const sale = await pdv(ctx, { customerId: c.id, creditTerms: { installments: 3, firstDueDate: first } }, 5).expect(201); // 20000
      const receivable = await receivableOf(sale.body.id);
      expect(receivable!.installments.map((i) => i.amountCents)).toEqual([6_667, 6_667, 6_666]); // the 2 leftover cents, one per installment, first ones first
      expect(day(receivable!.installments[0].dueDate)).toBe(first);

      for (const creditTerms of [
        { installments: 0, firstDueDate: first },
        { installments: 13, firstDueDate: first },
        { installments: 1, firstDueDate: shift(today(), -1) },
        { installments: 1, firstDueDate: '2026-13-01' },
        { installments: 1, firstDueDate: first, amountCents: 1 },
        { installments: 1 },
      ]) {
        await pdv(ctx, { customerId: c.id, creditTerms }).expect(400);
      }
      // Terms mean nothing on a sale that is paid now: no debt is opened.
      const paidNow = await pdv(ctx, { customerId: c.id, paymentMethod: 'PIX', creditTerms: { installments: 3, firstDueDate: first } }).expect(201);
      expect(await receivableOf(paidNow.body.id)).toBeNull();
      expect(await prisma().receivable.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
    });

    it('nothing was received: no cash session is needed and nothing reaches the drawer', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await pdv(ctx, { customerId: c.id }).expect(201); // drawer closed: fine
      const session = (await post(ctx.accessToken, '/v1/cash/sessions', { branchId: ctx.branchId, openingBalanceCents: 1_000 }).expect(201)).body;
      const sale = await pdv(ctx, { customerId: c.id }).expect(201);
      const detail = (await get(ctx.accessToken, `/v1/cash/sessions/${session.id}`).expect(200)).body;
      expect(detail.totals).toMatchObject({ salesCents: 0, receivablePaymentsCents: 0 });
      expect(detail.expectedBalanceCents).toBe(1_000);
      expect(await prisma().payment.count({ where: { orderId: sale.body.id } })).toBe(0);

      // The money enters the drawer when the customer pays the debt in cash.
      const receivable = await receivableOf(sale.body.id);
      await payDebt(ctx, receivable!.id, 4_000, 'CASH').expect(200);
      const after = (await get(ctx.accessToken, `/v1/cash/sessions/${session.id}`).expect(200)).body;
      expect(after.totals).toMatchObject({ salesCents: 0, receivablePaymentsCents: 4_000 });
      expect(after.expectedBalanceCents).toBe(5_000);
    });

    it('a coupon and cashback reduce what goes on account; a sale fully covered by cashback has nothing to charge', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await put(ctx.accessToken, '/v1/cashback/program', { enabled: true, earnRateBps: 1000, expireAfterDays: null }).expect(200);
      await post(ctx.accessToken, `/v1/cashback/customers/${c.id}/adjust`, { amountCents: 5_000, reason: 'Saldo inicial do teste', idempotencyKey: key() }).expect(200);
      const code = `FI${uniqueSuffix().replace(/-/g, '').slice(-8)}`.toUpperCase();
      await post(ctx.accessToken, '/v1/coupons', { code, discountType: 'FIXED', value: 500 }).expect(201);

      const sale = await pdv(ctx, { customerId: c.id, couponCode: code, cashbackToUseCents: 1_000 }).expect(201); // 4000 - 500 - 1000
      expect((await receivableOf(sale.body.id))!.totalCents).toBe(2_500);

      const refused = await pdv(ctx, { customerId: c.id, cashbackToUseCents: 4_000 }).expect(400);
      expect(refused.body.code).toBe('RECEIVABLE_NOTHING_TO_CHARGE');
      // ...and the refused sale spent no cashback and created no order.
      expect((await get(ctx.accessToken, `/v1/cashback/customers/${c.id}`).expect(200)).body.balanceCents).toBe(4_000);
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 2_500 });
    });
  });

  describe('who may buy on account', () => {
    it('needs an identified customer, with a limit, with room for the sale', async () => {
      const ctx = await setup();
      const orders = () => prisma().order.count({ where: { tenantId: ctx.tenantId } });

      const anonymous = await pdv(ctx).expect(400);
      expect(anonymous.body.code).toBe('RECEIVABLE_CUSTOMER_REQUIRED');

      const noLimit = await newCustomer(ctx, 0);
      expect((await pdv(ctx, { customerId: noLimit.id }).expect(409)).body.code).toBe('RECEIVABLE_CREDIT_NOT_ALLOWED');

      const c = await newCustomer(ctx, 10_000);
      await pdv(ctx, { customerId: c.id }, 2).expect(201); // 8000 of 10000
      const exceeded = await pdv(ctx, { customerId: c.id }).expect(409); // + 4000
      expect(exceeded.body).toMatchObject({ code: 'RECEIVABLE_LIMIT_EXCEEDED', details: { creditLimitCents: 10_000, balanceCents: 8_000, requestedCents: 4_000 } });
      expect(await orders()).toBe(1);

      // Paying part of the debt gives the room back.
      const receivable = await prisma().receivable.findFirstOrThrow({ where: { customerId: c.id } });
      await payDebt(ctx, receivable.id, 2_000).expect(200);
      await pdv(ctx, { customerId: c.id }).expect(201);
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 10_000, availableCents: 0 });

      // The limit is exact: one cent over is refused.
      const tight = await newCustomer(ctx, 3_999);
      expect((await pdv(ctx, { customerId: tight.id }).expect(409)).body.code).toBe('RECEIVABLE_LIMIT_EXCEEDED');
      await put(ctx.accessToken, `/v1/receivables/customers/${tight.id}/limit`, { creditLimitCents: 4_000 }).expect(200);
      await pdv(ctx, { customerId: tight.id }).expect(201);
    });

    it('a customer with an overdue installment cannot buy on account until it is paid', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx, 50_000);
      const first = await pdv(ctx, { customerId: c.id }).expect(201);
      const receivable = await receivableOf(first.body.id);
      await prisma().receivableInstallment.updateMany({ where: { receivableId: receivable!.id }, data: { dueDate: new Date(`${shift(today(), -1)}T00:00:00.000Z`) } });

      const refused = await pdv(ctx, { customerId: c.id }).expect(409);
      expect(refused.body).toMatchObject({ code: 'RECEIVABLE_CUSTOMER_OVERDUE', details: { overdueCents: 4_000 } });
      // Buying and paying now is still welcome.
      await pdv(ctx, { customerId: c.id, paymentMethod: 'PIX' }).expect(201);

      await payDebt(ctx, receivable!.id, 4_000).expect(200);
      await pdv(ctx, { customerId: c.id }).expect(201);
    });

    it('an inactive customer, or a customer of another restaurant, cannot be sold to on account', async () => {
      const ctx = await setup();
      const other = await setup();
      const theirs = await newCustomer(other, 50_000);
      await pdv(ctx, { customerId: theirs.id }).expect(404);
      expect(await account(other, theirs.id)).toMatchObject({ balanceCents: 0 });

      const c = await newCustomer(ctx, 50_000);
      await patch(ctx.accessToken, `/v1/customers/${c.id}`, { active: false }).expect(200);
      await pdv(ctx, { customerId: c.id }).expect(409);
      expect(await prisma().receivable.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
    });

    it('the public checkout cannot buy on account, whatever it sends', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx, 50_000);
      const online = await request(server)
        .post('/v1/public/orders')
        .send({
          restaurantSlug: ctx.slug,
          items: [{ productId: ctx.product.id, quantity: 1 }],
          customer: { name: 'Visitante', phone: '11999990000' },
          fulfillmentType: 'PICKUP',
          paymentMethod: 'ON_ACCOUNT',
          customerId: c.id,
        })
        .expect(400);
      expect(JSON.stringify(online.body)).not.toMatch(/stack|prisma/i);
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 0 });
    });

    it.each([
      ['OWNER', 201],
      ['ADMIN', 201],
      ['MANAGER', 201],
      ['CASHIER', 201],
      ['WAITER', 403],
      ['KITCHEN', 403],
      ['DELIVERY', 403],
      ['VIEWER', 403],
    ] as [RoleName, number][])('%s selling on account at the PDV: %i', async (role, expected) => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const token = role === 'OWNER' ? ctx.accessToken : await createStaffAndLoginE2E(app, server, ctx.tenantId, role, [ctx.branchId]);
      await pdvAs(token, ctx, { customerId: c.id }).expect(expected);
      expect(await prisma().receivable.count({ where: { tenantId: ctx.tenantId } })).toBe(expected === 201 ? 1 : 0);
    });
  });

  describe('table checkout', () => {
    it('puts the bill on account: order concluded, debt opened, no payment recorded, table freed', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const tab = await openTab(ctx, 2); // 8000
      const first = shift(today(), 15);

      await checkoutAs(ctx.accessToken, tab.id, { customerId: c.id, creditTerms: { installments: 2, firstDueDate: first } }).expect(200);
      const order = await prisma().order.findFirstOrThrow({ where: { tenantId: ctx.tenantId } });
      expect(order).toMatchObject({ status: 'COMPLETED', paymentMethod: 'ON_ACCOUNT', totalCents: 8_000, customerId: c.id });
      expect(await prisma().payment.count({ where: { orderId: order.id } })).toBe(0);
      expect((await prisma().tab.findUniqueOrThrow({ where: { id: tab.id } })).status).toBe('CLOSED');

      const receivable = await receivableOf(order.id);
      expect(receivable!.installments.map((i) => i.amountCents)).toEqual([4_000, 4_000]);
      expect(day(receivable!.installments[0].dueDate)).toBe(first);
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 8_000 });
    });

    it('refuses without a customer, over the limit or without permission, and the tab stays open', async () => {
      const ctx = await setup();
      const tab = await openTab(ctx, 2); // 8000
      const small = await newCustomer(ctx, 5_000);

      expect((await checkoutAs(ctx.accessToken, tab.id).expect(400)).body.code).toBe('RECEIVABLE_CUSTOMER_REQUIRED');
      expect((await checkoutAs(ctx.accessToken, tab.id, { customerId: small.id }).expect(409)).body.code).toBe('RECEIVABLE_LIMIT_EXCEEDED');
      const waiter = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'WAITER', [ctx.branchId]);
      await checkoutAs(waiter, tab.id, { customerId: small.id }).expect(403);
      // A waiter closes bills (tabs.close) but may not put them on account: refused for that reason,
      // before the sale is even looked at (no customer here, so it is not the customer link refusing).
      const noSell = await checkoutAs(waiter, tab.id).expect(403);
      expect(noSell.body.message).toMatch(/fiado/i);

      expect((await prisma().tab.findUniqueOrThrow({ where: { id: tab.id } })).status).toBe('OPEN');
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect(await account(ctx, small.id)).toMatchObject({ balanceCents: 0 });
      // It can still be paid normally.
      await checkoutAs(ctx.accessToken, tab.id, { paymentMethod: 'PIX' }).expect(200);
    });

    it('repeating the same checkout returns the same sale and one debt', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const tab = await openTab(ctx);
      const k = key();
      const results = await Promise.all(Array.from({ length: 5 }, () => checkoutAs(ctx.accessToken, tab.id, { customerId: c.id, idempotencyKey: k })));
      expect(results.map((res) => res.status)).toEqual(Array(5).fill(200));
      await checkoutAs(ctx.accessToken, tab.id, { customerId: c.id, idempotencyKey: k }).expect(200);
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
      expect(await prisma().receivable.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 4_000 });
    });
  });

  describe('benefits', () => {
    it('a sale on account earns no points and no cashback; the same sale paid now earns both', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await put(ctx.accessToken, '/v1/cashback/program', { enabled: true, earnRateBps: 1000, expireAfterDays: null }).expect(200);
      await put(ctx.accessToken, '/v1/loyalty/program', { enabled: true, pointsPerReal: 1 }).expect(200);
      const points = async () => (await get(ctx.accessToken, `/v1/loyalty/customers/${c.id}`).expect(200)).body.balancePoints as number;
      const cashback = async () => (await get(ctx.accessToken, `/v1/cashback/customers/${c.id}`).expect(200)).body.balanceCents as number;

      const onAccount = await pdv(ctx, { customerId: c.id }).expect(201);
      await complete(ctx, onAccount.body.id);
      expect([await points(), await cashback()]).toEqual([0, 0]);

      // A table bill on account is born concluded: nothing either.
      const tab = await openTab(ctx);
      await checkoutAs(ctx.accessToken, tab.id, { customerId: c.id }).expect(200);
      expect([await points(), await cashback()]).toEqual([0, 0]);
      expect(await prisma().loyaltyEntry.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect(await prisma().cashbackEntry.count({ where: { tenantId: ctx.tenantId } })).toBe(0);

      const paidNow = await pdv(ctx, { customerId: c.id, paymentMethod: 'PIX' }).expect(201);
      await complete(ctx, paidNow.body.id);
      expect(await points()).toBe(40);
      expect(await cashback()).toBe(400);
    });
  });

  describe('cancelling the order', () => {
    it('cancels the debt with it, in the same transaction, and gives the limit back', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx, 10_000);
      const sale = await pdv(ctx, { customerId: c.id }, 2).expect(201);
      await status(ctx, sale.body.id, 'CANCELLED').expect(200);

      const receivable = await receivableOf(sale.body.id);
      expect(receivable).toMatchObject({ status: 'CANCELLED', paidCents: 0 });
      expect(receivable!.cancelReason).toMatch(/pedido cancelado/i);
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 0, availableCents: 10_000 });
      const entries = await prisma().receivableEntry.findMany({ where: { receivableId: receivable!.id }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
      expect(entries.map((e) => [e.type, e.amountCents, e.balanceAfterCents])).toEqual([
        ['CHARGE', 8_000, 8_000],
        ['REVERSAL', -8_000, 0],
      ]);
      await expectLedgerConsistent(c.id);
    });

    it('is refused while the debt has payments; after they are reversed the order can be cancelled', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const sale = await pdv(ctx, { customerId: c.id }).expect(201);
      const receivable = await receivableOf(sale.body.id);
      const paid = await payDebt(ctx, receivable!.id, 1_500).expect(200);

      const refused = await status(ctx, sale.body.id, 'CANCELLED').expect(409);
      expect(refused.body.code).toBe('RECEIVABLE_HAS_PAYMENTS');
      expect((await prisma().order.findUniqueOrThrow({ where: { id: sale.body.id } })).status).toBe('PENDING');
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 2_500 });

      await post(ctx.accessToken, `/v1/receivables/entries/${paid.body.entryId}/reverse`, { reason: 'Pedido será cancelado', idempotencyKey: key() }).expect(200);
      await status(ctx, sale.body.id, 'CANCELLED').expect(200);
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 0 });
      await expectLedgerConsistent(c.id);
    });

    it('a debt forgiven by hand (receivable cancelled with a reason) leaves the order alone; cancelling the order later is harmless', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const sale = await pdv(ctx, { customerId: c.id }).expect(201);
      const receivable = await receivableOf(sale.body.id);

      await post(ctx.accessToken, `/v1/receivables/${receivable!.id}/cancel`, { reason: 'Cortesia da casa' }).expect(200);
      expect((await prisma().order.findUniqueOrThrow({ where: { id: sale.body.id } })).status).toBe('PENDING');
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 0 });
      const audit = await prisma().auditLog.findFirstOrThrow({ where: { tenantId: ctx.tenantId, action: 'RECEIVABLE_CANCELLED' } });
      expect(audit.afterData).toMatchObject({ reason: 'Cortesia da casa', orderId: sale.body.id });

      await status(ctx, sale.body.id, 'CANCELLED').expect(200);
      expect(await prisma().receivableEntry.count({ where: { receivableId: receivable!.id } })).toBe(2);
      expect((await receivableOf(sale.body.id))!.cancelReason).toBe('Cortesia da casa');
      await expectLedgerConsistent(c.id);
    });

    it('when the audit of the cancellation cannot be written, the order stays and so does the debt', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const sale = await pdv(ctx, { customerId: c.id }).expect(201);
      await injectAuditFailure(app, 'fail_audit_rcv_orders_test', ctx.tenantId, 'RECEIVABLE_CANCELLED');
      try {
        await status(ctx, sale.body.id, 'CANCELLED').expect(500);
      } finally {
        await removeAuditFailure(app, 'fail_audit_rcv_orders_test');
      }
      expect((await prisma().order.findUniqueOrThrow({ where: { id: sale.body.id } })).status).toBe('PENDING');
      expect((await receivableOf(sale.body.id))!.status).toBe('OPEN');
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 4_000 });
    });
  });

  describe('atomicity of the sale', () => {
    afterEach(() => removeAuditFailure(app, 'fail_audit_rcv_orders_test'));

    it('when the audit of the debt cannot be written, there is no order and no debt', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await injectAuditFailure(app, 'fail_audit_rcv_orders_test', ctx.tenantId, 'RECEIVABLE_CREATED');
      await pdv(ctx, { customerId: c.id }).expect(500);
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect(await prisma().receivable.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect(await prisma().receivableEntry.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 0 });

      await removeAuditFailure(app, 'fail_audit_rcv_orders_test');
      await pdv(ctx, { customerId: c.id }).expect(201);
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 4_000 });
    });
  });

  describe('changing the customer of the order', () => {
    it('is refused while the debt exists: the debt belongs to the customer the order names', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const other = await newCustomer(ctx, 50_000, 'João Lima');
      const sale = await pdv(ctx, { customerId: c.id }).expect(201);

      for (const target of [other.id, null]) {
        expect((await patch(ctx.accessToken, `/v1/orders/${sale.body.id}/customer`, { customerId: target }).expect(409)).body.code).toBe('ORDER_HAS_RECEIVABLE');
      }
      expect((await prisma().order.findUniqueOrThrow({ where: { id: sale.body.id } })).customerId).toBe(c.id);
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 4_000 });
      expect(await account(ctx, other.id)).toMatchObject({ balanceCents: 0 });
    });
  });

  describe('concurrency and idempotency', () => {
    it('ten simultaneous sales of 4000 against a limit of 10000: exactly two go through', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx, 10_000);
      const results = await Promise.all(Array.from({ length: 10 }, () => pdv(ctx, { customerId: c.id })));
      const statuses = results.map((res) => res.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(2);
      expect(statuses.filter((s) => s === 409)).toHaveLength(8);
      expect(results.filter((res) => res.status === 409).every((res) => res.body.code === 'RECEIVABLE_LIMIT_EXCEEDED')).toBe(true);

      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(2);
      expect(await prisma().receivable.count({ where: { tenantId: ctx.tenantId } })).toBe(2);
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 8_000, availableCents: 2_000 });
      await expectLedgerConsistent(c.id);
    });

    it('sales, payments and a cancellation at the same time leave the debt equal to its ledger', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx, 100_000);
      const seeds = [] as { orderId: string; receivableId: string }[];
      for (let i = 0; i < 3; i++) {
        const sale = await pdv(ctx, { customerId: c.id }).expect(201);
        seeds.push({ orderId: sale.body.id, receivableId: (await receivableOf(sale.body.id))!.id });
      }

      const results = await Promise.all([
        ...Array.from({ length: 4 }, () => pdv(ctx, { customerId: c.id })),
        payDebt(ctx, seeds[0].receivableId, 1_000),
        payDebt(ctx, seeds[0].receivableId, 1_000),
        payDebt(ctx, seeds[1].receivableId, 4_000),
        status(ctx, seeds[2].orderId, 'CANCELLED'),
      ]);
      expect(results.map((res) => res.status)).toEqual([201, 201, 201, 201, 200, 200, 200, 200]);
      // 7 sales of 4000, one cancelled, 6000 paid.
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 6 * 4_000 - 6_000 });
      await expectLedgerConsistent(c.id);
    });

    it('the same idempotency key creates one order and one debt, under simultaneous duplicates too', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx, 5_000); // room for exactly one sale
      const k = key();
      const results = await Promise.all(Array.from({ length: 6 }, () => pdv(ctx, { customerId: c.id, idempotencyKey: k })));
      expect(results.map((res) => res.status)).toEqual(Array(6).fill(201));
      expect(new Set(results.map((res) => res.body.id)).size).toBe(1);
      // Later, with no room left: the retry still answers with the sale instead of "limit exceeded".
      const retry = await pdv(ctx, { customerId: c.id, idempotencyKey: k }).expect(201);
      expect(retry.body.id).toBe(results[0].body.id);
      expect(await prisma().receivable.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 4_000 });

      // The same key with another way of paying is a different request.
      expect((await pdv(ctx, { customerId: c.id, idempotencyKey: k, paymentMethod: 'PIX' }).expect(409)).body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });
  });

  describe('isolation', () => {
    it('a branch-limited seller cannot sell on account at a branch they do not work at', async () => {
      const ctx = await setup();
      const second = await prisma().branch.create({ data: { tenantId: ctx.tenantId, name: 'Filial', code: 'FILIAL' } });
      const cashier = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'CASHIER', [second.id]);
      const c = await newCustomer(ctx);
      await pdvAs(cashier, ctx, { customerId: c.id }).expect(403);
      expect(await account(ctx, c.id)).toMatchObject({ balanceCents: 0 });
    });
  });
});
