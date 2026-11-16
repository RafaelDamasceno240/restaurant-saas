import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createActiveProductE2E, createStaffAndLoginE2E, createTestApp, getPrisma, registerTenantE2E, uniqueSuffix } from './test-app.util';

// B9 (piloto 2026-10-23): a table is a real kitchen flow. The waiter sends ROUNDS; the recipes are
// consumed when a round is sent; each item has its own status; cancelled units are recorded and
// either go back to the stock or are lost; the checkout bills only what is due and consumes
// nothing more.
describe('Tab kitchen flow - rounds, stock, cancellation, checkout (e2e)', () => {
  let app: INestApplication;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let server: any;

  // One application per describe block: requests are limited per route and per address (100 a
  // minute, in memory, per application), and this file sends far more than that to a few routes
  // (categories, products, rounds...) in well under a minute. Each block gets its own allowance.
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
  const key = (prefix = 'round') => `${prefix}-${uniqueSuffix()}`;
  type Line = { productId: string; quantity: number; notes?: string };

  // A restaurant with "X-Burger" (R$ 25,00: 1 pão), "Batata" (R$ 12,00: 0,2 kg de batata) and
  // "Refrigerante" (R$ 6,00, no recipe), `buns` pães and `potatoKg` kg of potato in stock, and an
  // OPEN tab on table 4.
  async function setup({ buns = 10, potatoKg = 2 }: { buns?: number; potatoKg?: number } = {}) {
    const tenant = await registerTenantE2E(server);
    const t = tenant.accessToken;
    const burger = await createActiveProductE2E(server, t, 'X-Burger', 25);
    const fries = await createActiveProductE2E(server, t, 'Batata', 12);
    const soda = await createActiveProductE2E(server, t, 'Refrigerante', 6);
    const bun = (await request(server).post('/v1/inventory/items').set(auth(t)).send({ name: 'Pão', unit: 'UNIT' }).expect(201)).body;
    const potato = (await request(server).post('/v1/inventory/items').set(auth(t)).send({ name: 'Batata crua', unit: 'KG' }).expect(201)).body;
    await request(server).put(`/v1/inventory/recipes/${burger.id}`).set(auth(t)).send({ items: [{ inventoryItemId: bun.id, quantity: 1 }] }).expect(200);
    await request(server).put(`/v1/inventory/recipes/${fries.id}`).set(auth(t)).send({ items: [{ inventoryItemId: potato.id, quantity: 0.2 }] }).expect(200);
    for (const [itemId, quantity] of [
      [bun.id, buns],
      [potato.id, potatoKg],
    ] as const) {
      if (quantity > 0) {
        await request(server)
          .post('/v1/inventory/movements')
          .set(auth(t))
          .send({ branchId: tenant.branchId, inventoryItemId: itemId, type: 'ENTRY', quantity, unitCostCents: 100 })
          .expect(201);
      }
    }
    const tab = await openTab(t, tenant.branchId, 4);
    return { ...tenant, burger, fries, soda, bunId: bun.id as string, potatoId: potato.id as string, tab };
  }

  async function openTab(token: string, branchId: string, number: number) {
    const table = (await request(server).post('/v1/tables').set(auth(token)).send({ branchId, number }).expect(201)).body;
    return (await request(server).post('/v1/tabs').set(auth(token)).send({ branchId, tableId: table.id }).expect(201)).body as { id: string };
  }

  const send = (token: string, tabId: string, items: Line[], idempotencyKey = key()) =>
    request(server).post(`/v1/tabs/${tabId}/rounds`).set(auth(token)).send({ idempotencyKey, items });

  const balance = async (branchId: string, inventoryItemId: string) =>
    Number((await prisma().inventoryBalance.findFirst({ where: { branchId, inventoryItemId } }))?.quantity ?? 0);

  const tabMovements = (tenantId: string) =>
    prisma().stockMovement.findMany({ where: { tenantId, referenceType: { in: ['TAB_ITEM', 'TAB_ITEM_CANCELLATION'] } } });

  describe('sending rounds', () => {
    useApp();

    it('the first round creates its items as SENT, round 1, with the notes, and consumes their recipes', async () => {
      const ctx = await setup();
      const res = await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 2, notes: 'sem cebola' }]).expect(201);

      expect(res.body.round.number).toBe(1);
      expect(res.body.idempotentReplay).toBe(false);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({
        name: 'X-Burger',
        quantity: 2,
        cancelledQuantity: 0,
        activeQuantity: 2,
        status: 'SENT',
        roundNumber: 1,
        notes: 'sem cebola',
        subtotalCents: 5000,
      });
      expect(res.body.items[0].sentAt).not.toBeNull();
      expect(res.body.totalCents).toBe(5000);

      expect(await balance(ctx.branchId, ctx.bunId)).toBe(8);
      const movements = await tabMovements(ctx.tenantId);
      expect(movements).toHaveLength(1);
      expect(movements[0]).toMatchObject({ type: 'SALE', referenceType: 'TAB_ITEM', referenceId: res.body.items[0].id });
      expect(Number(movements[0].quantity)).toBe(-2);
    });

    it('a second round carries only the new items, and the first round is untouched', async () => {
      const ctx = await setup();
      await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 2 }]).expect(201);
      const second = await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.fries.id, quantity: 1 }]).expect(201);

      expect(second.body.round.number).toBe(2);
      const round2 = await prisma().tabRound.findUniqueOrThrow({ where: { id: second.body.round.id }, include: { items: true } });
      expect(round2.items.map((i) => [i.productNameSnapshot, i.quantity])).toEqual([['Batata', 1]]);
      expect(second.body.items.map((i: { name: string; roundNumber: number }) => [i.name, i.roundNumber])).toEqual([
        ['X-Burger', 1],
        ['Batata', 2],
      ]);
      // Each round consumed only its own items.
      expect(await balance(ctx.branchId, ctx.bunId)).toBe(8);
      expect(await balance(ctx.branchId, ctx.potatoId)).toBe(1.8);
      expect(await tabMovements(ctx.tenantId)).toHaveLength(2);
    });

    it('a product without a recipe is sent and consumes nothing', async () => {
      const ctx = await setup();
      await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.soda.id, quantity: 3 }]).expect(201);
      expect(await tabMovements(ctx.tenantId)).toHaveLength(0);
    });

    it('without stock the round is refused, naming the product, and NOTHING of it is created or consumed', async () => {
      const ctx = await setup({ buns: 1 });
      const res = await send(ctx.accessToken, ctx.tab.id, [
        { productId: ctx.fries.id, quantity: 1 },
        { productId: ctx.burger.id, quantity: 2 },
      ]).expect(409);
      expect(res.body.code).toBe('PRODUCT_OUT_OF_STOCK');
      expect(res.body.message).toContain('"X-Burger"');

      expect(await prisma().tabRound.count({ where: { tabId: ctx.tab.id } })).toBe(0);
      expect(await prisma().tabItem.count({ where: { tabId: ctx.tab.id } })).toBe(0);
      expect(await tabMovements(ctx.tenantId)).toHaveLength(0);
      expect(await balance(ctx.branchId, ctx.bunId)).toBe(1);
      expect(await balance(ctx.branchId, ctx.potatoId)).toBe(2);

      // What fits still goes, and takes the number 1 (nothing was left behind by the refusal).
      const ok = await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 1 }]).expect(201);
      expect(ok.body.round.number).toBe(1);
    });

    it('PENDING orders keep the stock they were promised: the round cannot take it', async () => {
      const ctx = await setup({ buns: 3 });
      await request(server)
        .post('/v1/public/orders')
        .send({
          restaurantSlug: ctx.slug,
          items: [{ productId: ctx.burger.id, quantity: 2 }],
          customer: { name: 'Cliente Online', phone: '11987654321' },
          fulfillmentType: 'PICKUP',
          paymentMethod: 'PIX',
        })
        .expect(201);

      const refused = await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 2 }]).expect(409);
      expect(refused.body.code).toBe('PRODUCT_OUT_OF_STOCK');
      await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 1 }]).expect(201);
      // And the online order, taken first, can still be confirmed.
      const order = await prisma().order.findFirstOrThrow({ where: { tenantId: ctx.tenantId, source: 'ONLINE' } });
      await request(server).patch(`/v1/orders/${order.id}/status`).set(auth(ctx.accessToken)).send({ status: 'CONFIRMED' }).expect(200);
      expect(await balance(ctx.branchId, ctx.bunId)).toBe(0);
    });

    it('a branch that allows negative stock sends without checking', async () => {
      const ctx = await setup({ buns: 0 });
      await request(server).patch('/v1/inventory/settings').set(auth(ctx.accessToken)).send({ branchId: ctx.branchId, allowNegativeStock: true }).expect(200);
      await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 2 }]).expect(201);
      expect(await balance(ctx.branchId, ctx.bunId)).toBe(-2);
    });

    it('refuses a closed tab, an unavailable product, a smuggled price and an empty round', async () => {
      const ctx = await setup();
      const inactive = await createActiveProductE2E(server, ctx.accessToken, 'Descontinuado', 10, false);
      expect((await send(ctx.accessToken, ctx.tab.id, [{ productId: inactive.id, quantity: 1 }]).expect(400)).body.code).toBe('PRODUCT_UNAVAILABLE');
      await request(server)
        .post(`/v1/tabs/${ctx.tab.id}/rounds`)
        .set(auth(ctx.accessToken))
        .send({ idempotencyKey: key(), items: [{ productId: ctx.burger.id, quantity: 1, priceCents: 1 }] })
        .expect(400);
      const empty = await send(ctx.accessToken, ctx.tab.id, []).expect(400);
      expect(empty.body.message).toContain('A rodada precisa de pelo menos um item.');

      await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.soda.id, quantity: 1 }]).expect(201);
      await request(server)
        .post(`/v1/tabs/${ctx.tab.id}/checkout`)
        .set(auth(ctx.accessToken))
        .send({ paymentMethod: 'PIX', idempotencyKey: key('chk') })
        .expect(200);
      expect((await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.soda.id, quantity: 1 }]).expect(409)).body.code).toBe('TAB_CLOSED');
    });
  });

  describe('idempotency and concurrency of a send', () => {
    useApp();

    it('the same key returns the same round: no second item, no second consumption', async () => {
      const ctx = await setup();
      const k = key();
      const items = [{ productId: ctx.burger.id, quantity: 2, notes: 'ao ponto' }];
      const first = await send(ctx.accessToken, ctx.tab.id, items, k).expect(201);
      const again = await send(ctx.accessToken, ctx.tab.id, items, k).expect(200);

      expect(again.body.idempotentReplay).toBe(true);
      expect(again.body.round).toEqual(first.body.round);
      expect(await prisma().tabItem.count({ where: { tabId: ctx.tab.id } })).toBe(1);
      expect(await tabMovements(ctx.tenantId)).toHaveLength(1);
      expect(await balance(ctx.branchId, ctx.bunId)).toBe(8);
    });

    it('the same key with other items is refused', async () => {
      const ctx = await setup();
      const k = key();
      await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 2 }], k).expect(201);
      const other = await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 3 }], k).expect(409);
      expect(other.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    });

    it('the same send arriving several times at once creates one round', async () => {
      const ctx = await setup();
      const k = key();
      const items = [{ productId: ctx.burger.id, quantity: 1 }];
      const results = await Promise.all(Array.from({ length: 4 }, () => send(ctx.accessToken, ctx.tab.id, items, k)));
      expect(results.map((r) => r.status).sort()).toEqual([200, 200, 200, 201]);
      expect(new Set(results.map((r) => r.body.round.id)).size).toBe(1);
      expect(await prisma().tabItem.count({ where: { tabId: ctx.tab.id } })).toBe(1);
      expect(await balance(ctx.branchId, ctx.bunId)).toBe(9);
    });

    it('different rounds of one tab at once get different numbers', async () => {
      const ctx = await setup();
      const results = await Promise.all(
        Array.from({ length: 4 }, () => send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 1 }])),
      );
      expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201]);
      expect(results.map((r) => r.body.round.number).sort()).toEqual([1, 2, 3, 4]);
      expect(await balance(ctx.branchId, ctx.bunId)).toBe(6);
    });

    it('two tables competing for the last units: never more than the stock', async () => {
      const ctx = await setup({ buns: 3 });
      const other = await openTab(ctx.accessToken, ctx.branchId, 5);
      const results = await Promise.all([
        send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 2 }]),
        send(ctx.accessToken, other.id, [{ productId: ctx.burger.id, quantity: 2 }]),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await balance(ctx.branchId, ctx.bunId)).toBe(1);
    });
  });

  describe('cancelling units', () => {
    useApp();

    const cancel = (token: string, tabId: string, itemId: string, body: Record<string, unknown>) =>
      request(server).post(`/v1/tabs/${tabId}/items/${itemId}/cancel`).set(auth(token)).send(body);
    // The kitchen's own route is covered below; here the state is set directly to isolate the rule.
    const setStatus = (itemId: string, status: 'PREPARING' | 'READY' | 'SERVED') =>
      prisma().tabItem.update({ where: { id: itemId }, data: { status } });
    const sendOne = async (ctx: Awaited<ReturnType<typeof setup>>, quantity: number) =>
      (await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity }]).expect(201)).body.items.at(-1).id as string;

    it('SENT: a waiter cancels with a reason, the ingredients go back and it is all recorded', async () => {
      const ctx = await setup();
      const waiter = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'WAITER', [ctx.branchId]);
      const itemId = await sendOne(ctx, 2);
      expect(await balance(ctx.branchId, ctx.bunId)).toBe(8);

      const res = await cancel(waiter, ctx.tab.id, itemId, { quantity: 2, reason: 'Cliente desistiu' }).expect(200);
      expect(res.body.items[0]).toMatchObject({ status: 'CANCELLED', cancelledQuantity: 2, activeQuantity: 0, subtotalCents: 0 });
      expect(res.body.items[0].cancelledAt).not.toBeNull();
      expect(res.body.totalCents).toBe(0);
      expect(await balance(ctx.branchId, ctx.bunId)).toBe(10);

      const cancellation = await prisma().tabItemCancellation.findFirstOrThrow({ where: { tabItemId: itemId } });
      expect(cancellation).toMatchObject({ quantity: 2, reason: 'Cliente desistiu', statusAtCancel: 'SENT', stockOutcome: 'RETURNED' });
      const reversal = await prisma().stockMovement.findFirstOrThrow({ where: { referenceType: 'TAB_ITEM_CANCELLATION', referenceId: cancellation.id } });
      expect(reversal.type).toBe('REVERSAL');
      expect(Number(reversal.quantity)).toBe(2);

      const audit = await prisma().auditLog.findFirstOrThrow({ where: { tenantId: ctx.tenantId, action: 'TAB_ITEM_CANCELLED', entityId: itemId } });
      expect(audit.userId).not.toBeNull();
      expect(audit.afterData).toMatchObject({
        quantity: 2,
        reason: 'Cliente desistiu',
        statusAtCancel: 'SENT',
        stockOutcome: 'RETURNED',
        stockMovementIds: [reversal.id],
      });
    });

    it('PREPARING: the waiter gets 403, the manager cancels and it is a loss (stock stays consumed)', async () => {
      const ctx = await setup();
      const waiter = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'WAITER', [ctx.branchId]);
      const manager = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'MANAGER', [ctx.branchId]);
      const itemId = await sendOne(ctx, 2);
      await setStatus(itemId, 'PREPARING');

      const refused = await cancel(waiter, ctx.tab.id, itemId, { quantity: 1, reason: 'Demorou demais' }).expect(403);
      expect(refused.body.message).toContain('só um gerente');
      await cancel(manager, ctx.tab.id, itemId, { quantity: 1, reason: 'Demorou demais' }).expect(200);

      expect(await balance(ctx.branchId, ctx.bunId)).toBe(8);
      const cancellation = await prisma().tabItemCancellation.findFirstOrThrow({ where: { tabItemId: itemId } });
      expect(cancellation).toMatchObject({ statusAtCancel: 'PREPARING', stockOutcome: 'WASTED' });
      expect(await prisma().stockMovement.count({ where: { referenceId: cancellation.id } })).toBe(0);
      const item = await prisma().tabItem.findUniqueOrThrow({ where: { id: itemId } });
      expect(item).toMatchObject({ status: 'PREPARING', cancelledQuantity: 1 });
    });

    it('READY: the manager may say the ingredients went back; SERVED never goes back', async () => {
      const ctx = await setup();
      const ready = await sendOne(ctx, 2);
      await setStatus(ready, 'READY');
      await cancel(ctx.accessToken, ctx.tab.id, ready, { quantity: 1, reason: 'Lata fechada', returnToStock: true }).expect(200);
      expect(await balance(ctx.branchId, ctx.bunId)).toBe(9);

      const served = await sendOne(ctx, 1);
      await setStatus(served, 'SERVED');
      const refused = await cancel(ctx.accessToken, ctx.tab.id, served, { quantity: 1, reason: 'Reclamou', returnToStock: true }).expect(400);
      expect(refused.body.code).toBe('SERVED_ITEM_CANNOT_RETURN');
      await cancel(ctx.accessToken, ctx.tab.id, served, { quantity: 1, reason: 'Reclamou do ponto' }).expect(200);
      expect(await balance(ctx.branchId, ctx.bunId)).toBe(8);
      expect((await prisma().tabItemCancellation.findFirstOrThrow({ where: { tabItemId: served } })).stockOutcome).toBe('WASTED');
    });

    it('partial cancellations: 3 sent, 1 + 1 + 1 cancelled, the bill and the stock follow each one', async () => {
      const ctx = await setup();
      const itemId = await sendOne(ctx, 3);
      expect(await balance(ctx.branchId, ctx.bunId)).toBe(7);

      const one = await cancel(ctx.accessToken, ctx.tab.id, itemId, { quantity: 1, reason: 'Pediu um a menos' }).expect(200);
      expect(one.body.items[0]).toMatchObject({ status: 'SENT', quantity: 3, cancelledQuantity: 1, activeQuantity: 2, subtotalCents: 5000 });
      expect(one.body.totalCents).toBe(5000);
      expect(await balance(ctx.branchId, ctx.bunId)).toBe(8);

      await cancel(ctx.accessToken, ctx.tab.id, itemId, { quantity: 1, reason: 'Mais um a menos' }).expect(200);
      const last = await cancel(ctx.accessToken, ctx.tab.id, itemId, { quantity: 1, reason: 'Desistiu de tudo' }).expect(200);
      expect(last.body.items[0]).toMatchObject({ status: 'CANCELLED', cancelledQuantity: 3, activeQuantity: 0 });
      expect(await balance(ctx.branchId, ctx.bunId)).toBe(10);
      expect(await prisma().tabItemCancellation.count({ where: { tabItemId: itemId } })).toBe(3);
    });

    it('cancelling a fractional consumption unit by unit gives back exactly what was taken', async () => {
      const ctx = await setup();
      const fries = (await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.fries.id, quantity: 3 }]).expect(201)).body.items[0].id;
      expect(await balance(ctx.branchId, ctx.potatoId)).toBe(1.4);
      for (const reason of ['Um a menos', 'Outro a menos', 'O último']) {
        await cancel(ctx.accessToken, ctx.tab.id, fries, { quantity: 1, reason }).expect(200);
      }
      expect(await balance(ctx.branchId, ctx.potatoId)).toBe(2);
    });

    it('never more units than are active, never twice the same units, never without a reason', async () => {
      const ctx = await setup();
      const itemId = await sendOne(ctx, 2);
      const tooMany = await cancel(ctx.accessToken, ctx.tab.id, itemId, { quantity: 3, reason: 'Erro de lançamento' }).expect(409);
      expect(tooMany.body.code).toBe('TAB_ITEM_CANCEL_QUANTITY');
      expect(tooMany.body.message).toContain('Só há 2 unidades ativas');

      const noReason = await cancel(ctx.accessToken, ctx.tab.id, itemId, { quantity: 1 }).expect(400);
      expect(JSON.stringify(noReason.body)).toContain('Informe o motivo do cancelamento');
      await cancel(ctx.accessToken, ctx.tab.id, itemId, { quantity: 1, reason: '   ' }).expect(400);
      await cancel(ctx.accessToken, ctx.tab.id, itemId, { quantity: 0, reason: 'Zero' }).expect(400);

      await cancel(ctx.accessToken, ctx.tab.id, itemId, { quantity: 2, reason: 'Erro de lançamento' }).expect(200);
      const again = await cancel(ctx.accessToken, ctx.tab.id, itemId, { quantity: 1, reason: 'De novo' }).expect(409);
      expect(again.body.code).toBe('TAB_ITEM_ALREADY_CANCELLED');
      expect(await balance(ctx.branchId, ctx.bunId)).toBe(10);
    });

    it('two cancellations at once never cancel more than the item has, nor return more stock', async () => {
      const ctx = await setup();
      const itemId = await sendOne(ctx, 3);
      const results = await Promise.all([
        cancel(ctx.accessToken, ctx.tab.id, itemId, { quantity: 2, reason: 'Primeiro garçom' }),
        cancel(ctx.accessToken, ctx.tab.id, itemId, { quantity: 2, reason: 'Segundo garçom' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await prisma().tabItem.findUniqueOrThrow({ where: { id: itemId } })).cancelledQuantity).toBe(2);
      expect(await balance(ctx.branchId, ctx.bunId)).toBe(9);
    });

    it('cancelled units free room under the 50-units limit', async () => {
      const ctx = await setup({ buns: 60 });
      const itemId = await sendOne(ctx, 50);
      await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 1 }]).expect(400);
      await cancel(ctx.accessToken, ctx.tab.id, itemId, { quantity: 10, reason: 'Lançou a mais' }).expect(200);
      await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 10 }]).expect(201);
      await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 1 }]).expect(400);
    });

    it('a closed tab refuses; the kitchen cannot cancel; another tenant or branch cannot reach the item', async () => {
      const ctx = await setup();
      const itemId = await sendOne(ctx, 2);
      const kitchen = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'KITCHEN', [ctx.branchId]);
      await cancel(kitchen, ctx.tab.id, itemId, { quantity: 1, reason: 'Acabou o pão' }).expect(403);
      const b = await registerTenantE2E(server);
      await cancel(b.accessToken, ctx.tab.id, itemId, { quantity: 1, reason: 'Outro restaurante' }).expect(404);
      const otherBranch = await prisma().branch.create({ data: { tenantId: ctx.tenantId, name: 'Filial', code: `F-${uniqueSuffix()}` } });
      const outsider = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'MANAGER', [otherBranch.id]);
      await cancel(outsider, ctx.tab.id, itemId, { quantity: 1, reason: 'Outra filial' }).expect(403);

      await request(server)
        .post(`/v1/tabs/${ctx.tab.id}/checkout`)
        .set(auth(ctx.accessToken))
        .send({ paymentMethod: 'PIX', idempotencyKey: key('chk') })
        .expect(200);
      const closed = await cancel(ctx.accessToken, ctx.tab.id, itemId, { quantity: 1, reason: 'Depois de pago' }).expect(409);
      expect(closed.body.code).toBe('TAB_CLOSED');
      expect(await prisma().tabItemCancellation.count({ where: { tabItemId: itemId } })).toBe(0);
    });
  });

  describe('checkout', () => {
    useApp();

    const checkout = (token: string, tabId: string, body: Record<string, unknown> = {}) =>
      request(server)
        .post(`/v1/tabs/${tabId}/checkout`)
        .set(auth(token))
        .send({ paymentMethod: 'PIX', idempotencyKey: key('chk'), ...body });
    const cancel = (token: string, tabId: string, itemId: string, quantity: number) =>
      request(server).post(`/v1/tabs/${tabId}/items/${itemId}/cancel`).set(auth(token)).send({ quantity, reason: 'Cancelado no teste' });

    it('the stock runs out after the rounds went to the kitchen: the bill still closes', async () => {
      const ctx = await setup({ buns: 2 });
      await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 2 }]).expect(201);
      expect(await balance(ctx.branchId, ctx.bunId)).toBe(0);
      // Another table can no longer have it: the stock really is gone...
      const other = await openTab(ctx.accessToken, ctx.branchId, 9);
      await send(ctx.accessToken, other.id, [{ productId: ctx.burger.id, quantity: 1 }]).expect(409);
      // ...and the first table's bill closes anyway.
      const res = await checkout(ctx.accessToken, ctx.tab.id).expect(200);
      expect(res.body.status).toBe('CLOSED');
      expect(res.body.order.totalCents).toBe(5000);
      expect(await balance(ctx.branchId, ctx.bunId)).toBe(0);
    });

    it('the checkout consumes nothing more: no ORDER movement, the TAB_ITEM ones unchanged', async () => {
      const ctx = await setup();
      await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 2 }]).expect(201);
      await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.fries.id, quantity: 1 }]).expect(201);
      const before = await tabMovements(ctx.tenantId);
      await checkout(ctx.accessToken, ctx.tab.id).expect(200);

      const order = await prisma().order.findUniqueOrThrow({ where: { tabId: ctx.tab.id } });
      expect(await prisma().stockMovement.count({ where: { referenceType: 'ORDER', referenceId: order.id } })).toBe(0);
      expect((await tabMovements(ctx.tenantId)).map((m) => m.id).sort()).toEqual(before.map((m) => m.id).sort());
      expect(await balance(ctx.branchId, ctx.bunId)).toBe(8);
      expect(await balance(ctx.branchId, ctx.potatoId)).toBe(1.8);
    });

    it('each item is billed once, for the units still due; fully cancelled items are not billed', async () => {
      const ctx = await setup();
      const burgers = (await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 3 }]).expect(201)).body.items[0].id;
      const fries = (await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.fries.id, quantity: 1 }]).expect(201)).body.items[1].id;
      await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.soda.id, quantity: 2 }]).expect(201);
      await cancel(ctx.accessToken, ctx.tab.id, burgers, 1).expect(200);
      await cancel(ctx.accessToken, ctx.tab.id, fries, 1).expect(200);

      const res = await checkout(ctx.accessToken, ctx.tab.id).expect(200);
      // 2 x 25,00 + 2 x 6,00
      expect(res.body.order.totalCents).toBe(6200);
      const order = await prisma().order.findUniqueOrThrow({ where: { tabId: ctx.tab.id }, include: { items: true } });
      expect(order.items.map((i) => [i.productNameSnapshot, i.quantity, i.tabItemId !== null]).sort()).toEqual([
        ['Refrigerante', 2, true],
        ['X-Burger', 2, true],
      ]);
      expect(order.items.find((i) => i.productNameSnapshot === 'X-Burger')!.tabItemId).toBe(burgers);
      // The database refuses a second line billing the same tab item.
      await expect(
        prisma().orderItem.create({
          data: { orderId: order.id, productId: ctx.burger.id, productNameSnapshot: 'X-Burger', unitPriceCents: 2500, quantity: 1, subtotalCents: 2500, tabItemId: burgers },
        }),
      ).rejects.toThrow();
    });

    it('cash: needs an open drawer and enters it once; fiado is refused and the tab stays open; card is paid', async () => {
      const ctx = await setup();
      await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 1 }]).expect(201);
      expect((await checkout(ctx.accessToken, ctx.tab.id, { paymentMethod: 'CASH' }).expect(409)).body.code).toBe('CASH_REGISTER_NOT_OPEN');
      await request(server).post('/v1/cash/sessions').set(auth(ctx.accessToken)).send({ branchId: ctx.branchId, openingBalanceCents: 0 }).expect(201);
      await checkout(ctx.accessToken, ctx.tab.id, { paymentMethod: 'CASH' }).expect(200);
      const order = await prisma().order.findUniqueOrThrow({ where: { tabId: ctx.tab.id } });
      const sales = await prisma().cashMovement.findMany({ where: { tenantId: ctx.tenantId, type: 'SALE' } });
      expect(sales.map((m) => [m.orderId, m.amountCents])).toEqual([[order.id, 2500]]);
      expect(await prisma().payment.count({ where: { orderId: order.id, status: 'CONFIRMED', amountCents: 2500 } })).toBe(1);

      const customer = (
        await request(server).post('/v1/customers').set(auth(ctx.accessToken)).send({ name: 'Cliente Fiado', phone: '11912345678' }).expect(201)
      ).body;
      const second = await openTab(ctx.accessToken, ctx.branchId, 6);
      await send(ctx.accessToken, second.id, [{ productId: ctx.fries.id, quantity: 2 }]).expect(201);
      // Fiado is no longer sold (remocao-fiado): refused, nothing written, the bill still open.
      const refused = await checkout(ctx.accessToken, second.id, { paymentMethod: 'ON_ACCOUNT', customerId: customer.id }).expect(400);
      expect(refused.body.message).toContain('fiado');
      await checkout(ctx.accessToken, second.id, { paymentMethod: 'ON_ACCOUNT', customerId: customer.id, creditTerms: { installments: 1, firstDueDate: '2099-01-10' } }).expect(400);
      expect(await prisma().order.count({ where: { tabId: second.id } })).toBe(0);
      expect((await prisma().tab.findUniqueOrThrow({ where: { id: second.id } })).status).toBe('OPEN');
      await checkout(ctx.accessToken, second.id, { paymentMethod: 'CARD', customerId: customer.id }).expect(200);
      const paid = await prisma().order.findUniqueOrThrow({ where: { tabId: second.id }, include: { payment: true, receivable: true } });
      expect(paid.payment).toMatchObject({ method: 'CARD', status: 'CONFIRMED', amountCents: 2400 });
      expect(paid.receivable).toBeNull();
      expect(paid.totalCents).toBe(2400);
    });

    it('close-empty frees the table of a tab with nothing to charge, without a sale', async () => {
      const ctx = await setup();
      const closeEmpty = (token: string, tabId: string) => request(server).post(`/v1/tabs/${tabId}/close-empty`).set(auth(token));
      const itemId = (await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 2 }]).expect(201)).body.items[0].id;

      const busy = await closeEmpty(ctx.accessToken, ctx.tab.id).expect(409);
      expect(busy.body.code).toBe('TAB_HAS_ITEMS_TO_CHARGE');
      await cancel(ctx.accessToken, ctx.tab.id, itemId, 2).expect(200);
      expect((await checkout(ctx.accessToken, ctx.tab.id).expect(409)).body.code).toBe('TAB_EMPTY');

      const cashier = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'CASHIER', [ctx.branchId]);
      await closeEmpty(cashier, ctx.tab.id).expect(403);
      const waiter = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'WAITER', [ctx.branchId]);
      const res = await closeEmpty(waiter, ctx.tab.id).expect(200);
      expect(res.body.status).toBe('CLOSED');
      expect(res.body.order).toBeNull();
      expect(await prisma().order.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect(await prisma().auditLog.count({ where: { tenantId: ctx.tenantId, action: 'TAB_CLOSED_EMPTY', entityId: ctx.tab.id } })).toBe(1);
      expect((await closeEmpty(ctx.accessToken, ctx.tab.id).expect(409)).body.code).toBe('TAB_ALREADY_CLOSED');

      // A tab opened by mistake, with nothing sent, also frees its table.
      const mistaken = await openTab(ctx.accessToken, ctx.branchId, 11);
      await closeEmpty(ctx.accessToken, mistaken.id).expect(200);
      const table = await prisma().tab.findUniqueOrThrow({ where: { id: mistaken.id } });
      await request(server).post('/v1/tabs').set(auth(ctx.accessToken)).send({ branchId: ctx.branchId, tableId: table.tableId }).expect(201);
    });

    it('a tab opened before rounds existed (legacy items) still closes, and consumes its recipes then', async () => {
      const ctx = await setup({ buns: 1 });
      // Exactly what migration 19 leaves for an OPEN tab: items with no round, status SERVED.
      const legacy = await prisma().tabItem.create({
        data: { tenantId: ctx.tenantId, tabId: ctx.tab.id, productId: ctx.burger.id, productNameSnapshot: 'X-Burger', unitPriceCentsSnapshot: 2500, quantity: 3, status: 'SERVED' },
      });
      const cancelledLegacy = await prisma().tabItem.create({
        data: { tenantId: ctx.tenantId, tabId: ctx.tab.id, productId: ctx.fries.id, productNameSnapshot: 'Batata', unitPriceCentsSnapshot: 1200, quantity: 1, status: 'SERVED' },
      });
      const detail = (await request(server).get(`/v1/tabs/${ctx.tab.id}`).set(auth(ctx.accessToken)).expect(200)).body;
      expect(detail.items.map((i: { status: string; roundNumber: number | null }) => [i.status, i.roundNumber])).toEqual([
        ['SERVED', null],
        ['SERVED', null],
      ]);
      expect(detail.totalCents).toBe(8700);

      // A legacy item counts as delivered: only a manager cancels it, and nothing goes back
      // (nothing was consumed for it).
      const waiter = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'WAITER', [ctx.branchId]);
      await cancel(waiter, ctx.tab.id, cancelledLegacy.id, 1).expect(403);
      await cancel(ctx.accessToken, ctx.tab.id, cancelledLegacy.id, 1).expect(200);
      expect((await prisma().tabItemCancellation.findFirstOrThrow({ where: { tabItemId: cancelledLegacy.id } })).stockOutcome).toBe('NONE');

      // New rounds work on the same tab.
      await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.soda.id, quantity: 1 }]).expect(201);

      const res = await checkout(ctx.accessToken, ctx.tab.id).expect(200);
      expect(res.body.order.totalCents).toBe(8100);
      // 3 buns for the legacy burgers with only 1 in stock: consumed anyway, the food was served.
      expect(await balance(ctx.branchId, ctx.bunId)).toBe(-2);
      expect(await balance(ctx.branchId, ctx.potatoId)).toBe(2);
      const legacySale = await prisma().stockMovement.findMany({ where: { referenceType: 'TAB_ITEM', referenceId: legacy.id } });
      expect(legacySale.map((m) => Number(m.quantity))).toEqual([-3]);
      const order = await prisma().order.findUniqueOrThrow({ where: { tabId: ctx.tab.id }, include: { items: true } });
      expect(order.items.map((i) => i.tabItemId).sort()).toEqual(
        [legacy.id, (await prisma().tabItem.findFirstOrThrow({ where: { tabId: ctx.tab.id, productId: ctx.soda.id } })).id].sort(),
      );
    });
  });

  describe('kitchen', () => {
    useApp();

    type Round = { id: string; tabId: string; roundNumber: number; tableNumber: number; status: string; items: { id: string; name: string; quantity: number; notes: string | null; status: string }[] };
    const board = async (token: string) =>
      (await request(server).get('/v1/orders/board').set(auth(token)).expect(200)).body as {
        columns: { status: string; tableRounds: Round[]; tableRoundsTotal: number }[];
      };
    const roundsIn = async (token: string, column: string) => (await board(token)).columns.find((c) => c.status === column)!.tableRounds;
    const advance = (token: string, roundId: string, from: string, to: string) =>
      request(server).patch(`/v1/kitchen/tab-rounds/${roundId}/status`).set(auth(token)).send({ from, to });

    it('the first round appears in the "Novo" column with table, round number, items, quantities and notes', async () => {
      const ctx = await setup();
      const kitchen = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'KITCHEN', [ctx.branchId]);
      await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 2, notes: 'sem cebola' }]).expect(201);

      const fresh = await roundsIn(kitchen, 'PENDING');
      expect(fresh).toHaveLength(1);
      expect(fresh[0]).toMatchObject({ tabId: ctx.tab.id, tableNumber: 4, roundNumber: 1, status: 'SENT' });
      expect(fresh[0].items).toEqual([expect.objectContaining({ name: 'X-Burger', quantity: 2, notes: 'sem cebola', status: 'SENT' })]);
      expect((await board(kitchen)).columns.find((c) => c.status === 'CONFIRMED')!.tableRounds).toHaveLength(0);
    });

    it('a second round reaches the kitchen with ONLY the new items; the first keeps its own stage', async () => {
      const ctx = await setup();
      const kitchen = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'KITCHEN', [ctx.branchId]);
      const first = (await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 2 }]).expect(201)).body.round;
      await advance(kitchen, first.id, 'SENT', 'PREPARING').expect(200);
      await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.fries.id, quantity: 1 }]).expect(201);

      const fresh = await roundsIn(kitchen, 'PENDING');
      expect(fresh.map((r) => [r.roundNumber, r.items.map((i) => `${i.quantity}x ${i.name}`)])).toEqual([[2, ['1x Batata']]]);
      const preparing = await roundsIn(kitchen, 'PREPARING');
      expect(preparing.map((r) => [r.roundNumber, r.items.map((i) => `${i.quantity}x ${i.name}`)])).toEqual([[1, ['2x X-Burger']]]);
    });

    it('the kitchen moves a round SENT -> PREPARING -> READY -> SERVED, and it leaves the board', async () => {
      const ctx = await setup();
      const kitchen = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'KITCHEN', [ctx.branchId]);
      const round = (await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 1 }, { productId: ctx.soda.id, quantity: 2 }]).expect(201)).body.round;

      await advance(kitchen, round.id, 'SENT', 'PREPARING').expect(200);
      // A second screen still showing it as new is told, and nothing moves twice.
      expect((await advance(kitchen, round.id, 'SENT', 'PREPARING').expect(409)).body.code).toBe('TAB_ROUND_ALREADY_MOVED');
      expect((await advance(kitchen, round.id, 'PREPARING', 'SENT').expect(400)).body.code).toBe('VALIDATION_ERROR');
      await advance(kitchen, round.id, 'PREPARING', 'READY').expect(200);
      expect((await roundsIn(kitchen, 'READY')).map((r) => r.id)).toEqual([round.id]);
      await advance(kitchen, round.id, 'READY', 'SERVED').expect(200);
      for (const column of ['PENDING', 'CONFIRMED', 'PREPARING', 'READY']) expect(await roundsIn(kitchen, column)).toHaveLength(0);

      const items = await prisma().tabItem.findMany({ where: { roundId: round.id } });
      for (const item of items) {
        expect(item.status).toBe('SERVED');
        expect(item.preparingAt).not.toBeNull();
        expect(item.readyAt).not.toBeNull();
        expect(item.servedAt).not.toBeNull();
      }
      // No stock, no money touched by production.
      expect(await tabMovements(ctx.tenantId)).toHaveLength(1);
      expect(await prisma().auditLog.count({ where: { tenantId: ctx.tenantId, action: 'TAB_ROUND_STATUS_CHANGED', entityId: round.id } })).toBe(3);
    });

    it('a round partly delivered or cancelled shows only what is still to be made', async () => {
      const ctx = await setup();
      const kitchen = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'KITCHEN', [ctx.branchId]);
      const sent = (await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 3 }, { productId: ctx.soda.id, quantity: 1 }]).expect(201)).body;
      const [burgerItem, sodaItem] = sent.items;
      // The waiter takes the soda from the fridge and cancels one burger.
      await request(server).post(`/v1/tabs/${ctx.tab.id}/items/${sodaItem.id}/serve`).set(auth(ctx.accessToken)).expect(200);
      await request(server)
        .post(`/v1/tabs/${ctx.tab.id}/items/${burgerItem.id}/cancel`)
        .set(auth(ctx.accessToken))
        .send({ quantity: 1, reason: 'Pediu um a menos' })
        .expect(200);
      const fresh = await roundsIn(kitchen, 'PENDING');
      expect(fresh[0].items.map((i) => `${i.quantity}x ${i.name}`)).toEqual(['2x X-Burger']);
      // Cancelling the rest takes the round off the board.
      await request(server)
        .post(`/v1/tabs/${ctx.tab.id}/items/${burgerItem.id}/cancel`)
        .set(auth(ctx.accessToken))
        .send({ quantity: 2, reason: 'Desistiu' })
        .expect(200);
      expect(await roundsIn(kitchen, 'PENDING')).toHaveLength(0);
    });

    it('the waiter marks an item delivered from any production state, never twice', async () => {
      const ctx = await setup();
      const waiter = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'WAITER', [ctx.branchId]);
      const itemId = (await send(waiter, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 1 }]).expect(201)).body.items[0].id;
      const res = await request(server).post(`/v1/tabs/${ctx.tab.id}/items/${itemId}/serve`).set(auth(waiter)).expect(200);
      expect(res.body.items[0]).toMatchObject({ status: 'SERVED' });
      expect(res.body.items[0].servedAt).not.toBeNull();
      const again = await request(server).post(`/v1/tabs/${ctx.tab.id}/items/${itemId}/serve`).set(auth(waiter)).expect(409);
      expect(again.body.code).toBe('TAB_ITEM_NOT_IN_PRODUCTION');
    });

    it('production goes on after the bill is paid: the round stays on the board and can be finished', async () => {
      const ctx = await setup();
      const kitchen = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'KITCHEN', [ctx.branchId]);
      const round = (await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 1 }]).expect(201)).body.round;
      await request(server)
        .post(`/v1/tabs/${ctx.tab.id}/checkout`)
        .set(auth(ctx.accessToken))
        .send({ paymentMethod: 'PIX', idempotencyKey: key('chk') })
        .expect(200);

      expect((await roundsIn(kitchen, 'PENDING')).map((r) => r.id)).toEqual([round.id]);
      await advance(kitchen, round.id, 'SENT', 'PREPARING').expect(200);
      await advance(kitchen, round.id, 'PREPARING', 'READY').expect(200);
      await advance(kitchen, round.id, 'READY', 'SERVED').expect(200);
      expect(await roundsIn(kitchen, 'READY')).toHaveLength(0);
      // The sale itself never changed.
      const order = await prisma().order.findUniqueOrThrow({ where: { tabId: ctx.tab.id } });
      expect(order).toMatchObject({ status: 'COMPLETED', totalCents: 2500 });
      expect(await balance(ctx.branchId, ctx.bunId)).toBe(9);
    });

    it('isolation: another tenant or branch neither sees nor moves the round; a waiter cannot use the kitchen route', async () => {
      const ctx = await setup();
      const round = (await send(ctx.accessToken, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 1 }]).expect(201)).body.round;
      const b = await registerTenantE2E(server);
      expect(await roundsIn(b.accessToken, 'PENDING')).toHaveLength(0);
      await advance(b.accessToken, round.id, 'SENT', 'PREPARING').expect(404);

      const otherBranch = await prisma().branch.create({ data: { tenantId: ctx.tenantId, name: 'Filial', code: `F-${uniqueSuffix()}` } });
      const otherKitchen = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'KITCHEN', [otherBranch.id]);
      expect(await roundsIn(otherKitchen, 'PENDING')).toHaveLength(0);
      await advance(otherKitchen, round.id, 'SENT', 'PREPARING').expect(403);

      const waiter = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'WAITER', [ctx.branchId]);
      await advance(waiter, round.id, 'SENT', 'PREPARING').expect(403);
      expect((await prisma().tabItem.findFirstOrThrow({ where: { roundId: round.id } })).status).toBe('SENT');
    });
  });

  describe('who may send', () => {
    useApp();

    it('isolates tenants: another tenant cannot send to the tab nor use its own products here', async () => {
      const ctx = await setup();
      const b = await registerTenantE2E(server);
      const productB = await createActiveProductE2E(server, b.accessToken, 'Produto B', 10);
      await send(b.accessToken, ctx.tab.id, [{ productId: productB.id, quantity: 1 }]).expect(404);
      expect((await send(ctx.accessToken, ctx.tab.id, [{ productId: productB.id, quantity: 1 }]).expect(400)).body.code).toBe('PRODUCT_UNAVAILABLE');
      expect(await prisma().tabItem.count({ where: { tabId: ctx.tab.id } })).toBe(0);
    });

    it('isolates branches: a waiter of another branch gets 403; a waiter of this branch sends; the kitchen cannot', async () => {
      const ctx = await setup();
      const otherBranch = await prisma().branch.create({ data: { tenantId: ctx.tenantId, name: 'Filial', code: `F-${uniqueSuffix()}` } });
      const outsider = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'WAITER', [otherBranch.id]);
      const waiter = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'WAITER', [ctx.branchId]);
      const kitchen = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'KITCHEN', [ctx.branchId]);

      await send(outsider, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 1 }]).expect(403);
      await send(kitchen, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 1 }]).expect(403);
      const ok = await send(waiter, ctx.tab.id, [{ productId: ctx.burger.id, quantity: 1 }]).expect(201);
      expect(ok.body.round.number).toBe(1);
    });
  });
});
