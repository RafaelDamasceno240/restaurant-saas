import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createActiveProductE2E,
  createStaffAndLoginE2E,
  createTestApp,
  getPrisma,
  registerTenantE2E,
  uniqueSuffix,
} from './test-app.util';
import { InventoryService } from '../src/modules/inventory/inventory.service';

type Json = Record<string, unknown>;

describe('Inventory (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });
  afterAll(async () => {
    await app.close();
  });

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) => request(server).get(path).set(auth(token));
  const createItem = (token: string, body: Json) => request(server).post('/v1/inventory/items').set(auth(token)).send(body);
  const move = (token: string, body: Json) => request(server).post('/v1/inventory/movements').set(auth(token)).send(body);
  const count = (token: string, body: Json) =>
    request(server).post('/v1/inventory/inventory-counts').set(auth(token)).send(body);
  const putRecipe = (token: string, productId: string, items: Json[]) =>
    request(server).put(`/v1/inventory/recipes/${productId}`).set(auth(token)).send({ items });
  const setStatus = (token: string, orderId: string, status: string) =>
    request(server).patch(`/v1/orders/${orderId}/status`).set(auth(token)).send({ status });

  const isoDay = (offsetDays: number) => new Date(Date.now() + offsetDays * 86_400_000).toISOString().slice(0, 10);

  async function balanceOf(token: string, branchId: string, itemId: string) {
    const res = await get(token, `/v1/inventory/balances?branchId=${branchId}`).expect(200);
    return res.body.find((row: { id: string }) => row.id === itemId) as {
      quantity: number;
      averageCostCents: number;
      stockValueCents: number;
      status: string;
    };
  }

  async function item(token: string, name: string, unit: string, extra: Json = {}) {
    const res = await createItem(token, { name: `${name} ${uniqueSuffix()}`, unit, ...extra }).expect(201);
    return res.body as { id: string; name: string };
  }

  function entry(token: string, branchId: string, inventoryItemId: string, quantity: number, unitCostCents = 1000, extra: Json = {}) {
    return move(token, { branchId, inventoryItemId, type: 'ENTRY', quantity, unitCostCents, ...extra }).expect(201);
  }

  function exit(token: string, branchId: string, inventoryItemId: string, quantity: number, exitReason = 'CONSUMPTION') {
    return move(token, { branchId, inventoryItemId, type: 'EXIT', quantity, exitReason });
  }

  async function sellPending(token: string, branchId: string, productId: string, quantity: number) {
    const res = await request(server)
      .post('/v1/pos/orders')
      .set(auth(token))
      .send({ branchId, items: [{ productId, quantity }], paymentMethod: 'PIX' })
      .expect(201);
    return res.body as { id: string };
  }

  async function burgerSetup() {
    const tenant = await registerTenantE2E(server);
    const t = tenant.accessToken;
    const bread = await item(t, 'Pão', 'UNIT');
    const meat = await item(t, 'Carne', 'KG', { minStock: 1 });
    const cheese = await item(t, 'Queijo', 'KG');
    const burger = await createActiveProductE2E(server, t, 'X-Burger', 29.9);
    await putRecipe(t, burger.id, [
      { inventoryItemId: bread.id, quantity: 1 },
      { inventoryItemId: meat.id, quantity: 150, unit: 'G' },
      { inventoryItemId: cheese.id, quantity: 30, unit: 'G' },
    ]).expect(200);
    await entry(t, tenant.branchId, bread.id, 10, 150);
    await entry(t, tenant.branchId, meat.id, 2, 4000);
    await entry(t, tenant.branchId, cheese.id, 1, 5000);
    return { ...tenant, bread, meat, cheese, burger };
  }

  describe('items', () => {
    it('creates and updates an item with limits, expiry control and notes', async () => {
      const { accessToken, tenantId } = await registerTenantE2E(server);
      const created = (
        await createItem(accessToken, {
          name: 'Queijo prato',
          sku: 'QJ-1',
          unit: 'KG',
          minStock: 2.5,
          maxStock: 10,
          tracksExpiry: true,
          notes: 'Manter refrigerado',
        }).expect(201)
      ).body;
      expect(created).toMatchObject({
        name: 'Queijo prato',
        unit: 'KG',
        minStock: 2.5,
        maxStock: 10,
        tracksExpiry: true,
        notes: 'Manter refrigerado',
        active: true,
      });

      const updated = (
        await request(server)
          .patch(`/v1/inventory/items/${created.id}`)
          .set(auth(accessToken))
          .send({ name: 'Queijo prato fatiado', maxStock: null, active: false })
          .expect(200)
      ).body;
      expect(updated).toMatchObject({ name: 'Queijo prato fatiado', maxStock: null, active: false, unit: 'KG' });

      const prisma = getPrisma(app);
      const actions = await prisma.auditLog.findMany({ where: { tenantId, entityId: created.id }, select: { action: true } });
      expect(actions.map((a) => a.action).sort()).toEqual(['INVENTORY_ITEM_CREATED', 'INVENTORY_ITEM_UPDATED']);
    });

    it('validates unit immutability, SKU uniqueness, limits and precision', async () => {
      const { accessToken } = await registerTenantE2E(server);
      const created = (await createItem(accessToken, { name: 'Farinha', sku: 'FAR', unit: 'KG' }).expect(201)).body;
      await request(server).patch(`/v1/inventory/items/${created.id}`).set(auth(accessToken)).send({ unit: 'G' }).expect(400);
      expect((await createItem(accessToken, { name: 'Outra', sku: 'FAR', unit: 'KG' }).expect(409)).body.code).toBe(
        'SKU_ALREADY_EXISTS',
      );
      expect((await createItem(accessToken, { name: 'Limites', unit: 'KG', minStock: 5, maxStock: 2 }).expect(400)).body.code).toBe(
        'INVALID_STOCK_LIMITS',
      );
      await createItem(accessToken, { name: 'Precisão', unit: 'KG', minStock: 0.0001 }).expect(400);
      await createItem(accessToken, { name: 'Sem unidade' }).expect(400);
    });
  });

  describe('entries and exits', () => {
    it('ENTRY updates balance and weighted average cost; supplier or document marks it as PURCHASE', async () => {
      const { accessToken, branchId } = await registerTenantE2E(server);
      const meat = await item(accessToken, 'Carne', 'KG');
      const manual = (await entry(accessToken, branchId, meat.id, 10, 2000)).body;
      const purchase = (
        await entry(accessToken, branchId, meat.id, 10, 3000, { supplierName: 'Frigorífico Sul', documentNumber: 'NF 4821' })
      ).body;
      expect(manual.origin).toBe('MANUAL');
      expect(purchase).toMatchObject({ origin: 'PURCHASE', supplierName: 'Frigorífico Sul', documentNumber: 'NF 4821' });
      expect(await balanceOf(accessToken, branchId, meat.id)).toMatchObject({
        quantity: 20,
        averageCostCents: 2500,
        stockValueCents: 50000,
        status: 'OK',
      });

      await move(accessToken, { branchId, inventoryItemId: meat.id, type: 'ENTRY', quantity: 1 }).expect(400);
      await move(accessToken, { branchId, inventoryItemId: meat.id, type: 'ENTRY', quantity: 0, unitCostCents: 1 }).expect(400);
    });

    it('items with expiry control require the expiry date and keep lot data', async () => {
      const { accessToken, branchId } = await registerTenantE2E(server);
      const milk = await item(accessToken, 'Leite', 'L', { tracksExpiry: true });
      const missing = await move(accessToken, { branchId, inventoryItemId: milk.id, type: 'ENTRY', quantity: 5, unitCostCents: 450 }).expect(400);
      expect(missing.body.code).toBe('EXPIRY_REQUIRED');
      const ok = (await entry(accessToken, branchId, milk.id, 5, 450, { lotCode: 'L-77', expiresAt: isoDay(20) })).body;
      expect(ok.lotCode).toBe('L-77');
      expect(ok.expiresAt.slice(0, 10)).toBe(isoDay(20));
    });

    it('EXIT requires a reason, OTHER requires notes, and never goes negative by default', async () => {
      const { accessToken, branchId } = await registerTenantE2E(server);
      const oil = await item(accessToken, 'Óleo', 'L');
      await entry(accessToken, branchId, oil.id, 5);

      await move(accessToken, { branchId, inventoryItemId: oil.id, type: 'EXIT', quantity: 1 }).expect(400);
      await move(accessToken, { branchId, inventoryItemId: oil.id, type: 'EXIT', quantity: 1, exitReason: 'OTHER' }).expect(400);
      await move(accessToken, { branchId, inventoryItemId: oil.id, type: 'EXIT', quantity: 0, exitReason: 'LOSS' }).expect(400);
      await move(accessToken, { branchId, inventoryItemId: oil.id, type: 'SALE', quantity: 1 }).expect(400);
      await move(accessToken, { branchId, inventoryItemId: oil.id, type: 'ADJUSTMENT', quantity: 1 }).expect(400);

      const ok = (await exit(accessToken, branchId, oil.id, 1.25, 'LOSS').expect(201)).body;
      expect(ok).toMatchObject({ type: 'EXIT', origin: 'MANUAL', exitReason: 'LOSS', quantity: -1.25, balanceAfter: 3.75 });

      const denied = await exit(accessToken, branchId, oil.id, 4).expect(409);
      expect(denied.body.code).toBe('INSUFFICIENT_STOCK');
      expect((await balanceOf(accessToken, branchId, oil.id)).quantity).toBe(3.75);
    });

    it('allows negative stock only when the branch setting is enabled', async () => {
      const { accessToken, branchId } = await registerTenantE2E(server);
      const oil = await item(accessToken, 'Óleo', 'L');
      await entry(accessToken, branchId, oil.id, 1);
      expect((await get(accessToken, `/v1/inventory/settings?branchId=${branchId}`).expect(200)).body.allowNegativeStock).toBe(false);
      await exit(accessToken, branchId, oil.id, 3).expect(409);

      await request(server).patch('/v1/inventory/settings').set(auth(accessToken)).send({ branchId, allowNegativeStock: true }).expect(200);
      expect((await exit(accessToken, branchId, oil.id, 3).expect(201)).body.balanceAfter).toBe(-2);
      expect((await balanceOf(accessToken, branchId, oil.id)).status).toBe('OUT_OF_STOCK');
    });

    it('derives LOW_STOCK when quantity <= minimum and OUT_OF_STOCK at zero', async () => {
      const { accessToken, branchId } = await registerTenantE2E(server);
      const cheese = await item(accessToken, 'Queijo', 'KG', { minStock: 2 });
      await entry(accessToken, branchId, cheese.id, 3);
      expect((await balanceOf(accessToken, branchId, cheese.id)).status).toBe('OK');
      await exit(accessToken, branchId, cheese.id, 1).expect(201);
      expect((await balanceOf(accessToken, branchId, cheese.id)).status).toBe('LOW_STOCK');
      await exit(accessToken, branchId, cheese.id, 2).expect(201);
      expect((await balanceOf(accessToken, branchId, cheese.id)).status).toBe('OUT_OF_STOCK');
    });
  });

  describe('inventory count', () => {
    it('turns the physical count into an auditable ADJUSTMENT (10 KG counted as 8,5 KG -> -1,5 KG)', async () => {
      const { accessToken, branchId, tenantId } = await registerTenantE2E(server);
      const flour = await item(accessToken, 'Farinha', 'KG');
      const sugar = await item(accessToken, 'Açúcar', 'KG');
      await entry(accessToken, branchId, flour.id, 10);
      await entry(accessToken, branchId, sugar.id, 4);

      const res = (
        await count(accessToken, {
          branchId,
          notes: 'Contagem de fechamento',
          items: [
            { inventoryItemId: flour.id, countedQuantity: 8.5 },
            { inventoryItemId: sugar.id, countedQuantity: 4 },
          ],
        }).expect(201)
      ).body;
      expect(res.adjustedCount).toBe(1);
      const flourLine = res.items.find((line: { inventoryItemId: string }) => line.inventoryItemId === flour.id);
      expect(flourLine).toMatchObject({ systemQuantity: 10, countedQuantity: 8.5, difference: -1.5 });
      const sugarLine = res.items.find((line: { inventoryItemId: string }) => line.inventoryItemId === sugar.id);
      expect(sugarLine).toMatchObject({ difference: 0, stockMovementId: null });

      expect((await balanceOf(accessToken, branchId, flour.id)).quantity).toBe(8.5);
      const prisma = getPrisma(app);
      const movement = await prisma.stockMovement.findUniqueOrThrow({ where: { id: flourLine.stockMovementId } });
      expect(movement).toMatchObject({ type: 'ADJUSTMENT', origin: 'INVENTORY', referenceType: 'INVENTORY_COUNT', referenceId: res.id });
      expect(movement.quantity.toFixed(3)).toBe('-1.500');
      expect(movement.createdByUserId).toBeTruthy();

      const audit = await prisma.auditLog.findMany({ where: { tenantId, action: { in: ['INVENTORY_COUNT_CREATED', 'INVENTORY_ADJUSTMENT'] } } });
      expect(audit.map((a) => a.action).sort()).toEqual(['INVENTORY_ADJUSTMENT', 'INVENTORY_COUNT_CREATED']);
    });

    it('rejects duplicated items, other tenants items and negative counts', async () => {
      const a = await registerTenantE2E(server);
      const b = await registerTenantE2E(server);
      const flour = await item(a.accessToken, 'Farinha', 'KG');
      const foreign = await item(b.accessToken, 'Farinha B', 'KG');
      await count(a.accessToken, {
        branchId: a.branchId,
        items: [
          { inventoryItemId: flour.id, countedQuantity: 1 },
          { inventoryItemId: flour.id, countedQuantity: 2 },
        ],
      }).expect(400);
      await count(a.accessToken, { branchId: a.branchId, items: [{ inventoryItemId: foreign.id, countedQuantity: 1 }] }).expect(404);
      await count(a.accessToken, { branchId: a.branchId, items: [{ inventoryItemId: flour.id, countedQuantity: -1 }] }).expect(400);
      await count(a.accessToken, { branchId: a.branchId, items: [] }).expect(400);
    });
  });

  describe('movements', () => {
    it('are immutable: no update/delete route and the database rejects UPDATE/DELETE', async () => {
      const { accessToken, branchId } = await registerTenantE2E(server);
      const salt = await item(accessToken, 'Sal', 'KG');
      const movement = (await entry(accessToken, branchId, salt.id, 1)).body;
      await request(server).patch(`/v1/inventory/movements/${movement.id}`).set(auth(accessToken)).send({ quantity: 9 }).expect(404);
      await request(server).delete(`/v1/inventory/movements/${movement.id}`).set(auth(accessToken)).expect(404);
      const prisma = getPrisma(app);
      await expect(prisma.stockMovement.update({ where: { id: movement.id }, data: { notes: 'x' } })).rejects.toThrow();
      await expect(prisma.stockMovement.delete({ where: { id: movement.id } })).rejects.toThrow();
    });

    it('lists newest first with filters by type, origin, item, user, period and search', async () => {
      const { accessToken, branchId, tenantId } = await registerTenantE2E(server);
      const manager = await createStaffAndLoginE2E(app, server, tenantId, 'MANAGER', [branchId]);
      const a = await item(accessToken, 'Alface', 'UNIT');
      const b = await item(accessToken, 'Bacon', 'KG');
      await entry(accessToken, branchId, a.id, 5, 100, { supplierName: 'Hortifruti Serra' });
      await entry(manager, branchId, b.id, 5);
      await exit(accessToken, branchId, a.id, 1, 'DAMAGE').expect(201);

      const base = `/v1/inventory/movements?branchId=${branchId}`;
      const all = (await get(accessToken, base).expect(200)).body;
      expect(all.meta.total).toBe(3);
      expect(all.data[0]).toMatchObject({ type: 'EXIT', exitReason: 'DAMAGE', quantity: -1 });
      expect(all.filters.users).toHaveLength(2);

      expect((await get(accessToken, `${base}&type=EXIT`).expect(200)).body.meta.total).toBe(1);
      expect((await get(accessToken, `${base}&origin=PURCHASE`).expect(200)).body.meta.total).toBe(1);
      expect((await get(accessToken, `${base}&inventoryItemId=${b.id}`).expect(200)).body.meta.total).toBe(1);
      const managerId = all.filters.users.find((u: { name: string }) => u.name.includes('MANAGER')).id;
      expect((await get(accessToken, `${base}&createdByUserId=${managerId}`).expect(200)).body.meta.total).toBe(1);
      expect((await get(accessToken, `${base}&search=hortifruti`).expect(200)).body.meta.total).toBe(1);
      expect((await get(accessToken, `${base}&from=2099-01-01`).expect(200)).body.meta.total).toBe(0);
    });
  });

  describe('concurrency', () => {
    it('balance 5: concurrent manual exits of 4 and 3 — exactly one succeeds', async () => {
      const { accessToken, branchId } = await registerTenantE2E(server);
      const bread = await item(accessToken, 'Pão', 'UNIT');
      await entry(accessToken, branchId, bread.id, 5);

      const [r1, r2] = await Promise.all([exit(accessToken, branchId, bread.id, 4), exit(accessToken, branchId, bread.id, 3)]);
      expect([r1.status, r2.status].sort()).toEqual([201, 409]);
      expect((r1.status === 409 ? r1 : r2).body.code).toBe('INSUFFICIENT_STOCK');
      expect([1, 2]).toContain((await balanceOf(accessToken, branchId, bread.id)).quantity);
      expect(await getPrisma(app).stockMovement.count({ where: { inventoryItemId: bread.id, type: 'EXIT' } })).toBe(1);
    });

    it('balance 5: two sales consuming 4 and 3 confirmed at the same time — exactly one is confirmed', async () => {
      const { accessToken, branchId } = await registerTenantE2E(server);
      const bread = await item(accessToken, 'Pão', 'UNIT');
      const sandwich = await createActiveProductE2E(server, accessToken, 'Sanduíche', 12);
      await putRecipe(accessToken, sandwich.id, [{ inventoryItemId: bread.id, quantity: 1 }]).expect(200);
      await entry(accessToken, branchId, bread.id, 5);
      const orderA = await sellPending(accessToken, branchId, sandwich.id, 4);
      const orderB = await sellPending(accessToken, branchId, sandwich.id, 3);

      const [a, b] = await Promise.all([
        setStatus(accessToken, orderA.id, 'CONFIRMED'),
        setStatus(accessToken, orderB.id, 'CONFIRMED'),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);
      const rejected = a.status === 409 ? orderA : orderB;
      expect((a.status === 409 ? a : b).body.code).toBe('INSUFFICIENT_STOCK');
      expect((await get(accessToken, `/v1/orders/${rejected.id}`).expect(200)).body.status).toBe('PENDING');
      expect([1, 2]).toContain((await balanceOf(accessToken, branchId, bread.id)).quantity);
    });

    it('many concurrent first entries never lose an update', async () => {
      const { accessToken, branchId } = await registerTenantE2E(server);
      const egg = await item(accessToken, 'Ovo', 'UNIT');
      const results = await Promise.all(
        Array.from({ length: 8 }, () =>
          move(accessToken, { branchId, inventoryItemId: egg.id, type: 'ENTRY', quantity: 1, unitCostCents: 100 }),
        ),
      );
      results.forEach((res) => expect(res.status).toBe(201));
      expect((await balanceOf(accessToken, branchId, egg.id)).quantity).toBe(8);
    });
  });

  describe('recipes and costs', () => {
    it('stores recipes in the stock unit, keeps the input unit and computes cost and margin on the backend', async () => {
      const { accessToken, branchId, burger, meat } = await burgerSetup();
      const recipe = (await get(accessToken, `/v1/inventory/recipes/${burger.id}?branchId=${branchId}`).expect(200)).body;
      const meatLine = recipe.items.find((line: { inventoryItemId: string }) => line.inventoryItemId === meat.id);
      expect(meatLine).toMatchObject({ quantity: 0.15, unit: 'KG', inputQuantity: 150, inputUnit: 'G', unitCostCents: 4000, subtotalCents: 600 });
      expect(recipe).toMatchObject({ priceCents: 2990, costCents: 900, marginCents: 2090, marginPercent: 69.9 });

      const list = (await get(accessToken, `/v1/inventory/recipes?branchId=${branchId}`).expect(200)).body;
      expect(list.find((row: { productId: string }) => row.productId === burger.id)).toMatchObject({
        hasRecipe: true,
        costCents: 900,
        marginCents: 2090,
        marginPercent: 69.9,
        producibleUnits: 10,
      });
    });

    it('rejects incompatible units, excessive precision and duplicated items', async () => {
      const { accessToken, burger, bread, cheese } = await burgerSetup();
      expect((await putRecipe(accessToken, burger.id, [{ inventoryItemId: bread.id, quantity: 1, unit: 'KG' }]).expect(400)).body.code).toBe(
        'INCOMPATIBLE_UNIT',
      );
      expect((await putRecipe(accessToken, burger.id, [{ inventoryItemId: cheese.id, quantity: 0.5, unit: 'G' }]).expect(400)).body.code).toBe(
        'INVALID_PRECISION',
      );
      await putRecipe(accessToken, burger.id, [
        { inventoryItemId: bread.id, quantity: 1 },
        { inventoryItemId: bread.id, quantity: 2 },
      ]).expect(400);
    });
  });

  describe('automatic consumption', () => {
    it('PENDING consumes nothing; CONFIRMED consumes recipe × quantity (2 × X-Burger -> 300 G of meat)', async () => {
      const { accessToken, branchId, burger, meat, bread, cheese } = await burgerSetup();
      const order = await sellPending(accessToken, branchId, burger.id, 2);
      expect((await balanceOf(accessToken, branchId, meat.id)).quantity).toBe(2);

      await setStatus(accessToken, order.id, 'CONFIRMED').expect(200);
      expect((await balanceOf(accessToken, branchId, meat.id)).quantity).toBe(1.7);
      expect((await balanceOf(accessToken, branchId, bread.id)).quantity).toBe(8);
      expect((await balanceOf(accessToken, branchId, cheese.id)).quantity).toBe(0.94);

      const sales = (await get(accessToken, `/v1/inventory/movements?branchId=${branchId}&type=SALE`).expect(200)).body;
      expect(sales.meta.total).toBe(3);
      expect(sales.data[0]).toMatchObject({ origin: 'ORDER', reference: { type: 'ORDER', id: order.id } });
      expect(sales.data[0].reference.label).toBeTruthy();

      await setStatus(accessToken, order.id, 'PREPARING').expect(200);
      await setStatus(accessToken, order.id, 'READY').expect(200);
      expect((await balanceOf(accessToken, branchId, meat.id)).quantity).toBe(1.7);
    });

    it('is idempotent: concurrent confirmations and re-processing never consume twice', async () => {
      const { accessToken, branchId, tenantId, burger, meat } = await burgerSetup();
      const order = await sellPending(accessToken, branchId, burger.id, 1);
      const [a, b] = await Promise.all([
        setStatus(accessToken, order.id, 'CONFIRMED'),
        setStatus(accessToken, order.id, 'CONFIRMED'),
      ]);
      expect([a.status, b.status].sort()).toEqual([200, 409]);

      const service = app.get(InventoryService);
      const prisma = getPrisma(app);
      const again = await prisma.$transaction((tx) =>
        service.consumeForOrderInTx(tx, { id: order.id, tenantId, branchId, items: [{ productId: burger.id, quantity: 1 }] }),
      );
      expect(again).toHaveLength(0);
      expect(await prisma.stockMovement.count({ where: { referenceId: order.id, type: 'SALE' } })).toBe(3);
      expect((await balanceOf(accessToken, branchId, meat.id)).quantity).toBe(1.85);
    });

    it('blocks the confirmation and keeps the order PENDING when stock is insufficient', async () => {
      const { accessToken, branchId, burger, bread } = await burgerSetup();
      const order = await sellPending(accessToken, branchId, burger.id, 11);
      expect((await setStatus(accessToken, order.id, 'CONFIRMED').expect(409)).body.code).toBe('INSUFFICIENT_STOCK');
      expect((await get(accessToken, `/v1/orders/${order.id}`).expect(200)).body.status).toBe('PENDING');
      expect((await balanceOf(accessToken, branchId, bread.id)).quantity).toBe(10);
    });

    it('cancelling after consumption writes REVERSAL movements and keeps history; cancelling PENDING writes none', async () => {
      const { accessToken, branchId, burger, meat } = await burgerSetup();
      const order = await sellPending(accessToken, branchId, burger.id, 2);
      await setStatus(accessToken, order.id, 'CONFIRMED').expect(200);
      await setStatus(accessToken, order.id, 'CANCELLED').expect(200);
      expect((await balanceOf(accessToken, branchId, meat.id)).quantity).toBe(2);

      const prisma = getPrisma(app);
      expect(await prisma.stockMovement.count({ where: { referenceId: order.id, type: 'SALE' } })).toBe(3);
      expect(await prisma.stockMovement.count({ where: { referenceId: order.id, type: 'REVERSAL', origin: 'REVERSAL' } })).toBe(3);

      const service = app.get(InventoryService);
      const again = await prisma.$transaction((tx) =>
        service.reverseForOrderInTx(tx, { id: order.id, tenantId: '', branchId }),
      );
      expect(again).toHaveLength(0);

      const pending = await sellPending(accessToken, branchId, burger.id, 1);
      await setStatus(accessToken, pending.id, 'CANCELLED').expect(200);
      expect(await prisma.stockMovement.count({ where: { referenceId: pending.id } })).toBe(0);
    });

    it('table checkout (order born COMPLETED) consumes stock in the same transaction', async () => {
      const { accessToken, branchId, burger, meat } = await burgerSetup();
      const table = (await request(server).post('/v1/tables').set(auth(accessToken)).send({ branchId, number: 7 }).expect(201)).body;
      const tab = (await request(server).post('/v1/tabs').set(auth(accessToken)).send({ branchId, tableId: table.id }).expect(201)).body;
      await request(server).post(`/v1/tabs/${tab.id}/items`).set(auth(accessToken)).send({ productId: burger.id, quantity: 3 }).expect(201);
      await request(server)
        .post(`/v1/tabs/${tab.id}/checkout`)
        .set(auth(accessToken))
        .send({ paymentMethod: 'PIX', idempotencyKey: `inv-${uniqueSuffix()}` })
        .expect(200);
      expect((await balanceOf(accessToken, branchId, meat.id)).quantity).toBe(1.55);
    });
  });

  describe('summary and alerts', () => {
    it('reports stock value, low/out counts and period totals for entries, exits and losses', async () => {
      const { accessToken, branchId } = await registerTenantE2E(server);
      const low = await item(accessToken, 'Queijo', 'KG', { minStock: 5 });
      const out = await item(accessToken, 'Tomate', 'KG', { minStock: 1 });
      await entry(accessToken, branchId, low.id, 4, 2500);
      await exit(accessToken, branchId, low.id, 1, 'LOSS').expect(201);
      await exit(accessToken, branchId, low.id, 1, 'CONSUMPTION').expect(201);
      expect(out.id).toBeTruthy();

      const summary = (await get(accessToken, `/v1/inventory/summary?branchId=${branchId}`).expect(200)).body;
      expect(summary).toMatchObject({
        stockValueCents: 5000,
        activeItemCount: 2,
        lowStockCount: 1,
        outOfStockCount: 1,
        entries: { count: 1, valueCents: 10000 },
        exits: { count: 2, valueCents: 5000 },
        losses: { count: 1, valueCents: 2500 },
      });
      expect(summary.recentActivity).toHaveLength(3);
    });

    it('flags out of stock, low stock, expired and expiring lots still on hand, and products without recipe', async () => {
      const { accessToken, branchId } = await registerTenantE2E(server);
      const milk = await item(accessToken, 'Leite', 'L', { tracksExpiry: true, minStock: 1 });
      await item(accessToken, 'Tomate', 'KG', { minStock: 1 });
      await createActiveProductE2E(server, accessToken, 'Suco', 8);
      await entry(accessToken, branchId, milk.id, 2, 450, { lotCode: 'OLD', expiresAt: isoDay(-1) });
      await entry(accessToken, branchId, milk.id, 3, 450, { lotCode: 'NEW', expiresAt: isoDay(3) });

      const first = (await get(accessToken, `/v1/inventory/alerts?branchId=${branchId}`).expect(200)).body;
      expect(first.counts).toMatchObject({ OUT_OF_STOCK: 1, EXPIRED: 1, EXPIRING_SOON: 1, NO_RECIPE: 1 });
      expect(first.alerts[0].type).toBe('OUT_OF_STOCK');
      const expired = first.alerts.find((alert: { type: string }) => alert.type === 'EXPIRED');
      expect(expired).toMatchObject({ lotCode: 'OLD', quantity: 2, daysToExpiry: -1 });

      await exit(accessToken, branchId, milk.id, 3, 'CONSUMPTION').expect(201);
      const after = (await get(accessToken, `/v1/inventory/alerts?branchId=${branchId}`).expect(200)).body;
      expect(after.counts).toMatchObject({ EXPIRED: 0, EXPIRING_SOON: 1 });
      expect(after.alerts.find((alert: { type: string }) => alert.type === 'EXPIRING_SOON')).toMatchObject({
        lotCode: 'NEW',
        quantity: 2,
        daysToExpiry: 3,
      });
    });
  });

  describe('isolation and permissions', () => {
    it('tenant A cannot see, move, count, edit or use tenant B stock', async () => {
      const a = await burgerSetup();
      const b = await registerTenantE2E(server);

      await get(b.accessToken, `/v1/inventory/items/${a.meat.id}`).expect(404);
      await request(server).patch(`/v1/inventory/items/${a.meat.id}`).set(auth(b.accessToken)).send({ name: 'Invasor' }).expect(404);
      expect((await get(b.accessToken, '/v1/inventory/items').expect(200)).body).toHaveLength(0);

      await move(b.accessToken, { branchId: b.branchId, inventoryItemId: a.meat.id, type: 'ENTRY', quantity: 1, unitCostCents: 1 }).expect(404);
      await move(b.accessToken, { branchId: a.branchId, inventoryItemId: a.meat.id, type: 'ENTRY', quantity: 1, unitCostCents: 1 }).expect(404);
      await count(b.accessToken, { branchId: a.branchId, items: [{ inventoryItemId: a.meat.id, countedQuantity: 0 }] }).expect(404);
      await get(b.accessToken, `/v1/inventory/balances?branchId=${a.branchId}`).expect(404);
      await get(b.accessToken, `/v1/inventory/summary?branchId=${a.branchId}`).expect(404);
      await get(b.accessToken, `/v1/inventory/alerts?branchId=${a.branchId}`).expect(404);
      await get(b.accessToken, `/v1/inventory/movements?branchId=${a.branchId}`).expect(404);
      await get(b.accessToken, `/v1/inventory/recipes/${a.burger.id}`).expect(404);
      await putRecipe(b.accessToken, a.burger.id, []).expect(404);
      const own = await createActiveProductE2E(server, b.accessToken, 'Produto B', 10);
      await putRecipe(b.accessToken, own.id, [{ inventoryItemId: a.meat.id, quantity: 1 }]).expect(404);

      expect((await balanceOf(a.accessToken, a.branchId, a.meat.id)).quantity).toBe(2);
    });

    it('staff without access to a branch cannot operate its stock; balances are per branch', async () => {
      const { accessToken, tenantId, branchId } = await registerTenantE2E(server);
      const other = await getPrisma(app).branch.create({ data: { tenantId, name: 'Filial', code: 'FILIAL' } });
      const manager = await createStaffAndLoginE2E(app, server, tenantId, 'MANAGER', [branchId]);
      const flour = await item(accessToken, 'Farinha', 'KG');

      await entry(manager, branchId, flour.id, 5);
      const denied = await move(manager, { branchId: other.id, inventoryItemId: flour.id, type: 'ENTRY', quantity: 1, unitCostCents: 1 }).expect(403);
      expect(denied.body.code).toBe('BRANCH_ACCESS_DENIED');
      await count(manager, { branchId: other.id, items: [{ inventoryItemId: flour.id, countedQuantity: 1 }] }).expect(403);
      await get(manager, `/v1/inventory/summary?branchId=${other.id}`).expect(403);
      await request(server).patch('/v1/inventory/settings').set(auth(manager)).send({ branchId: other.id, allowNegativeStock: true }).expect(403);

      await entry(accessToken, other.id, flour.id, 1);
      expect((await balanceOf(accessToken, other.id, flour.id)).quantity).toBe(1);
      expect((await balanceOf(accessToken, branchId, flour.id)).quantity).toBe(5);
    });

    it('RBAC: CASHIER and KITCHEN read only, WAITER nothing, MANAGER manages everything', async () => {
      const { accessToken, tenantId, branchId } = await registerTenantE2E(server);
      const flour = await item(accessToken, 'Farinha', 'KG');
      const product = await createActiveProductE2E(server, accessToken, 'Pão de queijo', 5);
      const staff = (role: 'CASHIER' | 'KITCHEN' | 'WAITER' | 'MANAGER') =>
        createStaffAndLoginE2E(app, server, tenantId, role, [branchId]);

      for (const role of ['CASHIER', 'KITCHEN'] as const) {
        const token = await staff(role);
        await get(token, `/v1/inventory/balances?branchId=${branchId}`).expect(200);
        await get(token, `/v1/inventory/summary?branchId=${branchId}`).expect(200);
        await createItem(token, { name: 'X', unit: 'KG' }).expect(403);
        await move(token, { branchId, inventoryItemId: flour.id, type: 'ENTRY', quantity: 1, unitCostCents: 1 }).expect(403);
        await count(token, { branchId, items: [{ inventoryItemId: flour.id, countedQuantity: 1 }] }).expect(403);
        await putRecipe(token, product.id, []).expect(403);
        await request(server).patch('/v1/inventory/settings').set(auth(token)).send({ branchId, allowNegativeStock: true }).expect(403);
      }

      const waiter = await staff('WAITER');
      await get(waiter, `/v1/inventory/balances?branchId=${branchId}`).expect(403);

      const manager = await staff('MANAGER');
      await createItem(manager, { name: `Açúcar ${uniqueSuffix()}`, unit: 'KG' }).expect(201);
      await entry(manager, branchId, flour.id, 1);
      await count(manager, { branchId, items: [{ inventoryItemId: flour.id, countedQuantity: 0.5 }] }).expect(201);
      await putRecipe(manager, product.id, [{ inventoryItemId: flour.id, quantity: 50, unit: 'G' }]).expect(200);
    });
  });
});
