import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createActiveProductE2E,
  createStaffAndLoginE2E,
  createTestApp,
  getPrisma,
  registerTenantE2E,
  statusBody,
  uniqueSuffix,
} from './test-app.util';

// Add-ons (option groups) at the counter (PDV) and on table tabs (comandas), migration 22
// (tab_item_options). The server prices everything from the product and its OWN groups, checks the
// required groups, the limits and what is sold out, freezes names and prices on the line, and the
// kitchen, the bill, the cash drawer and the reports see the add-ons.
describe('Add-ons in the PDV and on tabs (e2e)', () => {
  let app: INestApplication;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let server: any;

  // One application per describe block: 100 requests a minute per route and address, in memory.
  function useApp() {
    beforeAll(async () => {
      app = await createTestApp();
      server = app.getHttpServer();
    });
    afterAll(async () => {
      await app.close();
    });
  }

  const prisma = () => getPrisma(app);
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  type Option = { optionId: string; quantity: number };
  type Line = { productId: string; quantity: number; options?: Option[]; notes?: string };

  // "X-Burger" R$ 25,00 with "Ponto da carne" (required, 1..1: Mal passado / Ao ponto, free) and
  // "Adicionais" (0..3: Bacon R$ 5,00 up to 2, Cheddar R$ 4,00, Ovo R$ 2,00 sold out); "Suco"
  // R$ 8,50 without add-ons; "Bolo" sold out.
  async function setup() {
    const tenant = await registerTenantE2E(server);
    const t = tenant.accessToken;
    const burger = await createActiveProductE2E(server, t, 'X-Burger', 25);
    const juice = await createActiveProductE2E(server, t, 'Suco', 8.5);
    const cake = await createActiveProductE2E(server, t, 'Bolo', 12);
    await prisma().product.update({ where: { id: cake.id }, data: { soldOut: true } });

    const ponto = (await request(server).post('/v1/option-groups').set(auth(t)).send({ name: 'Ponto da carne', minSelect: 1, maxSelect: 1 }).expect(201)).body;
    const extras = (await request(server).post('/v1/option-groups').set(auth(t)).send({ name: 'Adicionais', minSelect: 0, maxSelect: 3 }).expect(201)).body;
    const addOption = async (groupId: string, body: object) =>
      (await request(server).post(`/v1/option-groups/${groupId}/options`).set(auth(t)).send(body).expect(201)).body;
    let group = await addOption(ponto.id, { name: 'Mal passado', price: 0 });
    group = await addOption(ponto.id, { name: 'Ao ponto', price: 0 });
    const mal = group.options.find((o: { name: string }) => o.name === 'Mal passado');
    const aoPonto = group.options.find((o: { name: string }) => o.name === 'Ao ponto');
    let extraGroup = await addOption(extras.id, { name: 'Bacon', price: 5, maxQuantity: 2 });
    extraGroup = await addOption(extras.id, { name: 'Cheddar', price: 4 });
    extraGroup = await addOption(extras.id, { name: 'Ovo', price: 2 });
    const byName = (name: string) => extraGroup.options.find((o: { name: string }) => o.name === name);
    const bacon = byName('Bacon');
    const cheddar = byName('Cheddar');
    const ovo = byName('Ovo');
    await request(server).patch(`/v1/option-groups/${extras.id}/options/${ovo.id}`).set(auth(t)).send({ soldOut: true }).expect(200);
    await request(server).put(`/v1/products/${burger.id}/option-groups`).set(auth(t)).send({ groupIds: [ponto.id, extras.id] }).expect(200);

    return { ...tenant, burger, juice, cake, ponto, extras, mal, aoPonto, bacon, cheddar, ovo };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const posSale = (ctx: { accessToken: string; branchId: string }, items: Line[], extra: object = {}) =>
    request(server)
      .post('/v1/pos/orders')
      .set(auth(ctx.accessToken))
      .send({ branchId: ctx.branchId, items, paymentMethod: 'PIX', ...extra });

  const quote = (token: string, items: Line[]) => request(server).post('/v1/pos/orders/quote').set(auth(token)).send({ items });

  // X-Burger ao ponto + 2x bacon + cheddar = 25 + 10 + 4 = R$ 39,00 per unit.
  const fullBurger = (ctx: Ctx, quantity = 1, notes?: string): Line => ({
    productId: ctx.burger.id,
    quantity,
    options: [
      { optionId: ctx.aoPonto.id, quantity: 1 },
      { optionId: ctx.bacon.id, quantity: 2 },
      { optionId: ctx.cheddar.id, quantity: 1 },
    ],
    ...(notes ? { notes } : {}),
  });

  describe('PDV: pricing on the server', () => {
    useApp();

    it('a product without add-ons is sold at its price, and the quote says the same', async () => {
      const ctx = await setup();
      const q = (await quote(ctx.accessToken, [{ productId: ctx.juice.id, quantity: 2 }]).expect(200)).body;
      expect(q).toEqual({
        subtotalCents: 1700,
        items: [expect.objectContaining({ productId: ctx.juice.id, basePriceCents: 850, extrasCents: 0, unitPriceCents: 850, subtotalCents: 1700, options: [] })],
      });
      const sale = (await posSale(ctx, [{ productId: ctx.juice.id, quantity: 2 }]).expect(201)).body;
      expect(sale.total).toBeCloseTo(17);
      expect(sale.items[0]).toMatchObject({ unitPrice: 8.5, quantity: 2, options: [] });
    });

    it('several add-ons: the quote and the sale price each unit with all of them, and freeze names, prices and the note', async () => {
      const ctx = await setup();
      const line = fullBurger(ctx, 2, 'sem cebola');
      const q = (await quote(ctx.accessToken, [line, { productId: ctx.juice.id, quantity: 1 }]).expect(200)).body;
      expect(q.items[0]).toMatchObject({ name: 'X-Burger', basePriceCents: 2500, extrasCents: 1400, unitPriceCents: 3900, subtotalCents: 7800, notes: 'sem cebola' });
      expect(q.items[0].options).toEqual([
        { optionId: ctx.aoPonto.id, group: 'Ponto da carne', name: 'Ao ponto', unitPriceCents: 0, quantity: 1 },
        { optionId: ctx.bacon.id, group: 'Adicionais', name: 'Bacon', unitPriceCents: 500, quantity: 2 },
        { optionId: ctx.cheddar.id, group: 'Adicionais', name: 'Cheddar', unitPriceCents: 400, quantity: 1 },
      ]);
      expect(q.subtotalCents).toBe(8650);

      const sale = (await posSale(ctx, [line, { productId: ctx.juice.id, quantity: 1 }]).expect(201)).body;
      expect(sale.total).toBeCloseTo(86.5);
      expect(sale.items[0]).toMatchObject({ unitPrice: 39, quantity: 2, subtotal: 78, notes: 'sem cebola' });
      expect(sale.items[0].options).toEqual([
        { group: 'Ponto da carne', name: 'Ao ponto', unitPrice: 0, quantity: 1 },
        { group: 'Adicionais', name: 'Bacon', unitPrice: 5, quantity: 2 },
        { group: 'Adicionais', name: 'Cheddar', unitPrice: 4, quantity: 1 },
      ]);
      const rows = await prisma().orderItemOption.findMany({ where: { orderItem: { orderId: sale.id } } });
      expect(rows).toHaveLength(3);
    });

    it('the same product with other add-ons is another line; the same option sent twice is added up', async () => {
      const ctx = await setup();
      const sale = (
        await posSale(ctx, [
          fullBurger(ctx, 1),
          { productId: ctx.burger.id, quantity: 1, options: [{ optionId: ctx.mal.id, quantity: 1 }, { optionId: ctx.bacon.id, quantity: 1 }, { optionId: ctx.bacon.id, quantity: 1 }] },
        ]).expect(201)
      ).body;
      expect(sale.items).toHaveLength(2);
      expect(sale.items[1]).toMatchObject({ unitPrice: 35 });
      expect(sale.items[1].options).toEqual([
        expect.objectContaining({ name: 'Mal passado', quantity: 1 }),
        expect.objectContaining({ name: 'Bacon', quantity: 2 }),
      ]);
      expect(sale.total).toBeCloseTo(74);
    });

    it('a price or name sent by the client is refused, never used', async () => {
      const ctx = await setup();
      await posSale(ctx, [{ productId: ctx.juice.id, quantity: 1, unitPrice: 0.01 } as Line]).expect(400);
      await posSale(ctx, [{ productId: ctx.burger.id, quantity: 1, options: [{ optionId: ctx.aoPonto.id, quantity: 1, price: 0 } as Option] }]).expect(400);
      await quote(ctx.accessToken, [{ productId: ctx.juice.id, quantity: 1, priceCents: 1 } as Line]).expect(400);
    });

    it('the coupon preview prices the add-ons like the sale', async () => {
      const ctx = await setup();
      await prisma().coupon.create({ data: { tenantId: ctx.tenantId, code: 'DEZ', discountType: 'PERCENTAGE', value: 10 } });
      const preview = (
        await request(server)
          .post('/v1/pos/orders/coupon-preview')
          .set(auth(ctx.accessToken))
          .send({ branchId: ctx.branchId, code: 'DEZ', items: [fullBurger(ctx, 1, 'bem passado')] })
          .expect(200)
      ).body;
      expect(preview).toMatchObject({ subtotalCents: 3900, discountCents: 390 });
      const sale = (await posSale(ctx, [fullBurger(ctx, 1)], { couponCode: 'DEZ' }).expect(201)).body;
      expect(sale.discount).toBeCloseTo(3.9);
      expect(sale.total).toBeCloseTo(35.1);
    });
  });

  describe('PDV: rules of the groups', () => {
    useApp();

    it('a required group must be satisfied', async () => {
      const ctx = await setup();
      const res = await posSale(ctx, [{ productId: ctx.burger.id, quantity: 1, options: [{ optionId: ctx.bacon.id, quantity: 1 }] }]).expect(400);
      expect(res.body.code).toBe('OPTION_REQUIRED');
      expect(res.body.message).toContain('Ponto da carne');
      expect((await quote(ctx.accessToken, [{ productId: ctx.burger.id, quantity: 1 }]).expect(400)).body.code).toBe('OPTION_REQUIRED');
    });

    it('the limits of a group and of an option are enforced', async () => {
      const ctx = await setup();
      // Two choices in a single-choice group.
      const twoPoints = await posSale(ctx, [
        { productId: ctx.burger.id, quantity: 1, options: [{ optionId: ctx.mal.id, quantity: 1 }, { optionId: ctx.aoPonto.id, quantity: 1 }] },
      ]).expect(400);
      expect(twoPoints.body.code).toBe('OPTION_LIMIT');
      // Three bacons (max 2 of that option).
      const threeBacons = await posSale(ctx, [
        { productId: ctx.burger.id, quantity: 1, options: [{ optionId: ctx.mal.id, quantity: 1 }, { optionId: ctx.bacon.id, quantity: 3 }] },
      ]).expect(400);
      expect(threeBacons.body.code).toBe('OPTION_LIMIT');
      // Four add-ons in a 0..3 group.
      await request(server)
        .post(`/v1/option-groups/${ctx.extras.id}/options`)
        .set(auth(ctx.accessToken))
        .send({ name: 'Picles', price: 1 })
        .expect(201);
      const groups = (await request(server).get('/v1/option-groups').set(auth(ctx.accessToken)).expect(200)).body;
      const picles = groups.find((g: { id: string }) => g.id === ctx.extras.id).options.find((o: { name: string }) => o.name === 'Picles');
      const tooMany = await posSale(ctx, [
        {
          productId: ctx.burger.id,
          quantity: 1,
          options: [
            { optionId: ctx.mal.id, quantity: 1 },
            { optionId: ctx.bacon.id, quantity: 2 },
            { optionId: ctx.cheddar.id, quantity: 1 },
            { optionId: picles.id, quantity: 1 },
          ],
        },
      ]).expect(400);
      expect(tooMany.body.code).toBe('OPTION_LIMIT');
      // Exactly the maximum is fine.
      await posSale(ctx, [fullBurger(ctx)]).expect(201);
    });

    it('a sold-out add-on, an inactive group and a sold-out product are refused; nothing is written', async () => {
      const ctx = await setup();
      const before = await prisma().order.count({ where: { tenantId: ctx.tenantId } });
      const soldOut = await posSale(ctx, [{ productId: ctx.burger.id, quantity: 1, options: [{ optionId: ctx.mal.id, quantity: 1 }, { optionId: ctx.ovo.id, quantity: 1 }] }]).expect(400);
      expect(soldOut.body.code).toBe('OPTION_UNAVAILABLE');
      await posSale(ctx, [{ productId: ctx.cake.id, quantity: 1 }]).expect(400);
      await request(server).patch(`/v1/option-groups/${ctx.extras.id}`).set(auth(ctx.accessToken)).send({ active: false }).expect(200);
      const inactive = await posSale(ctx, [{ productId: ctx.burger.id, quantity: 1, options: [{ optionId: ctx.mal.id, quantity: 1 }, { optionId: ctx.bacon.id, quantity: 1 }] }]).expect(400);
      expect(inactive.body.code).toBe('OPTION_UNAVAILABLE');
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(before);
    });

    it('an add-on of another product or of another restaurant is unavailable (no hint which)', async () => {
      const ctx = await setup();
      const other = await setup();
      const foreign = await posSale(ctx, [{ productId: ctx.burger.id, quantity: 1, options: [{ optionId: ctx.mal.id, quantity: 1 }, { optionId: other.bacon.id, quantity: 1 }] }]).expect(400);
      expect(foreign.body.code).toBe('OPTION_UNAVAILABLE');
      const otherProduct = await posSale(ctx, [{ productId: ctx.juice.id, quantity: 1, options: [{ optionId: ctx.bacon.id, quantity: 1 }] }]).expect(400);
      expect(otherProduct.body.code).toBe('OPTION_UNAVAILABLE');
      expect((await quote(ctx.accessToken, [{ productId: other.juice.id, quantity: 1 }]).expect(400)).body.code).toBe('PRODUCT_UNAVAILABLE');
    });
  });

  describe('PDV: history, cancellation, cash drawer and reports', () => {
    useApp();

    it('a later price change or a deleted option never rewrites a sale', async () => {
      const ctx = await setup();
      const sale = (await posSale(ctx, [fullBurger(ctx)]).expect(201)).body;
      await request(server).patch(`/v1/option-groups/${ctx.extras.id}/options/${ctx.bacon.id}`).set(auth(ctx.accessToken)).send({ price: 9, name: 'Bacon artesanal' }).expect(200);
      await request(server).delete(`/v1/option-groups/${ctx.extras.id}/options/${ctx.cheddar.id}`).set(auth(ctx.accessToken)).expect((r) => expect([200, 204]).toContain(r.status));
      await request(server).patch(`/v1/products/${ctx.burger.id}`).set(auth(ctx.accessToken)).send({ price: 30 }).expect(200);

      const detail = (await request(server).get(`/v1/orders/${sale.id}`).set(auth(ctx.accessToken)).expect(200)).body;
      expect(detail.total).toBeCloseTo(39);
      expect(detail.items[0]).toMatchObject({ unitPrice: 39 });
      expect(detail.items[0].options.map((o: { name: string; unitPrice: number }) => [o.name, o.unitPrice])).toEqual([
        ['Ao ponto', 0],
        ['Bacon', 5],
        ['Cheddar', 4],
      ]);
      // New sales use the new prices: 30 + 2 x 9.
      const next = (await posSale(ctx, [{ productId: ctx.burger.id, quantity: 1, options: [{ optionId: ctx.aoPonto.id, quantity: 1 }, { optionId: ctx.bacon.id, quantity: 2 }] }]).expect(201)).body;
      expect(next.total).toBeCloseTo(48);
    });

    it('a cash sale with add-ons puts the full total in the drawer; the products report counts it; cancelling keeps the lines', async () => {
      const ctx = await setup();
      const session = (await request(server).post('/v1/cash/sessions').set(auth(ctx.accessToken)).send({ branchId: ctx.branchId, openingBalanceCents: 10000 }).expect(201)).body;
      const sale = (await posSale(ctx, [fullBurger(ctx, 2)], { paymentMethod: 'CASH' }).expect(201)).body;
      expect(sale.total).toBeCloseTo(78);
      const movement = await prisma().cashMovement.findFirst({ where: { orderId: sale.id, type: 'SALE' } });
      expect(movement?.amountCents).toBe(7800);
      const drawer = (await request(server).get(`/v1/cash/sessions/${session.id}`).set(auth(ctx.accessToken)).expect(200)).body;
      expect(drawer.totals.salesCents).toBe(7800);
      expect(drawer.expectedBalanceCents).toBe(17800);

      // The products report sees the whole line (add-ons inside the unit price) once the sale concludes.
      for (const status of ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED']) {
        await request(server).patch(`/v1/orders/${sale.id}/status`).set(auth(ctx.accessToken)).send(statusBody(status)).expect(200);
      }
      const report = (await request(server).get('/v1/reports/products').set(auth(ctx.accessToken)).expect(200)).body;
      expect(report.totals).toMatchObject({ quantity: 2, revenueCents: 7800 });

      // Another sale, cancelled: the lines and their add-ons stay as history.
      const cancelled = (await posSale(ctx, [fullBurger(ctx, 1)]).expect(201)).body;
      await request(server).patch(`/v1/orders/${cancelled.id}/status`).set(auth(ctx.accessToken)).send(statusBody('CANCELLED')).expect(200);
      const detail = (await request(server).get(`/v1/orders/${cancelled.id}`).set(auth(ctx.accessToken)).expect(200)).body;
      expect(detail.status).toBe('CANCELLED');
      expect(detail.items[0].options).toHaveLength(3);
      const after = (await request(server).get('/v1/reports/products').set(auth(ctx.accessToken)).expect(200)).body;
      expect(after.totals.revenueCents).toBe(7800);
    });

    it('the kitchen board shows a PDV order with its add-ons and note', async () => {
      const ctx = await setup();
      const sale = (await posSale(ctx, [fullBurger(ctx, 1, 'sem cebola')]).expect(201)).body;
      const board = (await request(server).get('/v1/orders/board').set(auth(ctx.accessToken)).expect(200)).body;
      const card = board.columns.find((c: { status: string }) => c.status === 'PENDING').data.find((o: { id: string }) => o.id === sale.id);
      expect(card.items[0]).toMatchObject({ name: 'X-Burger', quantity: 1, notes: 'sem cebola' });
      expect(card.items[0].options.map((o: { name: string; quantity: number }) => `${o.quantity}x ${o.name}`)).toEqual(['1x Ao ponto', '2x Bacon', '1x Cheddar']);
    });
  });

  describe('Tabs: rounds with add-ons', () => {
    useApp();

    async function openTab(ctx: { accessToken: string; branchId: string }, number = 7) {
      const table = (await request(server).post('/v1/tables').set(auth(ctx.accessToken)).send({ branchId: ctx.branchId, number }).expect(201)).body;
      return (await request(server).post('/v1/tabs').set(auth(ctx.accessToken)).send({ branchId: ctx.branchId, tableId: table.id }).expect(201)).body as { id: string };
    }
    const send = (token: string, tabId: string, items: Line[], idempotencyKey = `round-${uniqueSuffix()}`) =>
      request(server).post(`/v1/tabs/${tabId}/rounds`).set(auth(token)).send({ idempotencyKey, items });

    it('a round freezes each item with its add-ons: unit, base, extras and subtotal; the tab total includes them', async () => {
      const ctx = await setup();
      const tab = await openTab(ctx);
      const q = (await request(server).post(`/v1/tabs/${tab.id}/rounds/quote`).set(auth(ctx.accessToken)).send({ items: [fullBurger(ctx, 2, 'sem cebola')] }).expect(200)).body;
      expect(q.subtotalCents).toBe(7800);

      const res = (await send(ctx.accessToken, tab.id, [fullBurger(ctx, 2, 'sem cebola'), { productId: ctx.juice.id, quantity: 1 }]).expect(201)).body;
      expect(res.items[0]).toMatchObject({ name: 'X-Burger', unitPriceCents: 3900, basePriceCents: 2500, extrasCents: 1400, quantity: 2, subtotalCents: 7800, notes: 'sem cebola', status: 'SENT' });
      expect(res.items[0].options).toEqual([
        { optionId: ctx.aoPonto.id, group: 'Ponto da carne', name: 'Ao ponto', unitPriceCents: 0, quantity: 1 },
        { optionId: ctx.bacon.id, group: 'Adicionais', name: 'Bacon', unitPriceCents: 500, quantity: 2 },
        { optionId: ctx.cheddar.id, group: 'Adicionais', name: 'Cheddar', unitPriceCents: 400, quantity: 1 },
      ]);
      expect(res.items[1]).toMatchObject({ name: 'Suco', unitPriceCents: 850, extrasCents: 0, options: [] });
      expect(res.totalCents).toBe(8650);
      expect(await prisma().tabItemOption.count({ where: { tabItem: { tabId: tab.id } } })).toBe(3);
    });

    it('a new round keeps the earlier items and their prices, even after a price change', async () => {
      const ctx = await setup();
      const tab = await openTab(ctx);
      await send(ctx.accessToken, tab.id, [fullBurger(ctx)]).expect(201);
      await request(server).patch(`/v1/option-groups/${ctx.extras.id}/options/${ctx.bacon.id}`).set(auth(ctx.accessToken)).send({ price: 7 }).expect(200);
      const res = (await send(ctx.accessToken, tab.id, [fullBurger(ctx)]).expect(201)).body;
      expect(res.items.map((i: { roundNumber: number; unitPriceCents: number }) => [i.roundNumber, i.unitPriceCents])).toEqual([
        [1, 3900],
        [2, 4300],
      ]);
      expect(res.totalCents).toBe(8200);
    });

    it('required groups, limits, sold-out add-ons and sold-out products are refused; the round writes nothing', async () => {
      const ctx = await setup();
      const tab = await openTab(ctx);
      const required = await send(ctx.accessToken, tab.id, [{ productId: ctx.burger.id, quantity: 1 }]).expect(400);
      expect(required.body.code).toBe('OPTION_REQUIRED');
      const limit = await send(ctx.accessToken, tab.id, [{ productId: ctx.burger.id, quantity: 1, options: [{ optionId: ctx.mal.id, quantity: 1 }, { optionId: ctx.bacon.id, quantity: 3 }] }]).expect(400);
      expect(limit.body.code).toBe('OPTION_LIMIT');
      const soldOut = await send(ctx.accessToken, tab.id, [{ productId: ctx.burger.id, quantity: 1, options: [{ optionId: ctx.mal.id, quantity: 1 }, { optionId: ctx.ovo.id, quantity: 1 }] }]).expect(400);
      expect(soldOut.body.code).toBe('OPTION_UNAVAILABLE');
      const cake = await send(ctx.accessToken, tab.id, [{ productId: ctx.cake.id, quantity: 1 }]).expect(400);
      expect(cake.body.code).toBe('PRODUCT_UNAVAILABLE');
      expect(await prisma().tabItem.count({ where: { tabId: tab.id } })).toBe(0);
      expect(await prisma().tabRound.count({ where: { tabId: tab.id } })).toBe(0);
    });

    it('a retry with the same key and add-ons is the same round; other add-ons with that key is a 409', async () => {
      const ctx = await setup();
      const tab = await openTab(ctx);
      const idempotencyKey = `round-${uniqueSuffix()}`;
      const first = (await send(ctx.accessToken, tab.id, [fullBurger(ctx)], idempotencyKey).expect(201)).body;
      // Same add-ons listed in another order.
      const reordered = { ...fullBurger(ctx), options: [...fullBurger(ctx).options!].reverse() };
      const again = (await send(ctx.accessToken, tab.id, [reordered], idempotencyKey).expect(200)).body;
      expect(again.idempotentReplay).toBe(true);
      expect(again.round.id).toBe(first.round.id);
      const other = await send(ctx.accessToken, tab.id, [{ ...fullBurger(ctx), options: [{ optionId: ctx.mal.id, quantity: 1 }] }], idempotencyKey).expect(409);
      expect(other.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
      expect(await prisma().tabItem.count({ where: { tabId: tab.id } })).toBe(1);
    });

    it('the kitchen sees the table, the round, each add-on and the note', async () => {
      const ctx = await setup();
      const tab = await openTab(ctx, 12);
      await send(ctx.accessToken, tab.id, [fullBurger(ctx, 1, 'sem cebola')]).expect(201);
      const kitchen = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'KITCHEN', [ctx.branchId]);
      const board = (await request(server).get('/v1/orders/board').set(auth(kitchen)).expect(200)).body;
      const round = board.columns.flatMap((c: { tableRounds?: unknown[] }) => c.tableRounds ?? []).find((r: { tabId: string }) => r.tabId === tab.id);
      expect(round).toMatchObject({ tableNumber: 12, roundNumber: 1, status: 'SENT' });
      expect(round.items[0]).toMatchObject({ name: 'X-Burger', quantity: 1, notes: 'sem cebola' });
      expect(round.items[0].options).toEqual([
        { group: 'Ponto da carne', name: 'Ao ponto', quantity: 1 },
        { group: 'Adicionais', name: 'Bacon', quantity: 2 },
        { group: 'Adicionais', name: 'Cheddar', quantity: 1 },
      ]);
    });
  });

  describe('Tabs: cancellation, checkout, isolation and permissions', () => {
    useApp();

    async function openTab(ctx: { accessToken: string; branchId: string }, number = 3) {
      const table = (await request(server).post('/v1/tables').set(auth(ctx.accessToken)).send({ branchId: ctx.branchId, number }).expect(201)).body;
      return (await request(server).post('/v1/tabs').set(auth(ctx.accessToken)).send({ branchId: ctx.branchId, tableId: table.id }).expect(201)).body as { id: string };
    }
    const send = (token: string, tabId: string, items: Line[]) =>
      request(server).post(`/v1/tabs/${tabId}/rounds`).set(auth(token)).send({ idempotencyKey: `round-${uniqueSuffix()}`, items });

    it('cancelling units takes their add-ons off the bill; the checkout charges the rest and copies add-ons and notes into the sale', async () => {
      const ctx = await setup();
      const tab = await openTab(ctx);
      const sent = (await send(ctx.accessToken, tab.id, [fullBurger(ctx, 3, 'sem cebola'), { productId: ctx.juice.id, quantity: 1 }]).expect(201)).body;
      expect(sent.totalCents).toBe(3 * 3900 + 850);
      const burgerItem = sent.items[0];
      const afterCancel = (
        await request(server)
          .post(`/v1/tabs/${tab.id}/items/${burgerItem.id}/cancel`)
          .set(auth(ctx.accessToken))
          .send({ quantity: 1, reason: 'Cliente desistiu de um' })
          .expect(200)
      ).body;
      expect(afterCancel.items[0]).toMatchObject({ activeQuantity: 2, subtotalCents: 7800 });
      expect(afterCancel.totalCents).toBe(7800 + 850);

      await request(server).post('/v1/cash/sessions').set(auth(ctx.accessToken)).send({ branchId: ctx.branchId, openingBalanceCents: 0 }).expect(201);
      const closed = (
        await request(server)
          .post(`/v1/tabs/${tab.id}/checkout`)
          .set(auth(ctx.accessToken))
          .send({ paymentMethod: 'CASH', idempotencyKey: `checkout-${uniqueSuffix()}` })
          .expect((r) => expect([200, 201]).toContain(r.status))
      ).body;
      expect(closed.status).toBe('CLOSED');
      expect(closed.order.totalCents).toBe(8650);
      expect(closed.order.payment.amountCents).toBe(8650);
      const movement = await prisma().cashMovement.findFirst({ where: { orderId: closed.order.id, type: 'SALE' } });
      expect(movement?.amountCents).toBe(8650);

      const order = (await request(server).get(`/v1/orders/${closed.order.id}`).set(auth(ctx.accessToken)).expect(200)).body;
      expect(order.items[0]).toMatchObject({ name: 'X-Burger', unitPrice: 39, quantity: 2, notes: 'sem cebola' });
      expect(order.items[0].options.map((o: { name: string }) => o.name)).toEqual(['Ao ponto', 'Bacon', 'Cheddar']);
      expect(order.items[1]).toMatchObject({ name: 'Suco', options: [] });

      // The closed tab refuses new rounds and quotes alike.
      expect((await send(ctx.accessToken, tab.id, [{ productId: ctx.juice.id, quantity: 1 }]).expect(409)).body.code).toBe('TAB_CLOSED');
    });

    it('another restaurant\'s tab is not found, and its add-ons are unavailable on mine', async () => {
      const ctx = await setup();
      const other = await setup();
      const otherTab = await openTab(other, 9);
      await request(server).post(`/v1/tabs/${otherTab.id}/rounds/quote`).set(auth(ctx.accessToken)).send({ items: [{ productId: ctx.juice.id, quantity: 1 }] }).expect(404);
      await send(ctx.accessToken, otherTab.id, [{ productId: ctx.juice.id, quantity: 1 }]).expect(404);
      const mine = await openTab(ctx, 10);
      const res = await send(ctx.accessToken, mine.id, [{ productId: ctx.burger.id, quantity: 1, options: [{ optionId: ctx.mal.id, quantity: 1 }, { optionId: other.bacon.id, quantity: 1 }] }]).expect(400);
      expect(res.body.code).toBe('OPTION_UNAVAILABLE');
    });

    it('permissions: quotes follow the permission of the screen that uses them', async () => {
      const ctx = await setup();
      const tab = await openTab(ctx, 11);
      const cashier = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'CASHIER', [ctx.branchId]);
      const waiter = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'WAITER', [ctx.branchId]);
      const kitchen = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'KITCHEN', [ctx.branchId]);
      const body = { items: [fullBurger(ctx)] };
      // PDV quote: pos.create (cashier yes; waiter and kitchen no).
      await request(server).post('/v1/pos/orders/quote').set(auth(cashier)).send(body).expect(200);
      await request(server).post('/v1/pos/orders/quote').set(auth(waiter)).send(body).expect(403);
      await request(server).post('/v1/pos/orders/quote').set(auth(kitchen)).send(body).expect(403);
      // Round quote: tabs.update (waiter yes; cashier and kitchen no).
      await request(server).post(`/v1/tabs/${tab.id}/rounds/quote`).set(auth(waiter)).send(body).expect(200);
      await request(server).post(`/v1/tabs/${tab.id}/rounds/quote`).set(auth(cashier)).send(body).expect(403);
      await request(server).post(`/v1/tabs/${tab.id}/rounds/quote`).set(auth(kitchen)).send(body).expect(403);
      // The waiter sends add-ons and reads the groups it needs (products.read).
      await request(server).get('/v1/option-groups').set(auth(waiter)).expect(200);
      await send(waiter, tab.id, [fullBurger(ctx)]).expect(201);
      // A cashier sells them at the counter.
      await request(server).post('/v1/pos/orders').set(auth(cashier)).send({ branchId: ctx.branchId, items: [fullBurger(ctx)], paymentMethod: 'PIX' }).expect(201);
    });
  });
});
