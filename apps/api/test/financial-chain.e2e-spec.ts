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
  statusBody,
  roundBody,
} from './test-app.util';
import { makeLegacyFiadoSaleE2E } from './legacy-fiado.util';

type Json = Record<string, unknown>;

// The whole financial chain of ONE order, across modules: coupon -> cashback -> fiado -> cash
// -> stock -> audit. Each module has its own spec; this one checks that they hold TOGETHER:
// one sale moving several ledgers, its cancellation undoing all of them or none, and the
// flows that lock the same rows from different directions.
// Fiado is no longer sold (remocao-fiado): a NEW sale on account is refused, and the fiado
// sales from before (makeLegacyFiadoSaleE2E) still unwind every ledger when cancelled.
// Burger R$ 40,00, made of 1 unit of one ingredient.
describe('Financial chain of an order (e2e)', () => {
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
  const key = () => `chain-${uniqueSuffix()}`;

  let seq = 0;
  const phone = () => `115${String(Date.now() + ++seq).slice(-8)}`;
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const shift = (day: string, days: number) => {
    const date = new Date(`${day}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };

  // A restaurant with stock control on the burger, cashback at 10% and a customer who has
  // R$ 500,00 of cashback and R$ 5.000,00 of credit limit.
  async function setup() {
    const tenant = await registerTenantE2E(server);
    const burger = await createActiveProductE2E(server, tenant.accessToken, `Burger ${uniqueSuffix()}`, 40);
    const ingredient = (await post(tenant.accessToken, '/v1/inventory/items', { name: `Pão ${uniqueSuffix()}`, unit: 'UNIT' }).expect(201)).body as { id: string };
    await post(tenant.accessToken, '/v1/inventory/movements', {
      branchId: tenant.branchId,
      inventoryItemId: ingredient.id,
      type: 'ENTRY',
      quantity: 1_000,
      unitCostCents: 100,
    }).expect(201);
    await put(tenant.accessToken, `/v1/inventory/recipes/${burger.id}`, { items: [{ inventoryItemId: ingredient.id, quantity: 1 }] }).expect(200);
    await put(tenant.accessToken, '/v1/cashback/program', { enabled: true, earnRateBps: 1000, expireAfterDays: null }).expect(200);
    const customer = (await post(tenant.accessToken, '/v1/customers', { name: 'Cliente da Cadeia', phone: phone() }).expect(201)).body as { id: string };
    await post(tenant.accessToken, `/v1/cashback/customers/${customer.id}/adjust`, { amountCents: 50_000, reason: 'Saldo inicial do teste', idempotencyKey: key() }).expect(200);
    return { ...tenant, burger, ingredient, customer };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const pdv = (ctx: Ctx, extra: Json = {}, quantity = 1) =>
    post(ctx.accessToken, '/v1/pos/orders', {
      branchId: ctx.branchId,
      items: [{ productId: ctx.burger.id, quantity }],
      paymentMethod: 'PIX',
      customerId: ctx.customer.id,
      ...extra,
    });
  // A fiado sale from before the change: sold today by PIX (no drawer, no payment row), then
  // turned into what a sale on account was, with its receivable. Same shape as a supertest reply.
  const legacySale = async (ctx: Ctx, extra: Json = {}, quantity = 1, installments = 1) => {
    const sale = await pdv(ctx, { ...extra, paymentMethod: 'PIX' }, quantity).expect(201);
    await makeLegacyFiadoSaleE2E(app, { orderId: sale.body.id, customerId: ctx.customer.id, installments, firstDueDate: shift(today(), 10) });
    return sale;
  };
  const status = (ctx: Ctx, orderId: string, next: string) => patch(ctx.accessToken, `/v1/orders/${orderId}/status`, statusBody(next));

  const stock = async (ctx: Ctx) =>
    Number((await prisma().inventoryBalance.findFirstOrThrow({ where: { branchId: ctx.branchId, inventoryItemId: ctx.ingredient.id } })).quantity);
  const cashback = async (ctx: Ctx) => (await get(ctx.accessToken, `/v1/cashback/customers/${ctx.customer.id}`).expect(200)).body.balanceCents as number;
  const debt = async (ctx: Ctx) => (await get(ctx.accessToken, `/v1/receivables/customers/${ctx.customer.id}`).expect(200)).body.balanceCents as number;
  const orderRow = (id: string) => prisma().order.findUniqueOrThrow({ where: { id } });
  const actions = async (ctx: Ctx) =>
    (await prisma().auditLog.findMany({ where: { tenantId: ctx.tenantId }, select: { action: true } })).map((row) => row.action);

  // Every ledger equals the sum of its entries, and the stock balance equals the sum of its
  // movements: nothing was lost or applied twice anywhere in the chain.
  async function expectEverythingConsistent(ctx: Ctx) {
    const customerId = ctx.customer.id;
    const cashbackAccount = await prisma().cashbackAccount.findUnique({ where: { customerId } });
    const cashbackEntries = await prisma().cashbackEntry.findMany({ where: { customerId } });
    expect(cashbackAccount?.balanceCents ?? 0).toBe(cashbackEntries.reduce((sum, entry) => sum + entry.amountCents, 0));

    const creditAccount = await prisma().creditAccount.findUnique({ where: { customerId } });
    const creditEntries = await prisma().receivableEntry.findMany({ where: { customerId } });
    expect(creditAccount?.balanceCents ?? 0).toBe(creditEntries.reduce((sum, entry) => sum + entry.amountCents, 0));
    const live = await prisma().receivable.findMany({ where: { customerId, status: { not: 'CANCELLED' } } });
    expect(creditAccount?.balanceCents ?? 0).toBe(live.reduce((sum, receivable) => sum + receivable.totalCents - receivable.paidCents, 0));

    const movements = await prisma().stockMovement.findMany({ where: { branchId: ctx.branchId, inventoryItemId: ctx.ingredient.id } });
    expect(await stock(ctx)).toBe(movements.reduce((sum, movement) => sum + Number(movement.quantity), 0));

    // No order is left half-way: what an order says it used is what its ledgers recorded.
    const orders = await prisma().order.findMany({ where: { tenantId: ctx.tenantId } });
    for (const order of orders) {
      const used = cashbackEntries.filter((entry) => entry.orderId === order.id && entry.type === 'USE');
      expect(used.reduce((sum, entry) => sum - entry.amountCents, 0)).toBe(order.cashbackUsedCents);
      expect(order.totalCents).toBe(order.subtotalCents - order.discountCents - order.cashbackUsedCents + order.deliveryFeeCents);
    }
  }

  describe('one sale moving every ledger', () => {
    it('a NEW sale on account is refused before any ledger moves, with or without terms', async () => {
      const ctx = await setup();
      const code = `NEG${uniqueSuffix().replace(/-/g, '').slice(-8)}`.toUpperCase();
      await post(ctx.accessToken, '/v1/coupons', { code, discountType: 'FIXED', value: 1_000, usageLimit: 5 }).expect(201);
      const refused = await pdv(ctx, { paymentMethod: 'ON_ACCOUNT', couponCode: code, cashbackToUseCents: 2_000, idempotencyKey: key() }, 3).expect(400);
      expect(refused.body.message).toContain('fiado');
      await pdv(ctx, { paymentMethod: 'ON_ACCOUNT', creditTerms: { installments: 2, firstDueDate: shift(today(), 10) } }).expect(400);
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect([await cashback(ctx), await debt(ctx), await stock(ctx)]).toEqual([50_000, 0, 1_000]);
      expect((await prisma().coupon.findFirstOrThrow({ where: { tenantId: ctx.tenantId } })).usageCount).toBe(0);
      await expectEverythingConsistent(ctx);
    });

    it('a fiado sale from before (coupon, cashback, debt): each ledger has its part, and cancelling gives everything back', async () => {
      const ctx = await setup();
      const code = `CAD${uniqueSuffix().replace(/-/g, '').slice(-8)}`.toUpperCase();
      await post(ctx.accessToken, '/v1/coupons', { code, discountType: 'FIXED', value: 1_000, usageLimit: 5 }).expect(201);

      // 3 burgers = 12000; coupon -1000; cashback -2000; on account 9000 in 2 installments.
      const sale = await legacySale(ctx, { couponCode: code, cashbackToUseCents: 2_000, idempotencyKey: key() }, 3, 2);
      expect(await orderRow(sale.body.id)).toMatchObject({ subtotalCents: 12_000, discountCents: 1_000, cashbackUsedCents: 2_000, deliveryFeeCents: 0, totalCents: 9_000, paymentMethod: 'ON_ACCOUNT' });
      expect([await cashback(ctx), await debt(ctx), await stock(ctx)]).toEqual([48_000, 9_000, 1_000]);
      const coupon = await prisma().coupon.findFirstOrThrow({ where: { tenantId: ctx.tenantId } });
      expect(coupon.usageCount).toBe(1);
      const receivable = await prisma().receivable.findUniqueOrThrow({ where: { orderId: sale.body.id }, include: { installments: { orderBy: { number: 'asc' } } } });
      expect(receivable.installments.map((installment) => installment.amountCents)).toEqual([4_500, 4_500]);
      // Nothing was received: no payment row, no cash movement.
      expect(await prisma().payment.count({ where: { orderId: sale.body.id } })).toBe(0);
      expect(await prisma().cashMovement.count({ where: { orderId: sale.body.id } })).toBe(0);

      // Confirmed: the kitchen takes the ingredients.
      await status(ctx, sale.body.id, 'CONFIRMED').expect(200);
      expect(await stock(ctx)).toBe(997);
      await expectEverythingConsistent(ctx);

      // Cancelled: cashback back, debt gone, ingredients back. The coupon use is kept (CRM.md).
      await status(ctx, sale.body.id, 'CANCELLED').expect(200);
      expect([await cashback(ctx), await debt(ctx), await stock(ctx)]).toEqual([50_000, 0, 1_000]);
      expect((await prisma().coupon.findUniqueOrThrow({ where: { id: coupon.id } })).usageCount).toBe(1);
      expect((await prisma().receivable.findUniqueOrThrow({ where: { id: receivable.id } })).status).toBe('CANCELLED');
      // The order keeps the record of what it had used and how it was to be paid.
      expect(await orderRow(sale.body.id)).toMatchObject({ status: 'CANCELLED', cashbackUsedCents: 2_000, totalCents: 9_000 });
      await expectEverythingConsistent(ctx);

      const trail = await actions(ctx);
      for (const action of ['ORDER_CREATED', 'CASHBACK_USED', 'RECEIVABLE_CREATED', 'ORDER_STATUS_CHANGED', 'INVENTORY_MOVEMENT_CREATED', 'CASHBACK_USE_REFUNDED', 'RECEIVABLE_CANCELLED']) {
        expect(trail).toContain(action);
      }

      // Cancelling again is refused and moves nothing.
      await status(ctx, sale.body.id, 'CANCELLED').expect(409);
      expect([await cashback(ctx), await debt(ctx), await stock(ctx)]).toEqual([50_000, 0, 1_000]);
    });

    it('a cash sale with cashback puts in the drawer exactly what was received', async () => {
      const ctx = await setup();
      const session = (await post(ctx.accessToken, '/v1/cash/sessions', { branchId: ctx.branchId, openingBalanceCents: 1_000 }).expect(201)).body;
      const sale = await pdv(ctx, { paymentMethod: 'CASH', cashbackToUseCents: 1_500 }, 2).expect(201); // 8000 - 1500
      const drawer = (await get(ctx.accessToken, `/v1/cash/sessions/${session.id}`).expect(200)).body;
      expect(drawer.totals.salesCents).toBe(6_500);
      expect(drawer.expectedBalanceCents).toBe(7_500);
      expect((await prisma().cashMovement.findUniqueOrThrow({ where: { orderId: sale.body.id } })).amountCents).toBe(6_500);
      await expectEverythingConsistent(ctx);
    });
  });

  describe('cancellation is all or nothing across modules', () => {
    afterEach(() => removeAuditFailure(app, 'fail_audit_chain_test'));

    it.each([
      ['CASHBACK_USE_REFUNDED', 'the cashback refund'],
      ['RECEIVABLE_CANCELLED', 'the cancellation of the debt'],
    ])('when %s cannot be recorded (%s), the order stays and no ledger moves', async (action) => {
      const ctx = await setup();
      const sale = await legacySale(ctx, { cashbackToUseCents: 2_000 }, 2); // 8000 - 2000 = 6000
      await status(ctx, sale.body.id, 'CONFIRMED').expect(200);
      const before = { cashback: await cashback(ctx), debt: await debt(ctx), stock: await stock(ctx) };
      expect(before).toEqual({ cashback: 48_000, debt: 6_000, stock: 998 });
      const entries = {
        cashback: await prisma().cashbackEntry.count({ where: { tenantId: ctx.tenantId } }),
        credit: await prisma().receivableEntry.count({ where: { tenantId: ctx.tenantId } }),
        stock: await prisma().stockMovement.count({ where: { tenantId: ctx.tenantId } }),
      };

      await injectAuditFailure(app, 'fail_audit_chain_test', ctx.tenantId, action);
      await status(ctx, sale.body.id, 'CANCELLED').expect(500);

      expect((await orderRow(sale.body.id)).status).toBe('CONFIRMED');
      expect({ cashback: await cashback(ctx), debt: await debt(ctx), stock: await stock(ctx) }).toEqual(before);
      expect({
        cashback: await prisma().cashbackEntry.count({ where: { tenantId: ctx.tenantId } }),
        credit: await prisma().receivableEntry.count({ where: { tenantId: ctx.tenantId } }),
        stock: await prisma().stockMovement.count({ where: { tenantId: ctx.tenantId } }),
      }).toEqual(entries);
      await expectEverythingConsistent(ctx);

      // With the audit back, the same cancellation goes through, once.
      await removeAuditFailure(app, 'fail_audit_chain_test');
      await status(ctx, sale.body.id, 'CANCELLED').expect(200);
      expect({ cashback: await cashback(ctx), debt: await debt(ctx), stock: await stock(ctx) }).toEqual({ cashback: 50_000, debt: 0, stock: 1_000 });
      await expectEverythingConsistent(ctx);
    });
  });

  describe('double execution and races', () => {
    it('six simultaneous cancellations of the same sale undo it exactly once', async () => {
      const ctx = await setup();
      const sale = await legacySale(ctx, { cashbackToUseCents: 1_000 }, 2);
      await status(ctx, sale.body.id, 'CONFIRMED').expect(200);

      const results = await Promise.all(Array.from({ length: 6 }, () => status(ctx, sale.body.id, 'CANCELLED')));
      expect(results.map((res) => res.status).sort()).toEqual([200, 409, 409, 409, 409, 409]);
      expect([await cashback(ctx), await debt(ctx), await stock(ctx)]).toEqual([50_000, 0, 1_000]);
      expect(await prisma().cashbackEntry.count({ where: { orderId: sale.body.id, type: 'REVERSAL' } })).toBe(1);
      expect(await prisma().stockMovement.count({ where: { referenceId: sale.body.id, type: 'REVERSAL' } })).toBe(1);
      const receivable = await prisma().receivable.findUniqueOrThrow({ where: { orderId: sale.body.id } });
      expect(await prisma().receivableEntry.count({ where: { receivableId: receivable.id, type: 'REVERSAL' } })).toBe(1);
      await expectEverythingConsistent(ctx);
    });

    it('cancelling a fiado sale from before while its debt is being paid: one of the two wins, never both', async () => {
      const ctx = await setup();
      for (let round = 0; round < 8; round++) {
        const sale = await legacySale(ctx); // 4000
        const receivable = await prisma().receivable.findUniqueOrThrow({ where: { orderId: sale.body.id } });
        const [cancelled, paid] = await Promise.all([
          status(ctx, sale.body.id, 'CANCELLED'),
          post(ctx.accessToken, `/v1/receivables/${receivable.id}/payments`, { amountCents: 1_000, method: 'PIX', branchId: ctx.branchId, idempotencyKey: key() }),
        ]);
        const order = await orderRow(sale.body.id);
        const after = await prisma().receivable.findUniqueOrThrow({ where: { id: receivable.id } });
        if (cancelled.status === 200) {
          // The cancellation got there first: the payment found nothing open to pay.
          expect(paid.status).toBe(409);
          expect(paid.body.code).toBe('RECEIVABLE_NOT_OPEN');
          expect([order.status, after.status, after.paidCents]).toEqual(['CANCELLED', 'CANCELLED', 0]);
        } else {
          // The payment got there first: a debt with money received is not cancelled.
          expect([cancelled.status, cancelled.body.code]).toEqual([409, 'RECEIVABLE_HAS_PAYMENTS']);
          expect(paid.status).toBe(200);
          expect([order.status, after.status, after.paidCents]).toEqual(['PENDING', 'OPEN', 1_000]);
        }
      }
      await expectEverythingConsistent(ctx);
    });

    it('table bills and cancellations of the same customer, over the same ingredient, all get an answer (no deadlock)', async () => {
      const ctx = await setup();
      // Six confirmed counter sales that used cashback: cancelling each gives cashback AND
      // ingredients back.
      const toCancel: string[] = [];
      for (let i = 0; i < 6; i++) {
        const sale = await pdv(ctx, { cashbackToUseCents: 500 }).expect(201);
        await status(ctx, sale.body.id, 'CONFIRMED').expect(200);
        toCancel.push(sale.body.id);
      }
      // Six table bills of the same customer: closing each credits cashback (half of them also
      // spend some). B9: their ingredients were taken when each round went to the kitchen.
      const tabs: string[] = [];
      for (let i = 0; i < 6; i++) {
        const table = (await post(ctx.accessToken, '/v1/tables', { branchId: ctx.branchId, number: i + 1 }).expect(201)).body;
        const tab = (await post(ctx.accessToken, '/v1/tabs', { branchId: ctx.branchId, tableId: table.id }).expect(201)).body;
        await post(ctx.accessToken, `/v1/tabs/${tab.id}/rounds`, roundBody([{ productId: ctx.burger.id, quantity: 1 }])).expect(201);
        tabs.push(tab.id);
      }
      expect(await stock(ctx)).toBe(988);

      const results = await Promise.all([
        ...toCancel.map((id) => status(ctx, id, 'CANCELLED')),
        ...tabs.map((id, index) =>
          post(ctx.accessToken, `/v1/tabs/${id}/checkout`, {
            paymentMethod: 'PIX',
            idempotencyKey: key(),
            customerId: ctx.customer.id,
            ...(index % 2 === 0 ? { cashbackToUseCents: 300 } : {}),
          }),
        ),
      ]);
      expect(results.map((res) => res.status)).toEqual(Array(12).fill(200));

      // 6 cancelled sales returned their ingredient; the 6 table bills took nothing more (their
      // rounds already had).
      expect(await stock(ctx)).toBe(994);
      // 50000 - 6x500 used, +6x500 refunded, -3x300 used at the tables, + 10% of what each table paid:
      // 3 x floor(3700 x 10%) + 3 x floor(4000 x 10%) = 1110 + 1200.
      expect(await cashback(ctx)).toBe(50_000 - 900 + 2_310);
      await expectEverythingConsistent(ctx);
    });
  });

  describe('the idempotency key cannot turn a sale into fiado', () => {
    it('a sale paid now, repeated as fiado with the same key, is refused and the sale stays as it was', async () => {
      const ctx = await setup();
      const k = key();
      const paid = await pdv(ctx, { paymentMethod: 'CARD', idempotencyKey: k }, 3).expect(201); // 12000
      const refused = await pdv(ctx, { paymentMethod: 'ON_ACCOUNT', idempotencyKey: k }, 3).expect(400);
      expect(refused.body.message).toContain('fiado');
      expect((await pdv(ctx, { paymentMethod: 'CARD', idempotencyKey: k }, 3).expect(201)).body.id).toBe(paid.body.id);
      expect(await orderRow(paid.body.id)).toMatchObject({ paymentMethod: 'CARD', totalCents: 12_000 });
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
      expect(await prisma().receivable.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect(await debt(ctx)).toBe(0);
      await expectEverythingConsistent(ctx);
    });
  });
});
