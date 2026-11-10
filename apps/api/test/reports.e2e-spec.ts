import { INestApplication } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import request from 'supertest';
import { createActiveProductE2E, createStaffAndLoginE2E, createTestApp, getPrisma, registerTenantE2E, uniqueSuffix, statusBody, roundBody } from './test-app.util';

type Json = Record<string, unknown>;

// Fase 11, fatia 8: operational reports. Every figure asserted here can be checked by hand from
// the orders the test itself creates. Burger R$ 40,00 and soda R$ 7,00 throughout.
describe('Reports (e2e)', () => {
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
  const key = () => `rep-${uniqueSuffix()}`;

  let seq = 0;
  const phone = () => `114${String(Date.now() + ++seq).slice(-8)}`;
  const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const shift = (day: string, days: number) => {
    const date = new Date(`${day}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  };

  async function setup() {
    const tenant = await registerTenantE2E(server);
    const burger = await createActiveProductE2E(server, tenant.accessToken, `Burger ${uniqueSuffix()}`, 40);
    const soda = await createActiveProductE2E(server, tenant.accessToken, `Soda ${uniqueSuffix()}`, 7);
    return { ...tenant, burger, soda };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const sale = (ctx: Ctx, extra: Json = {}, items: { productId: string; quantity: number }[] = [{ productId: ctx.burger.id, quantity: 1 }], token = ctx.accessToken) =>
    post(token, '/v1/pos/orders', { branchId: ctx.branchId, items, paymentMethod: 'PIX', ...extra });
  const status = (ctx: Ctx, orderId: string, next: string) => patch(ctx.accessToken, `/v1/orders/${orderId}/status`, statusBody(next));
  async function complete(ctx: Ctx, orderId: string) {
    for (const next of ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED']) await status(ctx, orderId, next).expect(200);
  }
  const customer = async (ctx: Ctx, name: string) =>
    (await post(ctx.accessToken, '/v1/customers', { name, phone: phone() }).expect(201)).body as { id: string };
  const report = async (token: string, name: string, query = '') => (await get(token, `/v1/reports/${name}${query}`).expect(200)).body;
  const byKey = (rows: { key: string; ordersCount: number; totalCents: number }[]) =>
    Object.fromEntries(rows.map((row) => [row.key, [row.ordersCount, row.totalCents]]));

  describe('sales', () => {
    it('adds up what was sold, apart from what was cancelled, with every breakdown', async () => {
      const ctx = await setup();
      const fiado = await customer(ctx, 'Cliente Fiado');
      await put(ctx.accessToken, `/v1/receivables/customers/${fiado.id}/limit`, { creditLimitCents: 50_000 }).expect(200);
      await post(ctx.accessToken, '/v1/cash/sessions', { branchId: ctx.branchId, openingBalanceCents: 0 }).expect(201);
      const code = `REP${uniqueSuffix().replace(/-/g, '').slice(-8)}`.toUpperCase();
      await post(ctx.accessToken, '/v1/coupons', { code, discountType: 'FIXED', value: 500 }).expect(201);

      await sale(ctx, {}, [{ productId: ctx.burger.id, quantity: 2 }]).expect(201); // PIX 8000
      await sale(ctx, { paymentMethod: 'CASH' }).expect(201); // CASH 4000
      await sale(ctx, { couponCode: code }).expect(201); // PIX 4000 - 500 = 3500
      const cancelled = (await sale(ctx).expect(201)).body; // cancelled, 4000
      await status(ctx, cancelled.id, 'CANCELLED').expect(200);
      const done = (await sale(ctx).expect(201)).body; // PIX 4000, completed
      await complete(ctx, done.id);
      await sale(ctx, { paymentMethod: 'ON_ACCOUNT', customerId: fiado.id }).expect(201); // fiado 4000
      // A table bill: another source, born completed.
      const table = (await post(ctx.accessToken, '/v1/tables', { branchId: ctx.branchId, number: 1 }).expect(201)).body;
      const tab = (await post(ctx.accessToken, '/v1/tabs', { branchId: ctx.branchId, tableId: table.id }).expect(201)).body;
      await post(ctx.accessToken, `/v1/tabs/${tab.id}/rounds`, roundBody([{ productId: ctx.burger.id, quantity: 1 }])).expect(201);
      await post(ctx.accessToken, `/v1/tabs/${tab.id}/checkout`, { paymentMethod: 'CARD', idempotencyKey: key() }).expect(200); // CARD 4000

      const body = await report(ctx.accessToken, 'sales');
      expect(body.period).toEqual({ from: shift(today(), -29), to: today(), timezone: 'America/Sao_Paulo', days: 30 });
      expect(body.branchId).toBeNull();
      expect(body.totals).toEqual({
        ordersCount: 6,
        itemsCents: 28_000,
        discountCents: 500,
        cashbackUsedCents: 0,
        deliveryFeeCents: 0,
        totalCents: 27_500,
        averageTicketCents: 4_583, // 27500 / 6 = 4583,33
        concludedCount: 2,
        concludedCents: 8_000,
        onAccountCents: 4_000,
        cancelledCount: 1,
        cancelledCents: 4_000,
      });
      expect(byKey(body.byPaymentMethod)).toEqual({ PIX: [3, 15_500], CASH: [1, 4_000], ON_ACCOUNT: [1, 4_000], CARD: [1, 4_000] });
      expect(body.byPaymentMethod[0].key).toBe('PIX'); // largest first
      expect(byKey(body.bySource)).toEqual({ COUNTER: [5, 23_500], TABLE: [1, 4_000] });
      expect(byKey(body.byFulfillment)).toEqual({ PICKUP: [5, 23_500], DINE_IN: [1, 4_000] }); // a table bill is eaten in

      // Every day and every hour is present; the sales are all on today.
      expect(body.byDay).toHaveLength(30);
      expect(body.byDay[29]).toEqual({ day: today(), ordersCount: 6, totalCents: 27_500 });
      expect(body.byDay.slice(0, 29).every((row: { ordersCount: number; totalCents: number }) => row.ordersCount === 0 && row.totalCents === 0)).toBe(true);
      expect(body.byHour).toHaveLength(24);
      expect(body.byHour.reduce((sum: number, row: { totalCents: number }) => sum + row.totalCents, 0)).toBe(27_500);
      expect(body.byHour.reduce((sum: number, row: { ordersCount: number }) => sum + row.ordersCount, 0)).toBe(6);
      expect(JSON.stringify(body)).not.toMatch(/tenantId/);
    });

    it('counts a sale on the day and hour it happened in the restaurant, not in UTC', async () => {
      const ctx = await setup();
      const order = (await sale(ctx).expect(201)).body;
      // 23:30 of March 9th in São Paulo is 02:30 of March 10th in UTC.
      await prisma().order.update({ where: { id: order.id }, data: { createdAt: new Date('2026-03-10T02:30:00.000Z') } });

      const ninth = await report(ctx.accessToken, 'sales', '?from=2026-03-09&to=2026-03-09');
      expect(ninth.totals).toMatchObject({ ordersCount: 1, totalCents: 4_000 });
      expect(ninth.byDay).toEqual([{ day: '2026-03-09', ordersCount: 1, totalCents: 4_000 }]);
      expect(ninth.byHour[23]).toEqual({ hour: 23, ordersCount: 1, totalCents: 4_000 });
      const tenth = await report(ctx.accessToken, 'sales', '?from=2026-03-10&to=2026-03-10');
      expect(tenth.totals).toMatchObject({ ordersCount: 0, totalCents: 0 });

      // The same order, for a restaurant whose zone is UTC, belongs to the 10th at 02:00.
      await prisma().tenant.update({ where: { id: ctx.tenantId }, data: { timezone: 'UTC' } });
      const utc = await report(ctx.accessToken, 'sales', '?from=2026-03-10&to=2026-03-10');
      expect(utc.period.timezone).toBe('UTC');
      expect(utc.totals).toMatchObject({ ordersCount: 1 });
      expect(utc.byHour[2]).toMatchObject({ hour: 2, ordersCount: 1 });
      expect((await report(ctx.accessToken, 'sales', '?from=2026-03-09&to=2026-03-09')).totals.ordersCount).toBe(0);
    });

    it('the first and the last instant of a day belong to it; the next instant does not', async () => {
      const ctx = await setup();
      const at = async (iso: string) => {
        const order = (await sale(ctx).expect(201)).body;
        await prisma().order.update({ where: { id: order.id }, data: { createdAt: new Date(iso) } });
      };
      await at('2026-05-01T03:00:00.000Z'); // 00:00:00.000 local of May 1st
      await at('2026-05-02T02:59:59.999Z'); // 23:59:59.999 local of May 1st
      await at('2026-05-02T03:00:00.000Z'); // 00:00:00.000 local of May 2nd
      expect((await report(ctx.accessToken, 'sales', '?from=2026-05-01&to=2026-05-01')).totals.ordersCount).toBe(2);
      expect((await report(ctx.accessToken, 'sales', '?from=2026-05-02&to=2026-05-02')).totals.ordersCount).toBe(1);
      expect((await report(ctx.accessToken, 'sales', '?from=2026-05-01&to=2026-05-02')).totals.ordersCount).toBe(3);
    });

    it('a restaurant with nothing sold gets zeros, not errors', async () => {
      const ctx = await setup();
      const body = await report(ctx.accessToken, 'sales');
      expect(body.totals).toMatchObject({ ordersCount: 0, totalCents: 0, averageTicketCents: 0, cancelledCount: 0 });
      expect(body.byDay).toHaveLength(30);
      expect(body.byHour).toHaveLength(24);
      expect(body.byPaymentMethod).toEqual([]);
    });

    it('validates the period and refuses anything it does not know', async () => {
      const ctx = await setup();
      const code = async (query: string) => (await get(ctx.accessToken, `/v1/reports/sales${query}`).expect(400)).body.code;
      expect(await code('?from=2026-02-30')).toBe('REPORT_DATE_INVALID');
      expect(await code('?to=2026-13-01')).toBe('REPORT_DATE_INVALID');
      expect(await code('?from=2026-10-05&to=2026-10-04')).toBe('REPORT_RANGE_INVERTED');
      expect(await code('?from=2025-01-01&to=2026-10-05')).toBe('REPORT_RANGE_TOO_LONG');
      await get(ctx.accessToken, '/v1/reports/sales?from=05/10/2026').expect(400);
      await get(ctx.accessToken, '/v1/reports/sales?from=2026-10-05T00:00:00Z').expect(400);
      await get(ctx.accessToken, '/v1/reports/sales?branchId=not-a-uuid').expect(400);
      await get(ctx.accessToken, `/v1/reports/sales?tenantId=${ctx.tenantId}`).expect(400);
      await get(ctx.accessToken, '/v1/reports/products?pageSize=101').expect(400);
      await get(ctx.accessToken, '/v1/reports/products?page=0').expect(400);
      await get(ctx.accessToken, '/v1/reports/products?sort=price').expect(400);
      await get(ctx.accessToken, '/v1/reports/customers?sort=name').expect(400);
      await get(ctx.accessToken, '/v1/reports/inventory?sort=cost').expect(400);
      // Exactly one year is accepted.
      await get(ctx.accessToken, '/v1/reports/sales?from=2025-10-05&to=2026-10-05').expect(200);
    });
  });

  describe('products', () => {
    async function seeded() {
      const ctx = await setup();
      await sale(ctx, {}, [{ productId: ctx.burger.id, quantity: 2 }]).expect(201); // burger 2
      await sale(ctx, {}, [
        { productId: ctx.burger.id, quantity: 1 },
        { productId: ctx.soda.id, quantity: 5 },
      ]).expect(201); // burger 1, soda 5
      const cancelled = (await sale(ctx, {}, [{ productId: ctx.soda.id, quantity: 10 }]).expect(201)).body;
      await status(ctx, cancelled.id, 'CANCELLED').expect(200);
      return ctx;
    }

    it('ranks by revenue or by quantity, ignoring cancelled orders', async () => {
      const ctx = await seeded();
      const byRevenue = await report(ctx.accessToken, 'products');
      expect(byRevenue.totals).toEqual({ productsCount: 2, quantity: 8, revenueCents: 15_500 });
      expect(byRevenue.data).toEqual([
        expect.objectContaining({ productId: ctx.burger.id, quantity: 3, revenueCents: 12_000, ordersCount: 2, shareBps: 7_742, active: true }),
        expect.objectContaining({ productId: ctx.soda.id, quantity: 5, revenueCents: 3_500, ordersCount: 1, shareBps: 2_258 }),
      ]);
      expect(byRevenue.data[0].categoryName).toMatch(/^Categoria Burger/);
      expect(byRevenue.meta).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 });

      const byQuantity = await report(ctx.accessToken, 'products', '?sort=quantity');
      expect(byQuantity.data.map((row: { productId: string }) => row.productId)).toEqual([ctx.soda.id, ctx.burger.id]);
    });

    it('paginates without overlap and keeps the totals on any page', async () => {
      const ctx = await seeded();
      const first = await report(ctx.accessToken, 'products', '?pageSize=1&page=1');
      const second = await report(ctx.accessToken, 'products', '?pageSize=1&page=2');
      const beyond = await report(ctx.accessToken, 'products', '?pageSize=1&page=3');
      expect([first.data[0].productId, second.data[0].productId]).toEqual([ctx.burger.id, ctx.soda.id]);
      expect(first.meta).toEqual({ page: 1, pageSize: 1, total: 2, totalPages: 2 });
      expect(beyond.data).toEqual([]);
      expect(beyond.totals).toEqual({ productsCount: 2, quantity: 8, revenueCents: 15_500 });
    });

    it('filters by name and by category, treating the search as plain text', async () => {
      const ctx = await seeded();
      const found = await report(ctx.accessToken, 'products', '?search=burg');
      expect(found.data.map((row: { productId: string }) => row.productId)).toEqual([ctx.burger.id]);
      expect(found.totals).toEqual({ productsCount: 1, quantity: 3, revenueCents: 12_000 });
      expect(found.data[0].shareBps).toBe(10_000);

      for (const search of ["' OR 1=1 --", '%', '_', '\\', "'; DROP TABLE orders; --"]) {
        const none = await report(ctx.accessToken, 'products', `?search=${encodeURIComponent(search)}`);
        expect(none.data).toEqual([]);
        expect(none.totals).toEqual({ productsCount: 0, quantity: 0, revenueCents: 0 });
      }
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(3);

      const category = await prisma().product.findUniqueOrThrow({ where: { id: ctx.soda.id }, select: { categoryId: true } });
      const inCategory = await report(ctx.accessToken, 'products', `?categoryId=${category.categoryId}`);
      expect(inCategory.data.map((row: { productId: string }) => row.productId)).toEqual([ctx.soda.id]);
    });
  });

  describe('customers', () => {
    it('ranks who bought, and separates identified from anonymous orders', async () => {
      const ctx = await setup();
      const ana = await customer(ctx, 'Ana Compradora');
      const bia = await customer(ctx, 'Bia Compradora');
      await sale(ctx, { customerId: ana.id }, [{ productId: ctx.burger.id, quantity: 2 }]).expect(201); // 8000
      await sale(ctx, { customerId: ana.id }).expect(201); // 4000
      await sale(ctx, { customerId: bia.id }).expect(201); // 4000
      await sale(ctx).expect(201); // anonymous 4000
      const cancelled = (await sale(ctx, { customerId: ana.id }).expect(201)).body;
      await status(ctx, cancelled.id, 'CANCELLED').expect(200);

      const body = await report(ctx.accessToken, 'customers');
      expect(body.totals).toEqual({
        customersCount: 2,
        identifiedOrders: 3,
        identifiedCents: 16_000,
        anonymousOrders: 1,
        anonymousCents: 4_000,
        newCustomers: 2,
      });
      expect(body.data).toEqual([
        expect.objectContaining({ customerId: ana.id, name: 'Ana Compradora', ordersCount: 2, totalCents: 12_000, averageTicketCents: 6_000 }),
        expect.objectContaining({ customerId: bia.id, name: 'Bia Compradora', ordersCount: 1, totalCents: 4_000, averageTicketCents: 4_000 }),
      ]);
      expect(typeof body.data[0].lastOrderAt).toBe('string');
      expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 });

      const paged = await report(ctx.accessToken, 'customers', '?pageSize=1&page=2&sort=orders');
      expect(paged.data.map((row: { customerId: string }) => row.customerId)).toEqual([bia.id]);

      // Registered before the period: not "new" in it, though the purchases still count.
      await prisma().customer.updateMany({ where: { tenantId: ctx.tenantId }, data: { createdAt: new Date('2020-01-01T12:00:00.000Z') } });
      expect((await report(ctx.accessToken, 'customers')).totals).toMatchObject({ newCustomers: 0, customersCount: 2 });
    });
  });

  describe('inventory', () => {
    it('adds up purchases, consumption by sales, manual exits and losses per ingredient', async () => {
      const ctx = await setup();
      const item = async (name: string, unit: string) =>
        (await post(ctx.accessToken, '/v1/inventory/items', { name: `${name} ${uniqueSuffix()}`, unit }).expect(201)).body as { id: string };
      const move = (body: Json) => post(ctx.accessToken, '/v1/inventory/movements', { branchId: ctx.branchId, ...body });
      const meat = await item('Carne', 'KG');
      const bread = await item('Pão', 'UNIT');
      const oil = await item('Óleo', 'L');

      await move({ inventoryItemId: meat.id, type: 'ENTRY', quantity: 10, unitCostCents: 3_000 }).expect(201); // 30000
      await move({ inventoryItemId: bread.id, type: 'ENTRY', quantity: 50, unitCostCents: 100 }).expect(201); // 5000
      await move({ inventoryItemId: oil.id, type: 'ENTRY', quantity: 5, unitCostCents: 800 }).expect(201); // 4000
      await move({ inventoryItemId: oil.id, type: 'EXIT', quantity: 1, exitReason: 'CONSUMPTION' }).expect(201); // 800
      await move({ inventoryItemId: bread.id, type: 'EXIT', quantity: 4, exitReason: 'LOSS' }).expect(201); // 400 lost
      await put(ctx.accessToken, `/v1/inventory/recipes/${ctx.burger.id}`, {
        items: [
          { inventoryItemId: meat.id, quantity: 0.15 },
          { inventoryItemId: bread.id, quantity: 1 },
        ],
      }).expect(200);

      // 3 burgers confirmed (consumed), 2 more confirmed and then cancelled (consumed and given back).
      const kept = (await sale(ctx, {}, [{ productId: ctx.burger.id, quantity: 3 }]).expect(201)).body;
      await status(ctx, kept.id, 'CONFIRMED').expect(200);
      const undone = (await sale(ctx, {}, [{ productId: ctx.burger.id, quantity: 2 }]).expect(201)).body;
      await status(ctx, undone.id, 'CONFIRMED').expect(200);
      await status(ctx, undone.id, 'CANCELLED').expect(200);

      const body = await report(ctx.accessToken, 'inventory');
      const row = (id: string) => body.data.find((entry: { inventoryItemId: string }) => entry.inventoryItemId === id);
      expect(row(meat.id)).toMatchObject({
        unit: 'KG',
        purchasedQuantity: 10,
        purchasedCostCents: 30_000,
        soldQuantity: 0.45, // 3 x 0,15 (the cancelled order nets to zero)
        soldCostCents: 1_350,
        lossQuantity: 0,
        lossCostCents: 0,
        currentQuantity: 9.55,
      });
      expect(row(bread.id)).toMatchObject({ purchasedQuantity: 50, soldQuantity: 3, soldCostCents: 300, lossQuantity: 4, lossCostCents: 400, currentQuantity: 43 });
      expect(row(oil.id)).toMatchObject({ purchasedCostCents: 4_000, soldQuantity: 0, otherExitQuantity: 1, otherExitCostCents: 800, currentQuantity: 4 });
      expect(body.totals).toEqual({ itemsCount: 3, purchasedCostCents: 39_000, soldCostCents: 1_650, otherExitCostCents: 800, lossCostCents: 400 });
      expect(body.meta).toMatchObject({ total: 3, totalPages: 1 });

      // Default order: what was consumed the most (in value) first.
      expect(body.data.map((entry: { inventoryItemId: string }) => entry.inventoryItemId)).toEqual([meat.id, oil.id, bread.id]);
      const byLoss = await report(ctx.accessToken, 'inventory', '?sort=loss&pageSize=1');
      expect(byLoss.data.map((entry: { inventoryItemId: string }) => entry.inventoryItemId)).toEqual([bread.id]);
      expect(byLoss.meta).toMatchObject({ total: 3, totalPages: 3 });
      const searched = await report(ctx.accessToken, 'inventory', `?search=${encodeURIComponent('óleo')}`);
      expect(searched.data.map((entry: { inventoryItemId: string }) => entry.inventoryItemId)).toEqual([oil.id]);
      expect(searched.totals).toMatchObject({ itemsCount: 1, purchasedCostCents: 4_000 });

      // Movements outside the period are not in it; the current balance still is.
      const old = await report(ctx.accessToken, 'inventory', '?from=2020-01-01&to=2020-01-31');
      expect(old.data).toEqual([]);
      expect(old.totals).toEqual({ itemsCount: 0, purchasedCostCents: 0, soldCostCents: 0, otherExitCostCents: 0, lossCostCents: 0 });
    });
  });

  describe('delivery', () => {
    it('counts deliveries by outcome, with times, fees and couriers', async () => {
      const ctx = await setup();
      await put(ctx.accessToken, '/v1/delivery/settings', { branchId: ctx.branchId, enabled: true, feeCents: 600, minOrderCents: 0 }).expect(200);
      const online = async () => {
        const order = (
          await request(server)
            .post('/v1/public/orders')
            .send({
              restaurantSlug: ctx.slug,
              items: [{ productId: ctx.burger.id, quantity: 1 }],
              customer: { name: 'Maria Cliente', phone: '11987654321' },
              fulfillmentType: 'DELIVERY',
              address: { street: 'Rua das Flores', number: '120', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', zipCode: '01310-100' },
              paymentMethod: 'PIX',
            })
            .expect(201)
        ).body as { id: string };
        for (const next of ['CONFIRMED', 'PREPARING', 'READY']) await status(ctx, order.id, next).expect(200);
        return prisma().delivery.findUniqueOrThrow({ where: { orderId: order.id } });
      };

      const courierRole = await prisma().role.findUniqueOrThrow({ where: { name: 'DELIVERY' } });
      const courier = await prisma().user.create({
        data: { tenantId: ctx.tenantId, name: 'Carlos Entregador', email: `courier-${uniqueSuffix()}@example.com`, passwordHash: 'x', status: 'ACTIVE' },
      });
      await prisma().userRole.create({ data: { userId: courier.id, roleId: courierRole.id, tenantId: ctx.tenantId } });

      const first = await online();
      const second = await online();
      const failed = await online();
      await online(); // stays pending
      for (const delivery of [first, second]) {
        await post(ctx.accessToken, `/v1/delivery/${delivery.id}/dispatch`).expect(200);
        await post(ctx.accessToken, `/v1/delivery/${delivery.id}/complete`).expect(200);
      }
      await post(ctx.accessToken, `/v1/delivery/${failed.id}/dispatch`).expect(200);
      await post(ctx.accessToken, `/v1/delivery/${failed.id}/fail`, { reason: 'Cliente ausente' }).expect(200);
      // Known times and a courier, so the averages are exact: 20 and 40 minutes on the road.
      const base = new Date(Date.now() - 3 * 3_600_000);
      const minutes = (value: number) => new Date(base.getTime() + value * 60_000);
      await prisma().order.updateMany({ where: { id: { in: [first.orderId, second.orderId] } }, data: { createdAt: base } });
      await prisma().delivery.update({ where: { id: first.id }, data: { courierUserId: courier.id, dispatchedAt: minutes(10), deliveredAt: minutes(30) } });
      await prisma().delivery.update({ where: { id: second.id }, data: { courierUserId: courier.id, dispatchedAt: minutes(20), deliveredAt: minutes(60) } });

      const body = await report(ctx.accessToken, 'delivery');
      expect(body.totals).toEqual({
        total: 4,
        pending: 1,
        outForDelivery: 0,
        delivered: 2,
        failed: 1,
        cancelled: 0,
        attempts: 3,
        redelivered: 0,
        successRateBps: 6_667, // 2 of the 3 that ended
        averageRouteMinutes: 30, // (20 + 40) / 2
        averageDoorMinutes: 45, // (30 + 60) / 2
        feeCents: 2_400,
        deliveredOrdersCents: 9_200, // 2 x (4000 + 600)
      });
      expect(body.byCourier).toEqual([
        { courierId: courier.id, courierName: 'Carlos Entregador', total: 2, delivered: 2, failed: 0, averageRouteMinutes: 30 },
        { courierId: null, courierName: null, total: 2, delivered: 0, failed: 1, averageRouteMinutes: null },
      ]);
      expect(body.byDay).toHaveLength(30);
      expect(body.byDay[29]).toEqual({ day: today(), total: 4, delivered: 2 });

      const empty = await report(ctx.accessToken, 'delivery', '?from=2020-01-01&to=2020-01-31');
      expect(empty.totals).toMatchObject({ total: 0, successRateBps: null, averageRouteMinutes: null, averageDoorMinutes: null, feeCents: 0 });
      expect(empty.byCourier).toEqual([]);
    });
  });

  describe('cash', () => {
    it('lists the sessions of the period with what went through each drawer and the differences', async () => {
      const ctx = await setup();
      const session = (await post(ctx.accessToken, '/v1/cash/sessions', { branchId: ctx.branchId, openingBalanceCents: 1_000 }).expect(201)).body;
      await sale(ctx, { paymentMethod: 'CASH' }).expect(201); // +4000
      await sale(ctx, { paymentMethod: 'PIX' }).expect(201); // not in the drawer
      await post(ctx.accessToken, `/v1/cash/sessions/${session.id}/movements`, { type: 'SUPPLY', amountCents: 500 }).expect(201);
      await post(ctx.accessToken, `/v1/cash/sessions/${session.id}/movements`, { type: 'WITHDRAWAL', amountCents: 300, reason: 'Troco para o banco' }).expect(201);
      // A debt received in cash also goes through the drawer.
      const debtor = await customer(ctx, 'Cliente Devedor');
      const debt = (
        await post(ctx.accessToken, '/v1/receivables', {
          customerId: debtor.id,
          branchId: ctx.branchId,
          description: 'Saldo anterior',
          totalCents: 2_000,
          installments: 1,
          firstDueDate: shift(today(), 10),
          idempotencyKey: key(),
        }).expect(201)
      ).body;
      await post(ctx.accessToken, `/v1/receivables/${debt.id}/payments`, { amountCents: 700, method: 'CASH', branchId: ctx.branchId, idempotencyKey: key() }).expect(200);
      // expected = 1000 + 4000 + 500 + 700 - 300 = 5900; counted 5800 -> 100 short
      await patch(ctx.accessToken, `/v1/cash/sessions/${session.id}/close`, { countedClosingBalanceCents: 5_800 }).expect(200);
      const open = (await post(ctx.accessToken, '/v1/cash/sessions', { branchId: ctx.branchId, openingBalanceCents: 200 }).expect(201)).body;
      await sale(ctx, { paymentMethod: 'CASH' }).expect(201); // +4000 in the open session

      const body = await report(ctx.accessToken, 'cash');
      expect(body.totals).toEqual({
        sessions: 2,
        closed: 1,
        open: 1,
        salesCents: 8_000,
        suppliesCents: 500,
        withdrawalsCents: 300,
        receivablePaymentsCents: 700,
        receivableRefundsCents: 0,
        saleRefundsCents: 0,
        shortageCents: -100,
        surplusCents: 0,
        sessionsWithDifference: 1,
      });
      expect(body.data.map((row: { id: string }) => row.id)).toEqual([open.id, session.id]); // newest first
      expect(body.data[0]).toMatchObject({
        status: 'OPEN',
        openingBalanceCents: 200,
        totals: { salesCents: 4_000, suppliesCents: 0, withdrawalsCents: 0, receivablePaymentsCents: 0, receivableRefundsCents: 0 },
        expectedBalanceCents: 4_200,
        countedClosingBalanceCents: null,
        differenceCents: null,
        closedBy: null,
      });
      expect(body.data[1]).toMatchObject({
        status: 'CLOSED',
        openingBalanceCents: 1_000,
        totals: { salesCents: 4_000, suppliesCents: 500, withdrawalsCents: 300, receivablePaymentsCents: 700, receivableRefundsCents: 0 },
        expectedBalanceCents: 5_900,
        countedClosingBalanceCents: 5_800,
        differenceCents: -100,
      });
      expect(body.data[1].branch).toEqual({ id: ctx.branchId, name: expect.any(String) });
      expect(body.data[1].openedBy.name).toEqual(expect.any(String));
      expect(body.meta).toEqual({ page: 1, pageSize: 20, total: 2, totalPages: 1 });

      const paged = await report(ctx.accessToken, 'cash', '?pageSize=1&page=2');
      expect(paged.data.map((row: { id: string }) => row.id)).toEqual([session.id]);
      expect(paged.totals.sessions).toBe(2);
    });
  });

  describe('database work', () => {
    it('the number of queries of a report does not grow with the number of rows', async () => {
      const ctx = await setup();
      const client = prisma();
      const item = async (name: string) =>
        (await post(ctx.accessToken, '/v1/inventory/items', { name: `${name} ${uniqueSuffix()}`, unit: 'UNIT' }).expect(201)).body as { id: string };
      const stock = (inventoryItemId: string) =>
        post(ctx.accessToken, '/v1/inventory/movements', { branchId: ctx.branchId, inventoryItemId, type: 'ENTRY', quantity: 5, unitCostCents: 100 }).expect(201);
      // How many raw SQL statements one request to each report runs.
      const measure = async () => {
        const counts: Record<string, number> = {};
        for (const name of ['sales', 'products', 'customers', 'inventory', 'delivery', 'cash']) {
          const spy = jest.spyOn(client, '$queryRaw');
          try {
            // Only the paged reports take pageSize (the others refuse unknown parameters).
            const paged = name !== 'sales' && name !== 'delivery';
            await get(ctx.accessToken, `/v1/reports/${name}${paged ? '?pageSize=100' : ''}`).expect(200);
            counts[name] = spy.mock.calls.length;
          } finally {
            spy.mockRestore();
          }
        }
        return counts;
      };

      const buyer = await customer(ctx, 'Primeiro Cliente');
      await sale(ctx, { customerId: buyer.id }).expect(201);
      await stock((await item('Insumo')).id);
      const few = await measure();
      expect(few).toEqual({ sales: 4, products: 2, customers: 2, inventory: 3, delivery: 3, cash: 2 });

      // Fifteen more products sold to fifteen more customers, fifteen more ingredients moved.
      for (let index = 0; index < 15; index++) {
        const product = await createActiveProductE2E(server, ctx.accessToken, `Produto ${index} ${uniqueSuffix()}`, 10 + index);
        const other = await customer(ctx, `Cliente ${index}`);
        await sale(ctx, { customerId: other.id }, [{ productId: product.id, quantity: 1 }]).expect(201);
        await stock((await item(`Insumo ${index}`)).id);
      }
      const many = await measure();
      expect(many).toEqual(few);
      expect((await report(ctx.accessToken, 'products', '?pageSize=100')).data).toHaveLength(16);
      expect((await report(ctx.accessToken, 'customers', '?pageSize=100')).data).toHaveLength(16);
      expect((await report(ctx.accessToken, 'inventory', '?pageSize=100')).data).toHaveLength(16);
    });
  });

  describe('isolation', () => {
    it("a restaurant never sees another restaurant's figures, in any report", async () => {
      const a = await setup();
      const b = await setup();
      const theirs = await customer(b, 'Cliente do B');
      await post(b.accessToken, '/v1/cash/sessions', { branchId: b.branchId, openingBalanceCents: 0 }).expect(201);
      await sale(b, { customerId: theirs.id, paymentMethod: 'CASH' }, [{ productId: b.burger.id, quantity: 3 }]).expect(201);
      const item = (await post(b.accessToken, '/v1/inventory/items', { name: `Carne ${uniqueSuffix()}`, unit: 'KG' }).expect(201)).body;
      await post(b.accessToken, '/v1/inventory/movements', { branchId: b.branchId, inventoryItemId: item.id, type: 'ENTRY', quantity: 1, unitCostCents: 999 }).expect(201);

      expect((await report(a.accessToken, 'sales')).totals).toMatchObject({ ordersCount: 0, totalCents: 0 });
      expect((await report(a.accessToken, 'products')).data).toEqual([]);
      expect((await report(a.accessToken, 'customers')).totals).toMatchObject({ customersCount: 0, identifiedOrders: 0, newCustomers: 0 });
      expect((await report(a.accessToken, 'inventory')).data).toEqual([]);
      expect((await report(a.accessToken, 'delivery')).totals.total).toBe(0);
      expect((await report(a.accessToken, 'cash')).totals.sessions).toBe(0);

      // Asking for their branch or their category gets nothing either.
      for (const name of ['sales', 'products', 'customers', 'inventory', 'delivery', 'cash']) {
        await get(a.accessToken, `/v1/reports/${name}?branchId=${b.branchId}`).expect(404);
      }
      const theirCategory = await prisma().product.findUniqueOrThrow({ where: { id: b.burger.id }, select: { categoryId: true } });
      expect((await report(a.accessToken, 'products', `?categoryId=${theirCategory.categoryId}`)).data).toEqual([]);

      // And B itself sees its own.
      expect((await report(b.accessToken, 'sales')).totals).toMatchObject({ ordersCount: 1, totalCents: 12_000 });
      expect((await report(b.accessToken, 'cash')).totals).toMatchObject({ sessions: 1, salesCents: 12_000 });
    });

    it('a branch-limited manager only gets the branches they work at', async () => {
      const ctx = await setup();
      const second = await prisma().branch.create({ data: { tenantId: ctx.tenantId, name: 'Filial', code: 'FILIAL' } });
      await sale(ctx, {}, [{ productId: ctx.burger.id, quantity: 1 }]).expect(201); // matriz 4000
      await post(ctx.accessToken, '/v1/pos/orders', { branchId: second.id, items: [{ productId: ctx.soda.id, quantity: 2 }], paymentMethod: 'PIX' }).expect(201); // filial 1400
      await post(ctx.accessToken, '/v1/cash/sessions', { branchId: ctx.branchId, openingBalanceCents: 0 }).expect(201);
      await post(ctx.accessToken, '/v1/cash/sessions', { branchId: second.id, openingBalanceCents: 0 }).expect(201);

      const manager = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'MANAGER', [second.id]);
      const mine = await report(manager, 'sales');
      expect(mine.totals).toMatchObject({ ordersCount: 1, totalCents: 1_400 });
      expect((await report(manager, 'products')).data.map((row: { productId: string }) => row.productId)).toEqual([ctx.soda.id]);
      const cash = await report(manager, 'cash');
      expect(cash.totals.sessions).toBe(1);
      expect(cash.data.map((row: { branch: { id: string } }) => row.branch.id)).toEqual([second.id]);
      expect((await report(manager, 'sales', `?branchId=${second.id}`)).totals.totalCents).toBe(1_400);
      for (const name of ['sales', 'products', 'customers', 'inventory', 'delivery', 'cash']) {
        await get(manager, `/v1/reports/${name}?branchId=${ctx.branchId}`).expect(403);
      }

      // A manager linked to no branch sees nothing (not everything).
      const nowhere = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'MANAGER', []);
      expect((await report(nowhere, 'sales')).totals).toMatchObject({ ordersCount: 0, totalCents: 0 });
      expect((await report(nowhere, 'cash')).totals.sessions).toBe(0);

      // The owner sees both, together or one at a time.
      expect((await report(ctx.accessToken, 'sales')).totals.totalCents).toBe(5_400);
      const one = await report(ctx.accessToken, 'sales', `?branchId=${ctx.branchId}`);
      expect(one.totals.totalCents).toBe(4_000);
      expect(one.branchId).toBe(ctx.branchId);
    });
  });

  describe('permissions (backend)', () => {
    it.each([
      ['OWNER', 200],
      ['ADMIN', 200],
      ['MANAGER', 200],
      ['CASHIER', 403],
      ['WAITER', 403],
      ['KITCHEN', 403],
      ['DELIVERY', 403],
      ['VIEWER', 403],
    ] as [RoleName, number][])('%s: every report answers %i', async (role, expected) => {
      const ctx = await setup();
      const token = role === 'OWNER' ? ctx.accessToken : await createStaffAndLoginE2E(app, server, ctx.tenantId, role, [ctx.branchId]);
      for (const name of ['sales', 'products', 'customers', 'inventory', 'delivery', 'cash']) {
        await get(token, `/v1/reports/${name}`).expect(expected);
      }
    });

    it('every report needs a session', async () => {
      for (const name of ['sales', 'products', 'customers', 'inventory', 'delivery', 'cash']) {
        await request(server).get(`/v1/reports/${name}`).expect(401);
      }
    });

    it('reports are read-only: no other method exists', async () => {
      const ctx = await setup();
      for (const name of ['sales', 'cash']) {
        await post(ctx.accessToken, `/v1/reports/${name}`, {}).expect(404);
        await request(server).delete(`/v1/reports/${name}`).set(auth(ctx.accessToken)).expect(404);
      }
    });

    it('the permission really stored in the database', async () => {
      const rows = await prisma().rolePermission.findMany({
        where: { permission: { key: 'reports.read' } },
        select: { role: { select: { name: true } } },
      });
      expect(rows.map((row) => row.role.name).sort()).toEqual(['ADMIN', 'MANAGER', 'OWNER']);
    });
  });
});
