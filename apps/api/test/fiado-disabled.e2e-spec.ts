import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createActiveProductE2E,
  createStaffAndLoginE2E,
  createTestApp,
  getPrisma,
  injectAuditFailure,
  registerTenantE2E,
  removeAuditFailure,
  roundBody,
  statusBody,
  uniqueSuffix,
} from './test-app.util';
import { makeLegacyFiadoSaleE2E } from './legacy-fiado.util';

type Json = Record<string, unknown>;

// remocao-fiado (2026-11-12): the owner decided the system does not sell on account. Every new
// sale is paid now (cash, PIX or card); no route grants credit or opens a debt. The fiado sales
// and debts that already exist keep their history and can still be received, reversed, cancelled
// and reported. Replaces receivables-orders.e2e-spec.ts (selling on account), whose guarantees
// about EXISTING debts are kept here, on fiado sales from before (makeLegacyFiadoSaleE2E).
describe('Fiado disabled (e2e)', () => {
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
  const post = (token: string, path: string, body: Json = {}) =>
    request(server).post(path).set(auth(token)).send(body);
  const put = (token: string, path: string, body: Json) =>
    request(server).put(path).set(auth(token)).send(body);
  const patch = (token: string, path: string, body: Json) =>
    request(server).patch(path).set(auth(token)).send(body);
  const prisma = () => getPrisma(app);
  const key = () => `fd-${uniqueSuffix()}`;
  let seq = 0;
  const phone = () => `114${String(Date.now() + ++seq).slice(-8)}`;
  const today = () =>
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
  const shift = (day: string, days: number) => {
    const date = new Date(`${day}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };

  // Burger R$ 40,00 (4000 cents).
  async function setup() {
    const tenant = await registerTenantE2E(server);
    const product = await createActiveProductE2E(
      server,
      tenant.accessToken,
      `Burger ${uniqueSuffix()}`,
      40,
    );
    return { ...tenant, product };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const newCustomer = async (ctx: Ctx, name = 'Maria Souza') =>
    (await post(ctx.accessToken, '/v1/customers', { name, phone: phone() }).expect(201)).body as {
      id: string;
    };
  const pdv = (ctx: Ctx, extra: Json = {}, quantity = 1, token = ctx.accessToken) =>
    post(token, '/v1/pos/orders', {
      branchId: ctx.branchId,
      items: [{ productId: ctx.product.id, quantity }],
      paymentMethod: 'PIX',
      ...extra,
    });
  async function openTab(ctx: Ctx, number: number, quantity = 1) {
    const table = (
      await post(ctx.accessToken, '/v1/tables', { branchId: ctx.branchId, number }).expect(201)
    ).body;
    const tab = (
      await post(ctx.accessToken, '/v1/tabs', { branchId: ctx.branchId, tableId: table.id }).expect(
        201,
      )
    ).body;
    await post(
      ctx.accessToken,
      `/v1/tabs/${tab.id}/rounds`,
      roundBody([{ productId: ctx.product.id, quantity }]),
    ).expect(201);
    return tab as { id: string };
  }
  const checkout = (ctx: Ctx, tabId: string, extra: Json) =>
    post(ctx.accessToken, `/v1/tabs/${tabId}/checkout`, { idempotencyKey: key(), ...extra });
  const status = (ctx: Ctx, orderId: string, next: string) =>
    patch(ctx.accessToken, `/v1/orders/${orderId}/status`, statusBody(next));
  const openCash = (ctx: Ctx, openingBalanceCents = 0) =>
    post(ctx.accessToken, '/v1/cash/sessions', { branchId: ctx.branchId, openingBalanceCents })
      .expect(201)
      .then((res) => res.body as { id: string });
  const balance = async (ctx: Ctx, customerId: string) =>
    (await get(ctx.accessToken, `/v1/receivables/customers/${customerId}`).expect(200)).body
      .balanceCents as number;
  // A fiado sale from before the change, for `customerId`.
  async function legacySale(ctx: Ctx, customerId: string, quantity = 1) {
    const sale = await pdv(ctx, { customerId }, quantity).expect(201);
    const { receivableId } = await makeLegacyFiadoSaleE2E(app, {
      orderId: sale.body.id,
      customerId,
      firstDueDate: shift(today(), 30),
    });
    return { orderId: sale.body.id as string, receivableId };
  }
  async function expectLedgerConsistent(customerId: string) {
    const stored = await prisma().creditAccount.findUnique({ where: { customerId } });
    const entries = await prisma().receivableEntry.findMany({ where: { customerId } });
    expect(stored?.balanceCents ?? 0).toBe(
      entries.reduce((total, entry) => total + entry.amountCents, 0),
    );
    const live = await prisma().receivable.findMany({
      where: { customerId, status: { not: 'CANCELLED' } },
    });
    expect(stored?.balanceCents ?? 0).toBe(
      live.reduce((total, r) => total + r.totalCents - r.paidCents, 0),
    );
  }

  describe('no new sale on account', () => {
    it('the PDV refuses fiado, for the owner too, with or without terms, and writes nothing', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const refused = await pdv(ctx, {
        paymentMethod: 'ON_ACCOUNT',
        customerId: c.id,
        idempotencyKey: key(),
      }).expect(400);
      expect(refused.body.message).toContain('fiado');
      await pdv(ctx, {
        paymentMethod: 'ON_ACCOUNT',
        customerId: c.id,
        creditTerms: { installments: 2, firstDueDate: shift(today(), 10) },
      }).expect(400);
      // A sale paid now with leftover terms is refused as well: the field does not exist any more.
      await pdv(ctx, {
        paymentMethod: 'PIX',
        customerId: c.id,
        creditTerms: { installments: 1, firstDueDate: shift(today(), 10) },
      }).expect(400);
      // Nor can a cashier, who used to sell on account at the counter.
      const cashier = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'CASHIER', [
        ctx.branchId,
      ]);
      await pdv(ctx, { paymentMethod: 'ON_ACCOUNT', customerId: c.id }, 1, cashier).expect(400);

      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect(await prisma().receivable.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect(await prisma().creditAccount.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
    });

    it('the table checkout refuses fiado and the bill stays open; it is then paid normally', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const tab = await openTab(ctx, 1, 2);
      expect(
        (await checkout(ctx, tab.id, { paymentMethod: 'ON_ACCOUNT', customerId: c.id }).expect(400))
          .body.message,
      ).toContain('fiado');
      expect((await prisma().tab.findUniqueOrThrow({ where: { id: tab.id } })).status).toBe('OPEN');
      expect(await prisma().order.count({ where: { tabId: tab.id } })).toBe(0);
      await checkout(ctx, tab.id, { paymentMethod: 'PIX', customerId: c.id }).expect(200);
      expect(await prisma().receivable.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
    });

    it('no route grants credit or opens a debt any more', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await put(ctx.accessToken, `/v1/receivables/customers/${c.id}/limit`, {
        creditLimitCents: 10_000,
      }).expect(404);
      await post(ctx.accessToken, '/v1/receivables', {
        customerId: c.id,
        branchId: ctx.branchId,
        description: 'Saldo anterior',
        totalCents: 1_000,
        installments: 1,
        firstDueDate: shift(today(), 10),
        idempotencyKey: key(),
      }).expect(404);
      expect(await balance(ctx, c.id)).toBe(0);
    });

    it('the permission to sell on account is gone from every role', async () => {
      const rows = await prisma().rolePermission.count({
        where: { permission: { key: 'receivables.sell' } },
      });
      expect(rows).toBe(0);
      const ctx = await setup();
      const me = (await get(ctx.accessToken, '/v1/auth/me').expect(200)).body as {
        permissions?: string[];
      };
      if (me.permissions) expect(me.permissions).not.toContain('receivables.sell');
    });
  });

  describe('the normal methods keep working', () => {
    it('cash, PIX and card at the PDV; only cash enters the drawer, and the drawer closes without difference', async () => {
      const ctx = await setup();
      const session = await openCash(ctx, 1_000);
      const cash = await pdv(ctx, { paymentMethod: 'CASH' }).expect(201);
      const pix = await pdv(ctx, { paymentMethod: 'PIX' }, 2).expect(201);
      const card = await pdv(ctx, { paymentMethod: 'CARD' }, 3).expect(201);
      const rows = await prisma().order.findMany({
        where: { id: { in: [cash.body.id, pix.body.id, card.body.id] } },
        orderBy: { totalCents: 'asc' },
      });
      expect(rows.map((o) => [o.paymentMethod, o.totalCents])).toEqual([
        ['CASH', 4_000],
        ['PIX', 8_000],
        ['CARD', 12_000],
      ]);
      const drawer = (await get(ctx.accessToken, `/v1/cash/sessions/${session.id}`).expect(200))
        .body;
      expect(drawer.totals.salesCents).toBe(4_000);
      expect(drawer.expectedBalanceCents).toBe(5_000);
      const closed = (
        await patch(ctx.accessToken, `/v1/cash/sessions/${session.id}/close`, {
          countedClosingBalanceCents: 5_000,
        }).expect(200)
      ).body;
      expect(closed).toMatchObject({ status: 'CLOSED' });
      expect(await prisma().receivable.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
    });

    it('table bills by cash, PIX and card each record their payment', async () => {
      const ctx = await setup();
      await openCash(ctx);
      for (const [index, method] of (['CASH', 'PIX', 'CARD'] as const).entries()) {
        const tab = await openTab(ctx, index + 1);
        await checkout(ctx, tab.id, { paymentMethod: method }).expect(200);
        const order = await prisma().order.findUniqueOrThrow({
          where: { tabId: tab.id },
          include: { payment: true },
        });
        expect(order.payment).toMatchObject({ method, status: 'CONFIRMED', amountCents: 4_000 });
      }
      expect(
        await prisma().cashMovement.count({ where: { tenantId: ctx.tenantId, type: 'SALE' } }),
      ).toBe(1);
    });

    it('cancelling a cash sale gives the money back through the drawer', async () => {
      const ctx = await setup();
      const session = await openCash(ctx);
      const sale = await pdv(ctx, { paymentMethod: 'CASH' }).expect(201);
      await status(ctx, sale.body.id, 'CANCELLED').expect(200);
      const drawer = (await get(ctx.accessToken, `/v1/cash/sessions/${session.id}`).expect(200))
        .body;
      expect(drawer.expectedBalanceCents).toBe(0);
    });
  });

  describe('fiado sales and debts from before', () => {
    it('stay in the order history as fiado, and their debt can be seen and received', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const { orderId, receivableId } = await legacySale(ctx, c.id, 2); // 8000
      expect((await get(ctx.accessToken, `/v1/orders/${orderId}`).expect(200)).body).toMatchObject({
        paymentMethod: 'ON_ACCOUNT',
      });
      const listed = (await get(ctx.accessToken, `/v1/receivables?customerId=${c.id}`).expect(200))
        .body;
      expect(listed.data.map((r: { id: string }) => r.id)).toEqual([receivableId]);
      expect(await balance(ctx, c.id)).toBe(8_000);

      const session = await openCash(ctx);
      await post(ctx.accessToken, `/v1/receivables/${receivableId}/payments`, {
        amountCents: 3_000,
        method: 'CASH',
        branchId: ctx.branchId,
        idempotencyKey: key(),
      }).expect(200);
      await post(ctx.accessToken, `/v1/receivables/${receivableId}/payments`, {
        amountCents: 5_000,
        method: 'CARD',
        branchId: ctx.branchId,
        idempotencyKey: key(),
      }).expect(200);
      expect(
        (await get(ctx.accessToken, `/v1/receivables/${receivableId}`).expect(200)).body,
      ).toMatchObject({ status: 'PAID', paidCents: 8_000 });
      const drawer = (await get(ctx.accessToken, `/v1/cash/sessions/${session.id}`).expect(200))
        .body;
      expect(drawer.totals.receivablePaymentsCents).toBe(3_000);
      expect(await balance(ctx, c.id)).toBe(0);
      await expectLedgerConsistent(c.id);
    });

    it('cancelling the order cancels its debt in the same transaction', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const { orderId, receivableId } = await legacySale(ctx, c.id, 2);
      await status(ctx, orderId, 'CANCELLED').expect(200);
      const receivable = await prisma().receivable.findUniqueOrThrow({
        where: { id: receivableId },
      });
      expect(receivable).toMatchObject({ status: 'CANCELLED', paidCents: 0 });
      expect(receivable.cancelReason).toMatch(/pedido cancelado/i);
      expect(await balance(ctx, c.id)).toBe(0);
      await expectLedgerConsistent(c.id);
    });

    it('is refused while the debt has payments; after they are reversed the order can be cancelled', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const { orderId, receivableId } = await legacySale(ctx, c.id);
      const paid = await post(ctx.accessToken, `/v1/receivables/${receivableId}/payments`, {
        amountCents: 1_500,
        method: 'PIX',
        branchId: ctx.branchId,
        idempotencyKey: key(),
      }).expect(200);
      expect((await status(ctx, orderId, 'CANCELLED').expect(409)).body.code).toBe(
        'RECEIVABLE_HAS_PAYMENTS',
      );
      expect(await balance(ctx, c.id)).toBe(2_500);
      await post(ctx.accessToken, `/v1/receivables/entries/${paid.body.entryId}/reverse`, {
        reason: 'Pedido será cancelado',
        idempotencyKey: key(),
      }).expect(200);
      await status(ctx, orderId, 'CANCELLED').expect(200);
      expect(await balance(ctx, c.id)).toBe(0);
      await expectLedgerConsistent(c.id);
    });

    it('a debt forgiven by hand leaves the order alone; cancelling the order later is harmless', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const { orderId, receivableId } = await legacySale(ctx, c.id);
      await post(ctx.accessToken, `/v1/receivables/${receivableId}/cancel`, {
        reason: 'Cortesia da casa',
      }).expect(200);
      expect((await prisma().order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
        'PENDING',
      );
      await status(ctx, orderId, 'CANCELLED').expect(200);
      expect(await prisma().receivableEntry.count({ where: { receivableId } })).toBe(2);
      expect(
        (await prisma().receivable.findUniqueOrThrow({ where: { id: receivableId } })).cancelReason,
      ).toBe('Cortesia da casa');
      await expectLedgerConsistent(c.id);
    });

    it('when the audit of the cancellation cannot be written, the order and the debt stay', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const { orderId, receivableId } = await legacySale(ctx, c.id);
      await injectAuditFailure(
        app,
        'fail_audit_fiado_disabled_test',
        ctx.tenantId,
        'RECEIVABLE_CANCELLED',
      );
      try {
        await status(ctx, orderId, 'CANCELLED').expect(500);
      } finally {
        await removeAuditFailure(app, 'fail_audit_fiado_disabled_test');
      }
      expect((await prisma().order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe(
        'PENDING',
      );
      expect(
        (await prisma().receivable.findUniqueOrThrow({ where: { id: receivableId } })).status,
      ).toBe('OPEN');
      expect(await balance(ctx, c.id)).toBe(4_000);
    });

    it('the order keeps its customer while the debt exists', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      const other = await newCustomer(ctx, 'João Lima');
      const { orderId } = await legacySale(ctx, c.id);
      for (const target of [other.id, null]) {
        expect(
          (
            await patch(ctx.accessToken, `/v1/orders/${orderId}/customer`, {
              customerId: target,
            }).expect(409)
          ).body.code,
        ).toBe('ORDER_HAS_RECEIVABLE');
      }
      expect((await prisma().order.findUniqueOrThrow({ where: { id: orderId } })).customerId).toBe(
        c.id,
      );
    });

    it('the sales report keeps the fiado of before apart from what was paid now', async () => {
      const ctx = await setup();
      const c = await newCustomer(ctx);
      await legacySale(ctx, c.id);
      await pdv(ctx, { paymentMethod: 'CARD' }).expect(201);
      const body = (await get(ctx.accessToken, '/v1/reports/sales').expect(200)).body;
      const methods = Object.fromEntries(
        (body.byPaymentMethod as { key: string; ordersCount: number; totalCents: number }[]).map(
          (row) => [row.key, [row.ordersCount, row.totalCents]],
        ),
      );
      expect(methods).toMatchObject({ ON_ACCOUNT: [1, 4_000], CARD: [1, 4_000] });
    });

    it('another restaurant sees none of it', async () => {
      const a = await setup();
      const b = await setup();
      const c = await newCustomer(a);
      const { orderId, receivableId } = await legacySale(a, c.id);
      await get(b.accessToken, `/v1/orders/${orderId}`).expect(404);
      await get(b.accessToken, `/v1/receivables/${receivableId}`).expect(404);
      await get(b.accessToken, `/v1/receivables/customers/${c.id}`).expect(404);
      await post(b.accessToken, `/v1/receivables/${receivableId}/payments`, {
        amountCents: 100,
        method: 'PIX',
        branchId: b.branchId,
        idempotencyKey: key(),
      }).expect(404);
      await post(b.accessToken, `/v1/receivables/${receivableId}/cancel`, {
        reason: 'Tentativa',
      }).expect(404);
      expect(
        (await get(b.accessToken, '/v1/receivables?status=all').expect(200)).body.data,
      ).toEqual([]);
      expect(await balance(a, c.id)).toBe(4_000);
    });
  });
});
