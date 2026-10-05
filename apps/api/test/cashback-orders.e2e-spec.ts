import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createActiveProductE2E,
  createTestApp,
  getPrisma,
  injectAuditFailure,
  registerTenantE2E,
  removeAuditFailure,
  uniqueSuffix,
} from './test-app.util';

type Json = Record<string, unknown>;

// Fase 11, fatia 5 (2/2): cashback in the ORDER flows. A concluded order earns; the balance
// pays for the items of a later order (validated against the locked balance, in the transaction
// that creates the order); a cancelled order gets back what it used.
describe('Cashback x orders (e2e)', () => {
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
  const key = () => `cbk-${uniqueSuffix()}`;

  let seq = 0;
  const phone = () => `112${String(Date.now() + ++seq).slice(-8)}`;

  // Burger R$ 40,00 (4000 cents); program 10% unless told otherwise.
  async function setup(program: Json | null = { enabled: true, earnRateBps: 1000, expireAfterDays: null }) {
    const tenant = await registerTenantE2E(server);
    const product = await createActiveProductE2E(server, tenant.accessToken, `Burger ${uniqueSuffix()}`, 40);
    if (program) await put(tenant.accessToken, '/v1/cashback/program', program).expect(200);
    return { ...tenant, product };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const newCustomer = async (ctx: Ctx, name = 'Maria Souza') =>
    (await post(ctx.accessToken, '/v1/customers', { name, phone: phone() }).expect(201)).body as { id: string };
  const credit = (ctx: Ctx, customerId: string, amountCents: number) =>
    post(ctx.accessToken, `/v1/cashback/customers/${customerId}/adjust`, { amountCents, reason: 'Saldo inicial do teste', idempotencyKey: key() }).expect(200);

  const pdv = (ctx: Ctx, extra: Json = {}, quantity = 1) =>
    post(ctx.accessToken, '/v1/pos/orders', {
      branchId: ctx.branchId,
      items: [{ productId: ctx.product.id, quantity }],
      paymentMethod: 'PIX',
      ...extra,
    });

  const status = (ctx: Ctx, orderId: string, next: string) => patch(ctx.accessToken, `/v1/orders/${orderId}/status`, { status: next });
  async function complete(ctx: Ctx, orderId: string) {
    for (const next of ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED']) await status(ctx, orderId, next).expect(200);
  }

  const balance = async (ctx: Ctx, customerId: string) =>
    (await get(ctx.accessToken, `/v1/cashback/customers/${customerId}`).expect(200)).body.balanceCents as number;
  const row = (orderId: string) => prisma().order.findUniqueOrThrow({ where: { id: orderId } });
  const entriesOf = (orderId: string) => prisma().cashbackEntry.findMany({ where: { orderId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });

  async function expectLedgerConsistent(customerId: string) {
    const stored = await prisma().cashbackAccount.findUnique({ where: { customerId } });
    const entries = await prisma().cashbackEntry.findMany({ where: { customerId } });
    expect(stored?.balanceCents ?? 0).toBe(entries.reduce((total, entry) => total + entry.amountCents, 0));
    expect(entries.every((entry) => entry.balanceAfterCents >= 0)).toBe(true);
  }

  describe('earning', () => {
    it('credits the percentage of the items when the order is completed, once, and nothing before', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const order = (await pdv(ctx, { customerId: c.id }, 2).expect(201)).body; // 8000 -> 10% = 800
      expect(await balance(ctx, c.id)).toBe(0);

      await complete(ctx, order.id);
      expect(await balance(ctx, c.id)).toBe(800);
      const entries = await entriesOf(order.id);
      expect(entries.map((e) => [e.type, e.amountCents, e.balanceAfterCents])).toEqual([['EARN', 800, 800]]);
      const audit = await prisma().auditLog.findFirstOrThrow({ where: { tenantId: ctx.tenantId, action: 'CASHBACK_EARNED' } });
      expect(audit.afterData).toMatchObject({ customerId: c.id, orderId: order.id, amountCents: 800, earnRateBps: 1000 });
    });

    it('rounds down to the cent and ignores the coupon discount and the delivery fee', async () => {
      const ctx = await setup({ enabled: true, earnRateBps: 333, expireAfterDays: null });
      const c = await newCustomer(ctx);
      await post(ctx.accessToken, '/v1/coupons', { code: `CB${uniqueSuffix().replace(/-/g, '').slice(-8)}`, discountType: 'FIXED', value: 1500 }).expect(201);
      const coupon = await prisma().coupon.findFirstOrThrow({ where: { tenantId: ctx.tenantId } });
      const order = (await pdv(ctx, { customerId: c.id, couponCode: coupon.code }).expect(201)).body; // 4000 - 1500 = 2500
      await complete(ctx, order.id);
      expect(await balance(ctx, c.id)).toBe(83); // floor(2500 * 3,33%) = floor(83,25)
    });

    it('earns nothing without a customer, on a cancelled order, with the program off or never configured', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const anonymous = (await pdv(ctx).expect(201)).body;
      await complete(ctx, anonymous.id);
      const cancelled = (await pdv(ctx, { customerId: c.id }).expect(201)).body;
      await status(ctx, cancelled.id, 'CANCELLED').expect(200);
      await put(ctx.accessToken, '/v1/cashback/program', { enabled: false, earnRateBps: 1000, expireAfterDays: null }).expect(200);
      const off = (await pdv(ctx, { customerId: c.id }).expect(201)).body;
      await complete(ctx, off.id);
      expect(await prisma().cashbackEntry.count({ where: { tenantId: ctx.tenantId } })).toBe(0);

      const never = await setup(null);
      const theirs = await newCustomer(never);
      const order = (await pdv(never, { customerId: theirs.id }).expect(201)).body;
      await complete(never, order.id);
      expect(await prisma().cashbackEntry.count({ where: { tenantId: never.tenantId } })).toBe(0);
    });
  });

  describe('spending on a sale (PDV)', () => {
    it('reduces the total by exactly the cashback used and records the debit against the order', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await credit(ctx, c.id, 1_500);

      const sale = await pdv(ctx, { customerId: c.id, cashbackToUseCents: 1_000 }, 2).expect(201); // 8000
      expect(sale.body).toMatchObject({ subtotal: 80, discount: 0, cashbackUsed: 10, total: 70 });
      expect(await row(sale.body.id)).toMatchObject({ subtotalCents: 8_000, cashbackUsedCents: 1_000, totalCents: 7_000, customerId: c.id });
      expect(await balance(ctx, c.id)).toBe(500);

      const [use] = await entriesOf(sale.body.id);
      expect(use).toMatchObject({ type: 'USE', amountCents: -1_000, balanceAfterCents: 500, customerId: c.id, branchId: ctx.branchId });
      expect(use.createdByUserId).not.toBeNull();
      const audit = await prisma().auditLog.findFirstOrThrow({ where: { tenantId: ctx.tenantId, action: 'CASHBACK_USED' } });
      expect(audit.afterData).toMatchObject({ customerId: c.id, orderId: sale.body.id, amountCents: -1_000, balanceAfterCents: 500 });

      const detail = await get(ctx.accessToken, `/v1/orders/${sale.body.id}`).expect(200);
      expect(detail.body).toMatchObject({ cashbackUsed: 10, total: 70 });
      await expectLedgerConsistent(c.id);
    });

    it('a CASH sale puts only the money actually received in the drawer', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await credit(ctx, c.id, 4_000);
      const session = (await post(ctx.accessToken, '/v1/cash/sessions', { branchId: ctx.branchId, openingBalanceCents: 0 }).expect(201)).body;

      const partly = await pdv(ctx, { customerId: c.id, cashbackToUseCents: 1_500, paymentMethod: 'CASH' }).expect(201);
      const fully = await pdv(ctx, { customerId: c.id, cashbackToUseCents: 2_500, paymentMethod: 'CASH' }).expect(201); // 4000 - 2500
      expect([partly.body.total, fully.body.total]).toEqual([25, 15]);

      const sales = await prisma().cashMovement.findMany({ where: { sessionId: session.id, type: 'SALE' }, orderBy: { amountCents: 'asc' } });
      expect(sales.map((sale) => sale.amountCents)).toEqual([1_500, 2_500]);
      const closed = await patch(ctx.accessToken, `/v1/cash/sessions/${session.id}/close`, { countedClosingBalanceCents: 4_000 }).expect(200);
      expect(closed.body.differenceCents).toBe(0);
    });

    it('cashback may pay for all the items, and comes after the coupon', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await credit(ctx, c.id, 9_000);
      await post(ctx.accessToken, '/v1/coupons', { code: `CB${uniqueSuffix().replace(/-/g, '').slice(-8)}`, discountType: 'FIXED', value: 1_000 }).expect(201);
      const coupon = await prisma().coupon.findFirstOrThrow({ where: { tenantId: ctx.tenantId } });

      // Items 4000, coupon 1000: at most 3000 of cashback.
      const tooMuch = await pdv(ctx, { customerId: c.id, couponCode: coupon.code, cashbackToUseCents: 3_001 }).expect(400);
      expect(tooMuch.body).toMatchObject({ code: 'CASHBACK_EXCEEDS_ORDER', details: { maxCents: 3_000 } });
      // The refused sale consumed neither the coupon nor the balance.
      expect((await prisma().coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usageCount).toBe(0);
      expect(await balance(ctx, c.id)).toBe(9_000);

      const free = await pdv(ctx, { customerId: c.id, couponCode: coupon.code, cashbackToUseCents: 3_000 }).expect(201);
      expect(free.body).toMatchObject({ subtotal: 40, discount: 10, cashbackUsed: 30, total: 0 });
      expect(await balance(ctx, c.id)).toBe(6_000);

      // Completed: nothing was paid with money, so nothing is earned back.
      await complete(ctx, free.body.id);
      expect(await balance(ctx, c.id)).toBe(6_000);
      expect((await entriesOf(free.body.id)).map((e) => e.type)).toEqual(['USE']);
    });

    it('earning counts only the part paid with money', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await credit(ctx, c.id, 1_000);
      const sale = await pdv(ctx, { customerId: c.id, cashbackToUseCents: 1_000 }).expect(201); // paid 3000
      await complete(ctx, sale.body.id);
      expect(await balance(ctx, c.id)).toBe(300); // 10% of 3000, not of 4000
      expect((await entriesOf(sale.body.id)).map((e) => [e.type, e.amountCents])).toEqual([
        ['USE', -1_000],
        ['EARN', 300],
      ]);
    });

    it('is refused, with nothing created, without enough balance, without a customer or with the program off', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await credit(ctx, c.id, 500);

      const short = await pdv(ctx, { customerId: c.id, cashbackToUseCents: 501 }).expect(409);
      expect(short.body).toMatchObject({ code: 'CASHBACK_INSUFFICIENT_BALANCE', details: { balanceCents: 500, neededCents: 501 } });
      expect((await pdv(ctx, { cashbackToUseCents: 100 }).expect(400)).body.code).toBe('CASHBACK_CUSTOMER_REQUIRED');

      await put(ctx.accessToken, '/v1/cashback/program', { enabled: false, earnRateBps: 1000, expireAfterDays: null }).expect(200);
      expect((await pdv(ctx, { customerId: c.id, cashbackToUseCents: 100 }).expect(409)).body.code).toBe('CASHBACK_DISABLED');

      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect(await balance(ctx, c.id)).toBe(500);
      expect(await prisma().cashbackEntry.count({ where: { tenantId: ctx.tenantId, type: 'USE' } })).toBe(0);
    });

    it('accepts only a whole positive number of cents, and never a total or a balance from the client', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await credit(ctx, c.id, 5_000);
      for (const extra of [
        { cashbackToUseCents: 0 },
        { cashbackToUseCents: -100 },
        { cashbackToUseCents: 10.5 },
        { cashbackToUseCents: '100' },
        { cashbackToUseCents: 100, cashbackUsedCents: 4_000 },
        { cashbackToUseCents: 100, totalCents: 1 },
        { cashbackToUseCents: 100, balanceCents: 999_999 },
      ]) {
        await pdv(ctx, { customerId: c.id, ...extra }).expect(400);
      }
      expect(await balance(ctx, c.id)).toBe(5_000);
    });

    it('an expired balance cannot be spent', async () => {
      const ctx = await setup({ enabled: true, earnRateBps: 1000, expireAfterDays: 30 });
      const c = await newCustomer(ctx);
      await credit(ctx, c.id, 2_000);
      await prisma().cashbackAccount.update({ where: { customerId: c.id }, data: { lastActivityAt: new Date(Date.now() - 31 * 86_400_000) } });

      expect((await pdv(ctx, { customerId: c.id, cashbackToUseCents: 100 }).expect(409)).body.code).toBe('CASHBACK_INSUFFICIENT_BALANCE');
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      const state = (await get(ctx.accessToken, `/v1/cashback/customers/${c.id}`).expect(200)).body;
      expect(state).toMatchObject({ balanceCents: 0, expiredPendingCents: 2_000 });
    });

    it('the public checkout cannot spend anybody\'s cashback', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await credit(ctx, c.id, 3_000);
      const online = await request(server)
        .post('/v1/public/orders')
        .send({
          restaurantSlug: ctx.slug,
          items: [{ productId: ctx.product.id, quantity: 1 }],
          customer: { name: 'Visitante', phone: '11999990000' },
          fulfillmentType: 'PICKUP',
          paymentMethod: 'PIX',
          customerId: c.id,
          cashbackToUseCents: 3_000,
        });
      expect([201, 400]).toContain(online.status);
      if (online.status === 201) expect(await row(online.body.id)).toMatchObject({ cashbackUsedCents: 0, totalCents: 4_000, customerId: null });
      expect(await balance(ctx, c.id)).toBe(3_000);
    });

    it('a customer of another restaurant cannot be used to spend', async () => {
      const ctx = await setup();
      const other = await setup();
      const theirs = await newCustomer(other);
      await credit(other, theirs.id, 3_000);
      await pdv(ctx, { customerId: theirs.id, cashbackToUseCents: 1_000 }).expect(404);
      expect(await balance(other, theirs.id)).toBe(3_000);
    });
  });

  describe('table checkout', () => {
    it('spends cashback and, being born completed, earns on the rest in the same transaction', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await credit(ctx, c.id, 2_000);
      const table = (await post(ctx.accessToken, '/v1/tables', { branchId: ctx.branchId, number: 1 }).expect(201)).body;
      const tab = (await post(ctx.accessToken, '/v1/tabs', { branchId: ctx.branchId, tableId: table.id }).expect(201)).body;
      await post(ctx.accessToken, `/v1/tabs/${tab.id}/items`, { productId: ctx.product.id, quantity: 2 }).expect(201); // 8000

      await post(ctx.accessToken, `/v1/tabs/${tab.id}/checkout`, { paymentMethod: 'PIX', idempotencyKey: key(), customerId: c.id, cashbackToUseCents: 2_000 }).expect(200);
      const sale = await prisma().order.findUniqueOrThrow({ where: { tabId: tab.id } });
      expect(sale).toMatchObject({ status: 'COMPLETED', cashbackUsedCents: 2_000, totalCents: 6_000 });
      expect((await prisma().payment.findUniqueOrThrow({ where: { orderId: sale.id } })).amountCents).toBe(6_000);
      expect((await entriesOf(sale.id)).map((e) => [e.type, e.amountCents, e.balanceAfterCents])).toEqual([
        ['USE', -2_000, 0],
        ['EARN', 600, 600],
      ]);
      expect(await balance(ctx, c.id)).toBe(600);
    });

    it('refuses cashback without a customer and leaves the tab open', async () => {
      const ctx = await setup();
      const table = (await post(ctx.accessToken, '/v1/tables', { branchId: ctx.branchId, number: 1 }).expect(201)).body;
      const tab = (await post(ctx.accessToken, '/v1/tabs', { branchId: ctx.branchId, tableId: table.id }).expect(201)).body;
      await post(ctx.accessToken, `/v1/tabs/${tab.id}/items`, { productId: ctx.product.id, quantity: 1 }).expect(201);
      const refused = await post(ctx.accessToken, `/v1/tabs/${tab.id}/checkout`, { paymentMethod: 'PIX', idempotencyKey: key(), cashbackToUseCents: 500 }).expect(400);
      expect(refused.body.code).toBe('CASHBACK_CUSTOMER_REQUIRED');
      expect((await prisma().tab.findUniqueOrThrow({ where: { id: tab.id } })).status).toBe('OPEN');
    });
  });

  describe('cancelling', () => {
    afterEach(() => removeAuditFailure(app, 'fail_audit_cashback_orders_test'));

    it('gives back the cashback the order used, once, in the transaction that cancels it', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await credit(ctx, c.id, 1_500);
      const sale = await pdv(ctx, { customerId: c.id, cashbackToUseCents: 1_200 }).expect(201);
      expect(await balance(ctx, c.id)).toBe(300);

      await status(ctx, sale.body.id, 'CANCELLED').expect(200);
      expect(await balance(ctx, c.id)).toBe(1_500);
      const entries = await entriesOf(sale.body.id);
      expect(entries.map((e) => [e.type, e.amountCents, e.balanceAfterCents])).toEqual([
        ['USE', -1_200, 300],
        ['REVERSAL', 1_200, 1_500],
      ]);
      expect(entries[1]).toMatchObject({ reversedEntryId: entries[0].id, reason: 'Pedido cancelado' });
      expect(await prisma().auditLog.count({ where: { tenantId: ctx.tenantId, action: 'CASHBACK_USE_REFUNDED' } })).toBe(1);
      // The order keeps the record of what it had used.
      expect(await row(sale.body.id)).toMatchObject({ status: 'CANCELLED', cashbackUsedCents: 1_200, totalCents: 2_800 });
      await expectLedgerConsistent(c.id);
    });

    it('if the refund cannot be recorded the order is not cancelled either', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await credit(ctx, c.id, 1_000);
      const sale = await pdv(ctx, { customerId: c.id, cashbackToUseCents: 1_000 }).expect(201);

      await injectAuditFailure(app, 'fail_audit_cashback_orders_test', ctx.tenantId, 'CASHBACK_USE_REFUNDED');
      await status(ctx, sale.body.id, 'CANCELLED').expect(500);
      expect((await row(sale.body.id)).status).toBe('PENDING');
      expect(await balance(ctx, c.id)).toBe(0);

      await removeAuditFailure(app, 'fail_audit_cashback_orders_test');
      await status(ctx, sale.body.id, 'CANCELLED').expect(200);
      expect(await balance(ctx, c.id)).toBe(1_000);
    });

    it('two simultaneous cancellations refund once, and a use cannot be reversed by hand', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await credit(ctx, c.id, 1_000);
      const sale = await pdv(ctx, { customerId: c.id, cashbackToUseCents: 700 }).expect(201);
      const [use] = await entriesOf(sale.body.id);

      const manual = await post(ctx.accessToken, `/v1/cashback/entries/${use.id}/reverse`, { reason: 'Tentativa manual', idempotencyKey: key() }).expect(409);
      expect(manual.body.code).toBe('CASHBACK_ENTRY_NOT_REVERSIBLE');

      const results = await Promise.all([status(ctx, sale.body.id, 'CANCELLED'), status(ctx, sale.body.id, 'CANCELLED')]);
      expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
      expect(await balance(ctx, c.id)).toBe(1_000);
      expect(await prisma().cashbackEntry.count({ where: { reversedEntryId: use.id } })).toBe(1);
    });
  });

  describe('concurrency and idempotency', () => {
    it('ten simultaneous sales spending 300 each from a balance of 1000: exactly three go through', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await credit(ctx, c.id, 1_000);

      const results = await Promise.all(Array.from({ length: 10 }, () => pdv(ctx, { customerId: c.id, cashbackToUseCents: 300 })));
      const statuses = results.map((res) => res.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(3);
      expect(statuses.filter((s) => s === 409)).toHaveLength(7);
      expect(results.filter((res) => res.status === 409).every((res) => res.body.code === 'CASHBACK_INSUFFICIENT_BALANCE')).toBe(true);

      expect(await balance(ctx, c.id)).toBe(100);
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(3);
      const uses = await prisma().cashbackEntry.findMany({ where: { customerId: c.id, type: 'USE' } });
      expect(uses.map((use) => use.balanceAfterCents).sort((a, b) => b - a)).toEqual([700, 400, 100]);
      await expectLedgerConsistent(c.id);
    });

    it('repeating a sale with the same key returns the same order and debits once', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await credit(ctx, c.id, 1_000);
      const k = key();
      const first = await pdv(ctx, { customerId: c.id, cashbackToUseCents: 800, idempotencyKey: k }).expect(201);
      const again = await pdv(ctx, { customerId: c.id, cashbackToUseCents: 800, idempotencyKey: k }).expect(201);
      expect(again.body.id).toBe(first.body.id);
      expect(await balance(ctx, c.id)).toBe(200);
      expect(await prisma().cashbackEntry.count({ where: { customerId: c.id, type: 'USE' } })).toBe(1);

      // The same key with another amount of cashback is another sale: refused.
      expect((await pdv(ctx, { customerId: c.id, cashbackToUseCents: 100, idempotencyKey: k }).expect(409)).body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect((await pdv(ctx, { customerId: c.id, idempotencyKey: k }).expect(409)).body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('six simultaneous duplicates of a sale that takes the whole balance all answer with the one order', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await credit(ctx, c.id, 1_000);
      const k = key();
      const results = await Promise.all(Array.from({ length: 6 }, () => pdv(ctx, { customerId: c.id, cashbackToUseCents: 1_000, idempotencyKey: k })));
      expect(results.map((res) => res.status)).toEqual(Array(6).fill(201));
      expect(new Set(results.map((res) => res.body.id)).size).toBe(1);
      expect(await balance(ctx, c.id)).toBe(0);
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
      expect(await prisma().cashbackEntry.count({ where: { customerId: c.id, type: 'USE' } })).toBe(1);
    });

    it('eight orders of one customer completed at the same time all earn, and the balance adds up', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const orders = [];
      for (let i = 0; i < 8; i++) orders.push((await pdv(ctx, { customerId: c.id }).expect(201)).body);
      await prisma().order.updateMany({ where: { id: { in: orders.map((o) => o.id) } }, data: { status: 'READY' } });

      const results = await Promise.all(orders.map((order) => status(ctx, order.id, 'COMPLETED')));
      expect(results.every((res) => res.status === 200)).toBe(true);
      expect(await balance(ctx, c.id)).toBe(8 * 400);
      await expectLedgerConsistent(c.id);
    });
  });

  describe('customer changes', () => {
    it('an order that spent or earned cashback cannot change customer while the movement stands', async () => {
      const ctx = await setup();
      const first = await newCustomer(ctx, 'Primeira Cliente');
      const second = await newCustomer(ctx, 'Segunda Cliente');
      await credit(ctx, first.id, 1_000);

      const spent = await pdv(ctx, { customerId: first.id, cashbackToUseCents: 500 }).expect(201);
      for (const target of [second.id, null]) {
        expect((await patch(ctx.accessToken, `/v1/orders/${spent.body.id}/customer`, { customerId: target }).expect(409)).body.code).toBe('ORDER_HAS_CASHBACK');
      }
      // Cancelled: the use was refunded, the order is free to be filed under someone else.
      await status(ctx, spent.body.id, 'CANCELLED').expect(200);
      await patch(ctx.accessToken, `/v1/orders/${spent.body.id}/customer`, { customerId: second.id }).expect(200);

      const earned = await pdv(ctx, { customerId: first.id }).expect(201);
      await complete(ctx, earned.body.id);
      expect((await patch(ctx.accessToken, `/v1/orders/${earned.body.id}/customer`, { customerId: second.id }).expect(409)).body.code).toBe('ORDER_HAS_CASHBACK');
      expect(await balance(ctx, second.id)).toBe(0);
    });

    it('linking a customer to an already completed order earns then, once', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const order = (await pdv(ctx).expect(201)).body;
      await complete(ctx, order.id);
      await patch(ctx.accessToken, `/v1/orders/${order.id}/customer`, { customerId: c.id }).expect(200);
      await patch(ctx.accessToken, `/v1/orders/${order.id}/customer`, { customerId: c.id }).expect(200);
      expect(await balance(ctx, c.id)).toBe(400);
      expect(await prisma().cashbackEntry.count({ where: { orderId: order.id, type: 'EARN' } })).toBe(1);
    });
  });

  describe('together with loyalty points', () => {
    it('one completed order credits both, each on its own base, and neither blocks the other under load', async () => {
      const ctx = await setup();
      await put(ctx.accessToken, '/v1/loyalty/program', { enabled: true, pointsPerReal: 1 }).expect(200);
      const c = await newCustomer(ctx);
      await credit(ctx, c.id, 1_000);

      const sale = await pdv(ctx, { customerId: c.id, cashbackToUseCents: 1_000 }, 2).expect(201); // 8000, paid 7000
      await complete(ctx, sale.body.id);
      expect(await balance(ctx, c.id)).toBe(700); // 10% of the 7000 paid with money
      const points = (await get(ctx.accessToken, `/v1/loyalty/customers/${c.id}`).expect(200)).body.balancePoints;
      expect(points).toBe(80); // points count the items after the coupon: 8000

      // Sales that lock the cashback account first and conclusions that lock both accounts,
      // all at once for the same customer: no deadlock, every request gets an answer.
      const open = [];
      for (let i = 0; i < 4; i++) open.push((await pdv(ctx, { customerId: c.id }).expect(201)).body);
      await prisma().order.updateMany({ where: { id: { in: open.map((o) => o.id) } }, data: { status: 'READY' } });
      const mixed = await Promise.all([
        ...open.map((order) => status(ctx, order.id, 'COMPLETED')),
        ...Array.from({ length: 4 }, () => pdv(ctx, { customerId: c.id, cashbackToUseCents: 100 })),
      ]);
      expect(mixed.map((res) => res.status).filter((s) => s >= 500)).toEqual([]);
      expect(mixed.slice(0, 4).every((res) => res.status === 200)).toBe(true);
      await expectLedgerConsistent(c.id);
    });
  });
});
