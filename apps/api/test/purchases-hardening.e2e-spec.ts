import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  getPrisma,
  registerTenantE2E,
  uniqueSuffix,
} from './test-app.util';

type Json = Record<string, unknown>;

describe('Purchases hardening (e2e)', () => {
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

  describe('amount limits (P-01)', () => {
    const MAX = 2_147_483_647;

    async function untouched(ctx: Ctx, extraItemId?: string) {
      const prisma = getPrisma(app);
      expect(await prisma.purchase.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect(await prisma.purchaseItem.count({ where: { purchase: { tenantId: ctx.tenantId } } })).toBe(0);
      expect(await prisma.stockMovement.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect(await prisma.purchaseSequence.findUnique({ where: { tenantId: ctx.tenantId } })).toBeNull();
      expect((await balance(ctx, extraItemId ?? ctx.meat.id)).quantity).toBe(0);
    }

    it('answers 400 (not 500) for the DTO maximum and leaves nothing behind, with and without receiveNow', async () => {
      const ctx = await setup();
      const items = [{ inventoryItemId: ctx.meat.id, quantity: 1_000_000, unitCostCents: 100_000_000 }];
      for (const receiveNow of [false, true]) {
        const res = await createDraft(ctx, { receiveNow }, items).expect(400);
        expect(res.body.code).toBe('PURCHASE_AMOUNT_TOO_LARGE');
        expect(res.body.details).toMatchObject({ field: 'line' });
      }
      await untouched(ctx);
    });

    it('accepts a line of 2_147_000_000 and rejects 2_148_000_000', async () => {
      const ctx = await setup();
      const ok = await createDraft(ctx, {}, [{ inventoryItemId: ctx.meat.id, quantity: 1_000_000, unitCostCents: 2147 }]).expect(201);
      expect(ok.body.totalCents).toBe(2_147_000_000);
      const bad = await createDraft(ctx, {}, [{ inventoryItemId: ctx.meat.id, quantity: 1_000_000, unitCostCents: 2148 }]).expect(400);
      expect(bad.body).toMatchObject({ code: 'PURCHASE_AMOUNT_TOO_LARGE', details: { field: 'line' } });
      expect(await getPrisma(app).purchase.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
      expect((await getPrisma(app).purchaseSequence.findUniqueOrThrow({ where: { tenantId: ctx.tenantId } })).lastNumber).toBe(1);
    });

    it('accepts a subtotal of exactly 2_147_483_647 and rejects 2_147_483_648 without consuming a number', async () => {
      const ctx = await setup();
      const lines = (lastCost: number) => [
        ...Array.from({ length: 21 }, () => ({ inventoryItemId: ctx.meat.id, quantity: 1, unitCostCents: 100_000_000 })),
        { inventoryItemId: ctx.flour.id, quantity: 1, unitCostCents: lastCost },
      ];
      const bad = await createDraft(ctx, {}, lines(47_483_648)).expect(400);
      expect(bad.body).toMatchObject({ code: 'PURCHASE_AMOUNT_TOO_LARGE', details: { field: 'subtotal' } });
      await untouched(ctx, ctx.flour.id);

      const ok = await createDraft(ctx, {}, lines(47_483_647)).expect(201);
      expect(ok.body.subtotalCents).toBe(MAX);
      expect(ok.body.totalCents).toBe(MAX);
      expect(ok.body.purchaseNumber).toBe('COMP-000001');
    });

    it('rejects a total above the limit reached through freight, accepts exactly the limit', async () => {
      const ctx = await setup();
      const items = [{ inventoryItemId: ctx.meat.id, quantity: 1_000_000, unitCostCents: 2000 }];
      const bad = await createDraft(ctx, { freightCents: 147_483_648 }, items).expect(400);
      expect(bad.body).toMatchObject({ code: 'PURCHASE_AMOUNT_TOO_LARGE', details: { field: 'total' } });
      await untouched(ctx);
      const ok = await createDraft(ctx, { freightCents: 147_483_647 }, items).expect(201);
      expect(ok.body.totalCents).toBe(MAX);
    });

    it('applies the same limits when editing a draft and keeps the draft untouched on failure', async () => {
      const ctx = await setup();
      const draft = (await createDraft(ctx).expect(201)).body;
      const res = await patch(ctx.accessToken, `/v1/purchases/${draft.id}`, {
        items: [{ inventoryItemId: ctx.meat.id, quantity: 1_000_000, unitCostCents: 100_000_000 }],
      }).expect(400);
      expect(res.body.code).toBe('PURCHASE_AMOUNT_TOO_LARGE');
      const after = (await get(ctx.accessToken, `/v1/purchases/${draft.id}`).expect(200)).body;
      expect(after.totalCents).toBe(draft.totalCents);
      expect(after.items).toHaveLength(1);
      expect(after.items[0].quantity).toBe(12.5);

      const freight = await patch(ctx.accessToken, `/v1/purchases/${draft.id}`, { freightCents: 1_000_000_000 });
      expect(freight.status).toBe(200);
      const tooMuch = await patch(ctx.accessToken, `/v1/purchases/${draft.id}`, {
        items: [{ inventoryItemId: ctx.meat.id, quantity: 1_000_000, unitCostCents: 1148 }],
      }).expect(400);
      expect(tooMuch.body.details).toMatchObject({ field: 'total' });
    });
  });

  describe('audit is part of the transaction (P-02)', () => {
    // A real database trigger makes the audit INSERT fail for one tenant+action,
    // so the test proves rollback without mocking any service.
    const failAudit = async (tenantId: string, action: string) => {
      const prisma = getPrisma(app);
      await prisma.$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION fail_audit_for_test() RETURNS trigger LANGUAGE plpgsql AS $fn$
         BEGIN
           IF NEW."tenantId" = '${tenantId}' AND NEW."action" = '${action}' THEN
             RAISE EXCEPTION 'audit failure injected by test';
           END IF;
           RETURN NEW;
         END $fn$`,
      );
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_audit_for_test ON audit_logs`);
      await prisma.$executeRawUnsafe(
        `CREATE TRIGGER fail_audit_for_test BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_audit_for_test()`,
      );
    };
    const restoreAudit = async () => {
      const prisma = getPrisma(app);
      await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_audit_for_test ON audit_logs`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS fail_audit_for_test()`);
    };
    afterEach(restoreAudit);

    it('rolls back the whole receive (status, stock and movements) when the audit insert fails', async () => {
      const ctx = await setup();
      const draft = (await createDraft(ctx).expect(201)).body;
      await failAudit(ctx.tenantId, 'PURCHASE_RECEIVED');

      await post(ctx.accessToken, `/v1/purchases/${draft.id}/receive`).expect(500);
      const prisma = getPrisma(app);
      expect((await prisma.purchase.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('DRAFT');
      expect(await prisma.stockMovement.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect((await balance(ctx, ctx.meat.id)).quantity).toBe(0);
      expect(await prisma.auditLog.count({ where: { tenantId: ctx.tenantId, action: 'PURCHASE_RECEIVED' } })).toBe(0);

      await restoreAudit();
      const ok = await post(ctx.accessToken, `/v1/purchases/${draft.id}/receive`).expect(200);
      expect(ok.body).toMatchObject({ status: 'RECEIVED', idempotentReplay: false });
      expect(await prisma.stockMovement.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
      expect(await prisma.auditLog.count({ where: { tenantId: ctx.tenantId, action: 'PURCHASE_RECEIVED' } })).toBe(1);
    });

    it('creates nothing (purchase, number, stock, audit) when receiveNow cannot write its audit', async () => {
      const ctx = await setup();
      await failAudit(ctx.tenantId, 'PURCHASE_RECEIVED');
      await createDraft(ctx, { receiveNow: true }).expect(500);
      const prisma = getPrisma(app);
      expect(await prisma.purchase.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect(await prisma.purchaseSequence.findUnique({ where: { tenantId: ctx.tenantId } })).toBeNull();
      expect(await prisma.stockMovement.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect(await prisma.auditLog.count({ where: { tenantId: ctx.tenantId, entity: 'Purchase' } })).toBe(0);
      expect((await balance(ctx, ctx.meat.id)).quantity).toBe(0);
    });

    it('creates nothing when the creation audit fails', async () => {
      const ctx = await setup();
      await failAudit(ctx.tenantId, 'PURCHASE_CREATED');
      await createDraft(ctx).expect(500);
      const prisma = getPrisma(app);
      expect(await prisma.purchase.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      expect(await prisma.purchaseItem.count({ where: { purchase: { tenantId: ctx.tenantId } } })).toBe(0);
      expect(await prisma.purchaseSequence.findUnique({ where: { tenantId: ctx.tenantId } })).toBeNull();
    });

    it('leaves the draft unchanged when the update audit fails', async () => {
      const ctx = await setup();
      const draft = (await createDraft(ctx).expect(201)).body;
      await failAudit(ctx.tenantId, 'PURCHASE_UPDATED');
      await patch(ctx.accessToken, `/v1/purchases/${draft.id}`, {
        notes: 'nova observação',
        items: [{ inventoryItemId: ctx.flour.id, quantity: 3, unitCostCents: 100 }],
      }).expect(500);
      const after = (await get(ctx.accessToken, `/v1/purchases/${draft.id}`).expect(200)).body;
      expect(after.notes).toBeNull();
      expect(after.totalCents).toBe(draft.totalCents);
      expect(after.items.map((i: { inventoryItem: { id: string } }) => i.inventoryItem.id)).toEqual([ctx.meat.id]);
    });

    it('keeps a received purchase received, with its stock, when the cancellation audit fails', async () => {
      const ctx = await setup();
      const draft = (await createDraft(ctx, { receiveNow: true }).expect(201)).body;
      await failAudit(ctx.tenantId, 'PURCHASE_CANCELLED');
      await post(ctx.accessToken, `/v1/purchases/${draft.id}/cancel`, { reason: 'Erro de lançamento' }).expect(500);
      const prisma = getPrisma(app);
      expect((await prisma.purchase.findUniqueOrThrow({ where: { id: draft.id } })).status).toBe('RECEIVED');
      expect(await prisma.stockMovement.count({ where: { tenantId: ctx.tenantId, type: 'REVERSAL' } })).toBe(0);
      expect((await balance(ctx, ctx.meat.id)).quantity).toBe(12.5);

      await restoreAudit();
      await post(ctx.accessToken, `/v1/purchases/${draft.id}/cancel`, { reason: 'Erro de lançamento' }).expect(200);
      expect((await balance(ctx, ctx.meat.id)).quantity).toBe(0);
    });

    it('does not write audit entries for replays', async () => {
      const ctx = await setup();
      const draft = (await createDraft(ctx, { receiveNow: true }).expect(201)).body;
      await post(ctx.accessToken, `/v1/purchases/${draft.id}/receive`).expect(200);
      await post(ctx.accessToken, `/v1/purchases/${draft.id}/cancel`, { reason: 'Cancelamento' }).expect(200);
      await post(ctx.accessToken, `/v1/purchases/${draft.id}/cancel`, { reason: 'Cancelamento' }).expect(200);
      const logs = await getPrisma(app).auditLog.findMany({
        where: { tenantId: ctx.tenantId, entity: 'Purchase' },
        orderBy: { createdAt: 'asc' },
      });
      expect(logs.map((l) => l.action)).toEqual(['PURCHASE_CREATED', 'PURCHASE_RECEIVED', 'PURCHASE_CANCELLED']);
    });
  });

  describe('active supplier names are unique under concurrency (P-07)', () => {
    it('creates exactly one supplier when many identical creations race, the rest get 409', async () => {
      const ctx = await setup();
      const name = `Fornecedor Corrida ${uniqueSuffix()}`;
      const variants = Array.from({ length: 12 }, (_, i) => (i % 2 === 0 ? name : name.toUpperCase()));
      const results = await Promise.all(variants.map((n) => post(ctx.accessToken, '/v1/suppliers', { name: n })));
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      const rejected = results.filter((r) => r.status !== 201);
      expect(rejected).toHaveLength(11);
      expect(rejected.every((r) => r.status === 409 && r.body.code === 'SUPPLIER_ALREADY_EXISTS')).toBe(true);
      const rows = await getPrisma(app).supplier.findMany({
        where: { tenantId: ctx.tenantId, name: { equals: name, mode: 'insensitive' } },
      });
      expect(rows).toHaveLength(1);
    });

    it('enforces the uniqueness in the database itself, not only in the application check', async () => {
      const ctx = await setup();
      const name = `Fornecedor Indice ${uniqueSuffix()}`;
      await post(ctx.accessToken, '/v1/suppliers', { name }).expect(201);
      await expect(
        getPrisma(app).supplier.create({ data: { tenantId: ctx.tenantId, name: name.toLowerCase() } }),
      ).rejects.toMatchObject({ code: 'P2002' });
    });

    it('still allows inactive historical suppliers with the same name, and blocks reactivating into a duplicate', async () => {
      const ctx = await setup();
      const name = `Fornecedor Historico ${uniqueSuffix()}`;
      const first = (await post(ctx.accessToken, '/v1/suppliers', { name }).expect(201)).body;
      await patch(ctx.accessToken, `/v1/suppliers/${first.id}`, { active: false }).expect(200);
      const second = (await post(ctx.accessToken, '/v1/suppliers', { name }).expect(201)).body;
      await patch(ctx.accessToken, `/v1/suppliers/${second.id}`, { active: false }).expect(200);
      const third = (await post(ctx.accessToken, '/v1/suppliers', { name }).expect(201)).body;

      const reactivate = await patch(ctx.accessToken, `/v1/suppliers/${first.id}`, { active: true }).expect(409);
      expect(reactivate.body.code).toBe('SUPPLIER_ALREADY_EXISTS');
      const rows = await getPrisma(app).supplier.findMany({ where: { tenantId: ctx.tenantId, name } });
      expect(rows.filter((r) => r.active).map((r) => r.id)).toEqual([third.id]);
      expect(rows).toHaveLength(3);
    });

    it('does not block the same name in a different tenant', async () => {
      const a = await setup();
      const b = await setup();
      const name = `Fornecedor Compartilhado ${uniqueSuffix()}`;
      await post(a.accessToken, '/v1/suppliers', { name }).expect(201);
      await post(b.accessToken, '/v1/suppliers', { name }).expect(201);
    });
  });

  describe('reversal keeps lot and expiry of the original entry (P-05)', () => {
    it('copies lotCode and expiresAt to the REVERSAL without touching the average cost', async () => {
      const ctx = await setup();
      const draft = (
        await createDraft(ctx, { receiveNow: true }, [
          { inventoryItemId: ctx.cheese.id, quantity: 4, unitCostCents: 2500, lotCode: 'LOTE-77', expiresAt: '2026-12-31' },
        ]).expect(201)
      ).body;
      const before = await balance(ctx, ctx.cheese.id);

      await post(ctx.accessToken, `/v1/purchases/${draft.id}/cancel`, { reason: 'Devolvido ao fornecedor' }).expect(200);

      const movements = await getPrisma(app).stockMovement.findMany({
        where: { tenantId: ctx.tenantId, inventoryItemId: ctx.cheese.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(movements.map((m) => m.type)).toEqual(['ENTRY', 'REVERSAL']);
      const [entry, reversal] = movements;
      expect(reversal.lotCode).toBe('LOTE-77');
      expect(reversal.expiresAt?.toISOString()).toBe(entry.expiresAt?.toISOString());
      expect(reversal.expiresAt?.toISOString().slice(0, 10)).toBe('2026-12-31');
      const after = await balance(ctx, ctx.cheese.id);
      expect(after.quantity).toBe(0);
      expect(after.averageCostCents).toBe(before.averageCostCents);
    });
  });
});
