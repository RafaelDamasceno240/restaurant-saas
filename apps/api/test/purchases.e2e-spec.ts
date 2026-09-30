import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createStaffAndLoginE2E,
  createTestApp,
  getPrisma,
  registerTenantE2E,
  uniqueSuffix,
} from './test-app.util';

type Json = Record<string, unknown>;

describe('Purchases (e2e)', () => {
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
  const patch = (token: string, path: string, body: Json) => request(server).patch(path).set(auth(token)).send(body);

  const createSupplier = (token: string, name = `Fornecedor ${uniqueSuffix()}`) =>
    post(token, '/v1/suppliers', { name });
  const createItem = (token: string, extra: Json = {}) =>
    post(token, '/v1/inventory/items', { name: `Insumo ${uniqueSuffix()}`, unit: 'KG', ...extra });

  async function setup() {
    const tenant = await registerTenantE2E(server);
    const t = tenant.accessToken;
    const supplier = (await createSupplier(t).expect(201)).body as { id: string; name: string };
    const meat = (await createItem(t, { name: `Carne ${uniqueSuffix()}` }).expect(201)).body as { id: string };
    const cheese = (await createItem(t, { name: `Queijo ${uniqueSuffix()}`, tracksExpiry: true }).expect(201)).body as {
      id: string;
    };
    const flour = (await createItem(t, { name: `Farinha ${uniqueSuffix()}` }).expect(201)).body as { id: string };
    return { ...tenant, supplier, meat, cheese, flour };
  }

  type Ctx = Awaited<ReturnType<typeof setup>>;

  const draftBody = (ctx: Ctx, extra: Json = {}, items?: Json[]): Json => ({
    branchId: ctx.branchId,
    supplierId: ctx.supplier.id,
    purchaseDate: '2026-10-01',
    items: items ?? [{ inventoryItemId: ctx.meat.id, quantity: 12.5, unitCostCents: 3200 }],
    ...extra,
  });

  const createDraft = (ctx: Ctx, extra: Json = {}, items?: Json[]) =>
    post(ctx.accessToken, '/v1/purchases', draftBody(ctx, extra, items));

  async function balance(ctx: Ctx, itemId: string) {
    const res = await get(ctx.accessToken, `/v1/inventory/balances?branchId=${ctx.branchId}`).expect(200);
    return res.body.find((row: { id: string }) => row.id === itemId) as { quantity: number; averageCostCents: number };
  }

  describe('suppliers', () => {
    it('creates, lists, updates and deactivates a supplier', async () => {
      const { accessToken } = await registerTenantE2E(server);
      const created = await createSupplier(accessToken, 'Distribuidora Central').expect(201);
      expect(created.body).toMatchObject({ name: 'Distribuidora Central', active: true, document: null });

      await patch(accessToken, `/v1/suppliers/${created.body.id}`, { phone: '31999990000', email: 'contato@example.com' }).expect(200);
      const detail = await get(accessToken, `/v1/suppliers/${created.body.id}`).expect(200);
      expect(detail.body).toMatchObject({ phone: '31999990000', email: 'contato@example.com' });

      await patch(accessToken, `/v1/suppliers/${created.body.id}`, { email: '' }).expect(200);
      expect((await get(accessToken, `/v1/suppliers/${created.body.id}`).expect(200)).body.email).toBeNull();

      await patch(accessToken, `/v1/suppliers/${created.body.id}`, { active: false }).expect(200);
      const active = await get(accessToken, '/v1/suppliers').expect(200);
      expect(active.body.map((s: { id: string }) => s.id)).not.toContain(created.body.id);
      const all = await get(accessToken, '/v1/suppliers?includeInactive=true').expect(200);
      expect(all.body.map((s: { id: string }) => s.id)).toContain(created.body.id);
    });

    it('rejects a duplicated active name and invalid data', async () => {
      const { accessToken } = await registerTenantE2E(server);
      await createSupplier(accessToken, 'Mercado Bom').expect(201);
      const dup = await createSupplier(accessToken, 'mercado bom').expect(409);
      expect(dup.body.code).toBe('SUPPLIER_ALREADY_EXISTS');
      await post(accessToken, '/v1/suppliers', { name: 'A' }).expect(400);
      await post(accessToken, '/v1/suppliers', { name: 'Valido', email: 'not-an-email' }).expect(400);
    });

    it('isolates suppliers between tenants', async () => {
      const a = await registerTenantE2E(server);
      const b = await registerTenantE2E(server);
      const supplier = (await createSupplier(a.accessToken).expect(201)).body;
      await get(b.accessToken, `/v1/suppliers/${supplier.id}`).expect(404);
      await patch(b.accessToken, `/v1/suppliers/${supplier.id}`, { name: 'Invadido' }).expect(404);
      const list = await get(b.accessToken, '/v1/suppliers?includeInactive=true').expect(200);
      expect(list.body).toHaveLength(0);
    });
  });

  describe('draft purchases', () => {
    it('creates a draft with totals calculated by the backend and no stock effect', async () => {
      const ctx = await setup();
      const res = await createDraft(ctx, { discountCents: 500, freightCents: 1500, otherCostsCents: 250 }, [
        { inventoryItemId: ctx.meat.id, quantity: 12.5, unitCostCents: 3200, lotCode: 'L-1' },
        { inventoryItemId: ctx.flour.id, quantity: 2, unitCostCents: 899 },
      ]).expect(201);

      expect(res.body).toMatchObject({
        status: 'DRAFT',
        purchaseNumber: 'COMP-000001',
        subtotalCents: 40000 + 1798,
        totalCents: 40000 + 1798 - 500 + 1500 + 250,
        discountCents: 500,
        freightCents: 1500,
        otherCostsCents: 250,
        receivedAt: null,
      });
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items.find((i: { lotCode: string | null }) => i.lotCode === 'L-1')).toMatchObject({
        quantity: 12.5,
        unitCostCents: 3200,
        totalCostCents: 40000,
      });
      expect(res.body.events.map((e: { action: string }) => e.action)).toEqual(['PURCHASE_CREATED']);
      expect((await balance(ctx, ctx.meat.id)).quantity).toBe(0);
      expect(await getPrisma(app).stockMovement.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
    });

    it('rejects totals sent by the client instead of trusting them', async () => {
      const ctx = await setup();
      await createDraft(ctx, { totalCents: 1, subtotalCents: 1 }).expect(400);
      await createDraft(ctx, {}, [
        { inventoryItemId: ctx.meat.id, quantity: 1, unitCostCents: 1000, totalCostCents: 1 },
      ]).expect(400);
      expect(await getPrisma(app).purchase.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
    });

    it('numbers purchases sequentially per tenant', async () => {
      const a = await setup();
      const b = await setup();
      const a1 = await createDraft(a).expect(201);
      const a2 = await createDraft(a).expect(201);
      const b1 = await createDraft(b).expect(201);
      expect([a1.body.purchaseNumber, a2.body.purchaseNumber, b1.body.purchaseNumber]).toEqual([
        'COMP-000001',
        'COMP-000002',
        'COMP-000001',
      ]);
    });

    it('lists purchases with filters, pagination and totals per status', async () => {
      const ctx = await setup();
      const other = (await createSupplier(ctx.accessToken).expect(201)).body;
      const first = (await createDraft(ctx, { purchaseDate: '2026-09-10' }).expect(201)).body;
      await createDraft(ctx, { purchaseDate: '2026-10-05', supplierId: other.id }).expect(201);
      const received = (await createDraft(ctx, { purchaseDate: '2026-10-20' }).expect(201)).body;
      await post(ctx.accessToken, `/v1/purchases/${received.id}/receive`).expect(200);

      const all = await get(ctx.accessToken, `/v1/purchases?branchId=${ctx.branchId}`).expect(200);
      expect(all.body.meta.total).toBe(3);
      expect(all.body.summary.DRAFT.count).toBe(2);
      expect(all.body.summary.RECEIVED).toEqual({ count: 1, totalCents: 40000 });
      expect(all.body.data[0]).toMatchObject({ itemCount: 1, supplier: { id: ctx.supplier.id } });
      expect(all.body.data.map((p: { id: string }) => p.id)[0]).toBe(received.id);

      const byStatus = await get(ctx.accessToken, `/v1/purchases?branchId=${ctx.branchId}&status=RECEIVED`).expect(200);
      expect(byStatus.body.data).toHaveLength(1);
      expect(byStatus.body.summary.DRAFT.count).toBe(2);

      const bySupplier = await get(ctx.accessToken, `/v1/purchases?branchId=${ctx.branchId}&supplierId=${other.id}`).expect(200);
      expect(bySupplier.body.meta.total).toBe(1);

      const byDate = await get(
        ctx.accessToken,
        `/v1/purchases?branchId=${ctx.branchId}&dateFrom=2026-10-01&dateTo=2026-10-31`,
      ).expect(200);
      expect(byDate.body.meta.total).toBe(2);
      expect(byDate.body.data.map((p: { id: string }) => p.id)).not.toContain(first.id);

      const paged = await get(ctx.accessToken, `/v1/purchases?branchId=${ctx.branchId}&page=2&pageSize=2`).expect(200);
      expect(paged.body.data).toHaveLength(1);
      expect(paged.body.meta).toMatchObject({ page: 2, pageSize: 2, total: 3, totalPages: 2 });
    });

    it('edits a draft and recalculates the totals', async () => {
      const ctx = await setup();
      const draft = (await createDraft(ctx).expect(201)).body;
      const edited = await patch(ctx.accessToken, `/v1/purchases/${draft.id}`, {
        freightCents: 1000,
        notes: 'Entrega na doca',
        items: [
          { inventoryItemId: ctx.meat.id, quantity: 10, unitCostCents: 3000 },
          { inventoryItemId: ctx.flour.id, quantity: 5, unitCostCents: 400, lotCode: 'F-9' },
        ],
      }).expect(200);
      expect(edited.body).toMatchObject({ subtotalCents: 32000, totalCents: 33000, notes: 'Entrega na doca' });
      expect(edited.body.items).toHaveLength(2);
      expect(edited.body.events.map((e: { action: string }) => e.action)).toEqual(['PURCHASE_CREATED', 'PURCHASE_UPDATED']);

      const onlyCosts = await patch(ctx.accessToken, `/v1/purchases/${draft.id}`, { discountCents: 2000 }).expect(200);
      expect(onlyCosts.body.totalCents).toBe(31000);
      expect(onlyCosts.body.items).toHaveLength(2);
    });

    it('cancels a draft without touching stock, and cancelling twice is a replay', async () => {
      const ctx = await setup();
      const draft = (await createDraft(ctx).expect(201)).body;
      const cancelled = await post(ctx.accessToken, `/v1/purchases/${draft.id}/cancel`).expect(200);
      expect(cancelled.body).toMatchObject({ status: 'CANCELLED', idempotentReplay: false });
      const again = await post(ctx.accessToken, `/v1/purchases/${draft.id}/cancel`).expect(200);
      expect(again.body.idempotentReplay).toBe(true);
      expect(await getPrisma(app).stockMovement.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      await post(ctx.accessToken, `/v1/purchases/${draft.id}/receive`).expect(409);
      await patch(ctx.accessToken, `/v1/purchases/${draft.id}`, { notes: 'x' }).expect(409);
    });
  });

  describe('receiving', () => {
    it('creates one ENTRY per line with cost, lot, expiry, supplier and document, and updates the balance', async () => {
      const ctx = await setup();
      const draft = (
        await createDraft(ctx, {}, [
          { inventoryItemId: ctx.meat.id, quantity: 12.5, unitCostCents: 3200, lotCode: 'CARNE-1' },
          { inventoryItemId: ctx.cheese.id, quantity: 4, unitCostCents: 5000, lotCode: 'QJ-7', expiresAt: '2026-12-31' },
        ]).expect(201)
      ).body;

      const received = await post(ctx.accessToken, `/v1/purchases/${draft.id}/receive`).expect(200);
      expect(received.body).toMatchObject({ status: 'RECEIVED', idempotentReplay: false });
      expect(received.body.receivedAt).toBeTruthy();
      expect(received.body.receivedBy).toBeTruthy();

      expect(await balance(ctx, ctx.meat.id)).toMatchObject({ quantity: 12.5, averageCostCents: 3200 });
      expect(await balance(ctx, ctx.cheese.id)).toMatchObject({ quantity: 4, averageCostCents: 5000 });

      const movements = await getPrisma(app).stockMovement.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { inventoryItemId: 'asc' },
      });
      expect(movements).toHaveLength(2);
      for (const movement of movements) {
        expect(movement).toMatchObject({
          type: 'ENTRY',
          origin: 'PURCHASE',
          referenceType: 'PURCHASE',
          supplierName: ctx.supplier.name,
          documentNumber: draft.purchaseNumber,
          branchId: ctx.branchId,
        });
      }
      const cheeseMovement = movements.find((m) => m.inventoryItemId === ctx.cheese.id)!;
      expect(cheeseMovement.lotCode).toBe('QJ-7');
      expect(cheeseMovement.expiresAt?.toISOString().slice(0, 10)).toBe('2026-12-31');
      expect(cheeseMovement.unitCostCents).toBe(5000);

      const actions = received.body.events.map((e: { action: string }) => e.action);
      expect(actions).toEqual(['PURCHASE_CREATED', 'PURCHASE_RECEIVED']);
    });

    it('is idempotent: receiving twice does not add stock again', async () => {
      const ctx = await setup();
      const draft = (await createDraft(ctx).expect(201)).body;
      await post(ctx.accessToken, `/v1/purchases/${draft.id}/receive`).expect(200);
      const again = await post(ctx.accessToken, `/v1/purchases/${draft.id}/receive`).expect(200);
      expect(again.body).toMatchObject({ status: 'RECEIVED', idempotentReplay: true });
      expect((await balance(ctx, ctx.meat.id)).quantity).toBe(12.5);
      expect(await getPrisma(app).stockMovement.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
      expect(
        await getPrisma(app).auditLog.count({ where: { tenantId: ctx.tenantId, action: 'PURCHASE_RECEIVED' } }),
      ).toBe(1);
    });

    it('handles concurrent receives of the same purchase with a single effective entry', async () => {
      const ctx = await setup();
      const draft = (
        await createDraft(ctx, {}, [
          { inventoryItemId: ctx.meat.id, quantity: 5, unitCostCents: 1000 },
          { inventoryItemId: ctx.flour.id, quantity: 3, unitCostCents: 200 },
        ]).expect(201)
      ).body;

      const results = await Promise.all(
        [1, 2, 3, 4, 5].map(() => post(ctx.accessToken, `/v1/purchases/${draft.id}/receive`)),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
      expect(results.filter((r) => r.body.idempotentReplay === false)).toHaveLength(1);
      expect((await balance(ctx, ctx.meat.id)).quantity).toBe(5);
      expect((await balance(ctx, ctx.flour.id)).quantity).toBe(3);
      expect(await getPrisma(app).stockMovement.count({ where: { tenantId: ctx.tenantId } })).toBe(2);
    });

    it('keeps the balance and average cost correct when two purchases of the same item are received at once', async () => {
      const ctx = await setup();
      const a = (await createDraft(ctx, {}, [{ inventoryItemId: ctx.meat.id, quantity: 10, unitCostCents: 1000 }]).expect(201)).body;
      const b = (await createDraft(ctx, {}, [{ inventoryItemId: ctx.meat.id, quantity: 30, unitCostCents: 2000 }]).expect(201)).body;

      const results = await Promise.all([
        post(ctx.accessToken, `/v1/purchases/${a.id}/receive`),
        post(ctx.accessToken, `/v1/purchases/${b.id}/receive`),
      ]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      expect(await balance(ctx, ctx.meat.id)).toMatchObject({ quantity: 40, averageCostCents: 1750 });
    });

    it('refuses to receive an item that controls expiry without a date and leaves everything untouched', async () => {
      const ctx = await setup();
      const draft = (
        await createDraft(ctx, {}, [
          { inventoryItemId: ctx.meat.id, quantity: 5, unitCostCents: 1000 },
          { inventoryItemId: ctx.cheese.id, quantity: 2, unitCostCents: 5000 },
        ]).expect(201)
      ).body;
      const res = await post(ctx.accessToken, `/v1/purchases/${draft.id}/receive`).expect(400);
      expect(res.body.code).toBe('EXPIRY_REQUIRED');
      expect((await get(ctx.accessToken, `/v1/purchases/${draft.id}`).expect(200)).body.status).toBe('DRAFT');
      expect((await balance(ctx, ctx.meat.id)).quantity).toBe(0);
      expect(await getPrisma(app).stockMovement.count({ where: { tenantId: ctx.tenantId } })).toBe(0);

      await patch(ctx.accessToken, `/v1/purchases/${draft.id}`, {
        items: [
          { inventoryItemId: ctx.meat.id, quantity: 5, unitCostCents: 1000 },
          { inventoryItemId: ctx.cheese.id, quantity: 2, unitCostCents: 5000, expiresAt: '2027-01-15' },
        ],
      }).expect(200);
      await post(ctx.accessToken, `/v1/purchases/${draft.id}/receive`).expect(200);
      expect((await balance(ctx, ctx.cheese.id)).quantity).toBe(2);
    });

    it('creates and receives in one transaction with receiveNow, or creates nothing when it fails', async () => {
      const ctx = await setup();
      const ok = await createDraft(ctx, { receiveNow: true }).expect(201);
      expect(ok.body).toMatchObject({ status: 'RECEIVED', purchaseNumber: 'COMP-000001' });
      expect((await balance(ctx, ctx.meat.id)).quantity).toBe(12.5);

      const failing = await createDraft(ctx, { receiveNow: true }, [
        { inventoryItemId: ctx.cheese.id, quantity: 1, unitCostCents: 5000 },
      ]).expect(400);
      expect(failing.body.code).toBe('EXPIRY_REQUIRED');
      expect(await getPrisma(app).purchase.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
      const next = await createDraft(ctx).expect(201);
      expect(next.body.purchaseNumber).toBe('COMP-000002');
    });

    it('does not allow editing a received purchase', async () => {
      const ctx = await setup();
      const draft = (await createDraft(ctx).expect(201)).body;
      await post(ctx.accessToken, `/v1/purchases/${draft.id}/receive`).expect(200);
      const res = await patch(ctx.accessToken, `/v1/purchases/${draft.id}`, { notes: 'depois' }).expect(409);
      expect(res.body.code).toBe('PURCHASE_NOT_EDITABLE');
    });
  });

  describe('cancelling a received purchase', () => {
    it('requires a reason, reverses the stock through the ledger and is idempotent', async () => {
      const ctx = await setup();
      const draft = (await createDraft(ctx).expect(201)).body;
      await post(ctx.accessToken, `/v1/purchases/${draft.id}/receive`).expect(200);

      const noReason = await post(ctx.accessToken, `/v1/purchases/${draft.id}/cancel`).expect(400);
      expect(noReason.body.code).toBe('CANCEL_REASON_REQUIRED');
      expect((await balance(ctx, ctx.meat.id)).quantity).toBe(12.5);

      const cancelled = await post(ctx.accessToken, `/v1/purchases/${draft.id}/cancel`, { reason: 'Nota lançada errada' }).expect(200);
      expect(cancelled.body).toMatchObject({ status: 'CANCELLED', cancelReason: 'Nota lançada errada', idempotentReplay: false });
      expect((await balance(ctx, ctx.meat.id)).quantity).toBe(0);

      const movements = await getPrisma(app).stockMovement.findMany({
        where: { tenantId: ctx.tenantId },
        orderBy: { createdAt: 'asc' },
      });
      expect(movements.map((m) => `${m.type}:${m.origin}:${m.quantity.toString()}`)).toEqual([
        'ENTRY:PURCHASE:12.5',
        'REVERSAL:REVERSAL:-12.5',
      ]);
      expect(movements[1].referenceType).toBe('PURCHASE');

      const again = await post(ctx.accessToken, `/v1/purchases/${draft.id}/cancel`, { reason: 'de novo' }).expect(200);
      expect(again.body.idempotentReplay).toBe(true);
      expect(await getPrisma(app).stockMovement.count({ where: { tenantId: ctx.tenantId } })).toBe(2);
      const actions = again.body.events.map((e: { action: string }) => e.action);
      expect(actions).toEqual(['PURCHASE_CREATED', 'PURCHASE_RECEIVED', 'PURCHASE_CANCELLED']);
      expect(again.body.events[2].reason).toBe('Nota lançada errada');
    });

    it('blocks the reversal when the stock was already consumed and keeps the purchase received', async () => {
      const ctx = await setup();
      const draft = (await createDraft(ctx).expect(201)).body;
      await post(ctx.accessToken, `/v1/purchases/${draft.id}/receive`).expect(200);
      await post(ctx.accessToken, '/v1/inventory/movements', {
        branchId: ctx.branchId,
        inventoryItemId: ctx.meat.id,
        type: 'EXIT',
        quantity: 10,
        exitReason: 'CONSUMPTION',
      }).expect(201);

      const res = await post(ctx.accessToken, `/v1/purchases/${draft.id}/cancel`, { reason: 'Devolução ao fornecedor' }).expect(409);
      expect(res.body.code).toBe('INSUFFICIENT_STOCK');
      expect((await get(ctx.accessToken, `/v1/purchases/${draft.id}`).expect(200)).body.status).toBe('RECEIVED');
      expect((await balance(ctx, ctx.meat.id)).quantity).toBe(2.5);
      expect(await getPrisma(app).stockMovement.count({ where: { tenantId: ctx.tenantId, type: 'REVERSAL' } })).toBe(0);
    });

    it('handles concurrent cancellations with a single reversal', async () => {
      const ctx = await setup();
      const draft = (await createDraft(ctx, { receiveNow: true }).expect(201)).body;
      const results = await Promise.all(
        [1, 2, 3].map(() => post(ctx.accessToken, `/v1/purchases/${draft.id}/cancel`, { reason: 'Cancelamento' })),
      );
      expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
      expect(results.filter((r) => r.body.idempotentReplay === false)).toHaveLength(1);
      expect((await balance(ctx, ctx.meat.id)).quantity).toBe(0);
      expect(await getPrisma(app).stockMovement.count({ where: { tenantId: ctx.tenantId, type: 'REVERSAL' } })).toBe(1);
    });
  });

  describe('validation', () => {
    it('rejects invalid quantities and costs', async () => {
      const ctx = await setup();
      const bad = (item: Json) => createDraft(ctx, {}, [{ inventoryItemId: ctx.meat.id, quantity: 1, unitCostCents: 100, ...item }]);
      await bad({ quantity: 0 }).expect(400);
      await bad({ quantity: -2 }).expect(400);
      await bad({ quantity: 1.2345 }).expect(400);
      await bad({ unitCostCents: -1 }).expect(400);
      await bad({ unitCostCents: 10.5 }).expect(400);
      await bad({ inventoryItemId: 'not-a-uuid' }).expect(400);
      await bad({ expiresAt: 'ontem' }).expect(400);
      await createDraft(ctx, {}, []).expect(400);
      await createDraft(ctx, { discountCents: -5 }).expect(400);
      await createDraft(ctx, { freightCents: 1.5 }).expect(400);
      const excessive = await createDraft(ctx, { discountCents: 999_999 }).expect(400);
      expect(excessive.body.code).toBe('INVALID_PURCHASE_TOTAL');
      expect(await getPrisma(app).purchase.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
    });

    it('accepts a zero cost item', async () => {
      const ctx = await setup();
      const res = await createDraft(ctx, {}, [{ inventoryItemId: ctx.meat.id, quantity: 3, unitCostCents: 0 }]).expect(201);
      expect(res.body.totalCents).toBe(0);
    });

    it('rejects suppliers and items that are inactive or from another tenant', async () => {
      const ctx = await setup();
      const other = await setup();

      const foreignSupplier = await createDraft(ctx, { supplierId: other.supplier.id }).expect(404);
      expect(foreignSupplier.body.code).toBe('SUPPLIER_NOT_FOUND');
      const foreignItem = await createDraft(ctx, {}, [
        { inventoryItemId: other.meat.id, quantity: 1, unitCostCents: 100 },
      ]).expect(404);
      expect(foreignItem.body.code).toBe('INVENTORY_ITEM_NOT_FOUND');

      await patch(ctx.accessToken, `/v1/suppliers/${ctx.supplier.id}`, { active: false }).expect(200);
      const inactiveSupplier = await createDraft(ctx).expect(409);
      expect(inactiveSupplier.body.code).toBe('SUPPLIER_INACTIVE');

      const supplier2 = (await createSupplier(ctx.accessToken).expect(201)).body;
      await patch(ctx.accessToken, `/v1/inventory/items/${ctx.flour.id}`, { active: false }).expect(200);
      const inactiveItem = await createDraft(ctx, { supplierId: supplier2.id }, [
        { inventoryItemId: ctx.flour.id, quantity: 1, unitCostCents: 100 },
      ]).expect(409);
      expect(inactiveItem.body.code).toBe('INVENTORY_ITEM_INACTIVE');
    });

    it('keeps the history of a purchase whose supplier was deactivated later', async () => {
      const ctx = await setup();
      const draft = (await createDraft(ctx).expect(201)).body;
      await patch(ctx.accessToken, `/v1/suppliers/${ctx.supplier.id}`, { active: false }).expect(200);
      const detail = await get(ctx.accessToken, `/v1/purchases/${draft.id}`).expect(200);
      expect(detail.body.supplier).toMatchObject({ id: ctx.supplier.id, name: ctx.supplier.name });
    });
  });

  describe('tenant and branch isolation', () => {
    it('never exposes or changes purchases of another tenant', async () => {
      const a = await setup();
      const b = await setup();
      const draft = (await createDraft(a).expect(201)).body;

      await get(b.accessToken, `/v1/purchases/${draft.id}`).expect(404);
      await patch(b.accessToken, `/v1/purchases/${draft.id}`, { notes: 'x' }).expect(404);
      await post(b.accessToken, `/v1/purchases/${draft.id}/receive`).expect(404);
      await post(b.accessToken, `/v1/purchases/${draft.id}/cancel`).expect(404);
      await get(b.accessToken, `/v1/purchases?branchId=${a.branchId}`).expect(404);

      const own = await get(b.accessToken, `/v1/purchases?branchId=${b.branchId}`).expect(200);
      expect(own.body.data).toHaveLength(0);
      expect((await get(a.accessToken, `/v1/purchases/${draft.id}`).expect(200)).body.status).toBe('DRAFT');
    });

    it('scopes purchases to the branches the user can operate', async () => {
      const ctx = await setup();
      const branchB = await getPrisma(app).branch.create({
        data: { tenantId: ctx.tenantId, name: 'Filial', code: 'FILIAL' },
      });
      const manager = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'MANAGER', [ctx.branchId]);
      const inA = (await createDraft(ctx).expect(201)).body;
      const inB = (await createDraft(ctx, { branchId: branchB.id }).expect(201)).body;

      await get(manager, `/v1/purchases/${inA.id}`).expect(200);
      await get(manager, `/v1/purchases/${inB.id}`).expect(404);
      await get(manager, `/v1/purchases?branchId=${branchB.id}`).expect(403);
      await post(manager, `/v1/purchases/${inB.id}/receive`).expect(404);
      await post(manager, `/v1/purchases/${inB.id}/cancel`).expect(404);
      await patch(manager, `/v1/purchases/${inB.id}`, { notes: 'x' }).expect(404);
      await post(manager, '/v1/purchases', { ...draftBody(ctx), branchId: branchB.id }).expect(403);

      await post(manager, `/v1/purchases/${inA.id}/receive`).expect(200);
      expect((await get(ctx.accessToken, `/v1/purchases/${inB.id}`).expect(200)).body.status).toBe('DRAFT');
    });

    it('keeps balances of different branches apart', async () => {
      const ctx = await setup();
      const branchB = await getPrisma(app).branch.create({
        data: { tenantId: ctx.tenantId, name: 'Filial', code: 'FILIAL' },
      });
      const inB = (await createDraft(ctx, { branchId: branchB.id }).expect(201)).body;
      await post(ctx.accessToken, `/v1/purchases/${inB.id}/receive`).expect(200);
      expect((await balance(ctx, ctx.meat.id)).quantity).toBe(0);
      const inBBalance = await getPrisma(app).inventoryBalance.findFirstOrThrow({
        where: { branchId: branchB.id, inventoryItemId: ctx.meat.id },
      });
      expect(Number(inBBalance.quantity)).toBe(12.5);
    });
  });

  describe('permissions', () => {
    it('grants purchasing to managers only, and denies operational roles', async () => {
      const ctx = await setup();
      const draft = (await createDraft(ctx).expect(201)).body;
      const manager = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'MANAGER', [ctx.branchId]);

      await get(manager, `/v1/purchases?branchId=${ctx.branchId}`).expect(200);
      await get(manager, '/v1/suppliers').expect(200);
      await post(manager, '/v1/suppliers', { name: `Do gerente ${uniqueSuffix()}` }).expect(201);

      for (const role of ['CASHIER', 'KITCHEN', 'WAITER', 'VIEWER', 'DELIVERY'] as const) {
        const token = await createStaffAndLoginE2E(app, server, ctx.tenantId, role, [ctx.branchId]);
        await get(token, `/v1/purchases?branchId=${ctx.branchId}`).expect(403);
        await get(token, `/v1/purchases/${draft.id}`).expect(403);
        await post(token, '/v1/purchases', draftBody(ctx)).expect(403);
        await patch(token, `/v1/purchases/${draft.id}`, { notes: 'x' }).expect(403);
        await post(token, `/v1/purchases/${draft.id}/receive`).expect(403);
        await post(token, `/v1/purchases/${draft.id}/cancel`).expect(403);
        await get(token, '/v1/suppliers').expect(403);
        await post(token, '/v1/suppliers', { name: 'Nao pode' }).expect(403);
      }
      await request(server).get('/v1/purchases').expect(401);
    });

    it('requires the receive permission for receiveNow', async () => {
      const ctx = await setup();
      const prisma = getPrisma(app);
      const manager = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'MANAGER', [ctx.branchId]);
      const receive = await prisma.permission.findUniqueOrThrow({ where: { key: 'purchases.receive' } });
      const role = await prisma.role.findUniqueOrThrow({ where: { name: 'MANAGER' } });
      await prisma.rolePermission.delete({
        where: { roleId_permissionId: { roleId: role.id, permissionId: receive.id } },
      });
      try {
        const limited = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'MANAGER', [ctx.branchId]);
        await post(limited, '/v1/purchases', { ...draftBody(ctx), receiveNow: true }).expect(403);
        await post(limited, '/v1/purchases', draftBody(ctx)).expect(201);
        expect(await getPrisma(app).stockMovement.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      } finally {
        await prisma.rolePermission.create({ data: { roleId: role.id, permissionId: receive.id } });
      }
      await post(manager, '/v1/purchases', { ...draftBody(ctx), receiveNow: true }).expect(201);
    });
  });

  describe('audit', () => {
    it('records created, updated, received and cancelled events with the acting user', async () => {
      const ctx = await setup();
      const draft = (await createDraft(ctx).expect(201)).body;
      await patch(ctx.accessToken, `/v1/purchases/${draft.id}`, { notes: 'ajuste' }).expect(200);
      await post(ctx.accessToken, `/v1/purchases/${draft.id}/receive`).expect(200);
      await post(ctx.accessToken, `/v1/purchases/${draft.id}/cancel`, { reason: 'Erro de digitação' }).expect(200);

      const logs = await getPrisma(app).auditLog.findMany({
        where: { tenantId: ctx.tenantId, entity: 'Purchase', entityId: draft.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(logs.map((l) => l.action)).toEqual([
        'PURCHASE_CREATED',
        'PURCHASE_UPDATED',
        'PURCHASE_RECEIVED',
        'PURCHASE_CANCELLED',
      ]);
      expect(logs.every((l) => l.userId !== null)).toBe(true);
      expect(logs[2].afterData).toMatchObject({ branchId: ctx.branchId, itemCount: 1 });
    });
  });
});
