import { INestApplication } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import request from 'supertest';
import {
  createStaffAndLoginE2E,
  createTestApp,
  getPrisma,
  registerTenantE2E,
} from './test-app.util';

type Json = Record<string, unknown>;

// Fase 11, slice 2: coupon administration. Using coupons in orders lives in
// coupons-orders.e2e-spec.ts and coupons-concurrency.e2e-spec.ts (own rate-limit windows).
describe('Coupons admin (e2e)', () => {
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
  const patch = (token: string, path: string, body: Json) =>
    request(server).patch(path).set(auth(token)).send(body);
  const prisma = () => getPrisma(app);

  async function setup() {
    return registerTenantE2E(server);
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const body = (extra: Json = {}) => ({
    code: 'PROMO10',
    discountType: 'PERCENTAGE',
    value: 10,
    ...extra,
  });
  const create = async (ctx: Ctx, extra: Json = {}) =>
    (await post(ctx.accessToken, '/v1/coupons', body(extra)).expect(201)).body as {
      id: string;
      code: string;
      active: boolean;
    };
  const audits = (ctx: Ctx, action: string) =>
    prisma().auditLog.count({ where: { tenantId: ctx.tenantId, action } });
  const activeCount = (tenantId: string, code: string) =>
    prisma().coupon.count({ where: { tenantId, code, active: true } });

  describe('create', () => {
    it('creates a percentage coupon, with defaults, and never exposes tenantId', async () => {
      const ctx = await setup();
      const res = await post(
        ctx.accessToken,
        '/v1/coupons',
        body({ description: 'Dez por cento' }),
      ).expect(201);
      expect(res.body).toMatchObject({
        code: 'PROMO10',
        description: 'Dez por cento',
        discountType: 'PERCENTAGE',
        value: 10,
        minOrderCents: 0,
        maxDiscountCents: null,
        startsAt: null,
        endsAt: null,
        active: true,
        availability: 'AVAILABLE',
        usageLimit: null,
        usageCount: 0,
        perCustomerLimit: null,
        branch: null,
      });
      expect(res.body).not.toHaveProperty('tenantId');
    });

    it('creates a fixed coupon with every rule, in cents', async () => {
      const ctx = await setup();
      const startsAt = new Date(Date.now() - 3_600_000).toISOString();
      const endsAt = new Date(Date.now() + 86_400_000).toISOString();
      const res = await post(ctx.accessToken, '/v1/coupons', {
        code: 'FIXO5',
        discountType: 'FIXED',
        value: 500,
        minOrderCents: 3000,
        startsAt,
        endsAt,
        usageLimit: 50,
        perCustomerLimit: 2,
        branchId: ctx.branchId,
      }).expect(201);
      expect(res.body).toMatchObject({
        discountType: 'FIXED',
        value: 500,
        minOrderCents: 3000,
        usageLimit: 50,
        perCustomerLimit: 2,
        branch: { id: ctx.branchId },
        availability: 'AVAILABLE',
      });
      expect(new Date(res.body.startsAt).toISOString()).toBe(startsAt);
      expect(new Date(res.body.endsAt).toISOString()).toBe(endsAt);
    });

    it('a percentage coupon may cap the discount (maxDiscountCents)', async () => {
      const ctx = await setup();
      const res = await post(
        ctx.accessToken,
        '/v1/coupons',
        body({ value: 50, maxDiscountCents: 1500 }),
      ).expect(201);
      expect(res.body).toMatchObject({ value: 50, maxDiscountCents: 1500 });
    });

    it('rejects invalid shapes with 400 and stores nothing', async () => {
      const ctx = await setup();
      const bad: Json[] = [
        { code: 'AB' }, // too short
        { code: 'A'.repeat(33) }, // too long
        { code: 'PRO MO' }, // inner space
        { code: 'PROMO%' },
        { code: 'PROMÇÃO' },
        { code: '' },
        { value: 0 }, // percentage 0
        { value: 101 }, // percentage > 100
        { value: -5 },
        { value: 10.5 }, // fraction
        { discountType: 'FIXED', value: 0 },
        { discountType: 'FIXED', value: -100 },
        { discountType: 'FIXED', value: 99.9 },
        { discountType: 'FIXED', value: 500, maxDiscountCents: 100 }, // cap only for percentage
        { maxDiscountCents: 0 },
        { minOrderCents: -1 },
        { usageLimit: 0 },
        { perCustomerLimit: 0 },
        { startsAt: '2026-10-10T00:00:00Z', endsAt: '2026-10-09T00:00:00Z' }, // ends before it starts
        { startsAt: '2026-10-10T00:00:00Z', endsAt: '2026-10-10T00:00:00Z' }, // zero-length window
        { startsAt: 'not-a-date' },
        { discountType: 'BOGO' },
        { description: 'x'.repeat(201) },
        { branchId: 'nope' },
        { value: 2_147_483_648, discountType: 'FIXED' },
      ];
      for (const extra of bad) {
        const res = await post(ctx.accessToken, '/v1/coupons', body(extra));
        expect([JSON.stringify(extra), res.status]).toEqual([JSON.stringify(extra), 400]);
      }
      expect(await prisma().coupon.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
    });

    it('does not accept fields the client must never set (tenantId, usageCount, active, id)', async () => {
      const ctx = await setup();
      for (const extra of [
        { tenantId: 'x' },
        { usageCount: 99 },
        { active: false },
        { id: 'abc' },
        { createdAt: 'x' },
      ]) {
        const res = await post(ctx.accessToken, '/v1/coupons', body(extra));
        expect([JSON.stringify(extra), res.status]).toEqual([JSON.stringify(extra), 400]);
      }
      expect(await prisma().coupon.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe('code normalization and uniqueness', () => {
    it.each(['promo10', 'PROMO10', ' PROMO10 ', '\tPromo10\n', 'PrOmO10'])(
      '%j is stored as PROMO10',
      async (typed) => {
        const ctx = await setup();
        const res = await post(ctx.accessToken, '/v1/coupons', body({ code: typed })).expect(201);
        expect(res.body.code).toBe('PROMO10');
        const row = await prisma().coupon.findUniqueOrThrow({ where: { id: res.body.id } });
        expect(row.code).toBe('PROMO10'); // canonical in the database, not only in the response
      },
    );

    it('refuses a second ACTIVE coupon with the same code, whatever the spelling', async () => {
      const ctx = await setup();
      const first = await create(ctx, { code: 'PROMO10' });
      for (const typed of ['promo10', 'PROMO10', ' PROMO10 ', ' pRoMo10']) {
        const res = await post(ctx.accessToken, '/v1/coupons', body({ code: typed }));
        expect([typed, res.status, res.body.code]).toEqual([typed, 409, 'COUPON_CODE_TAKEN']);
        expect(res.body.details).toEqual({ couponId: first.id });
      }
      expect(await activeCount(ctx.tenantId, 'PROMO10')).toBe(1);
      expect(await prisma().coupon.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
    });

    it('allows the same code in ANOTHER tenant', async () => {
      const a = await setup();
      const b = await setup();
      await create(a);
      await create(b);
      expect(await activeCount(a.tenantId, 'PROMO10')).toBe(1);
      expect(await activeCount(b.tenantId, 'PROMO10')).toBe(1);
    });

    it('PROMO10 active -> deactivate -> a NEW active PROMO10 is allowed; never two active at once', async () => {
      const ctx = await setup();
      const old = await create(ctx, { value: 10 });
      expect((await post(ctx.accessToken, '/v1/coupons', body())).status).toBe(409); // while active

      await post(ctx.accessToken, `/v1/coupons/${old.id}/deactivate`).expect(200);
      expect(await activeCount(ctx.tenantId, 'PROMO10')).toBe(0);

      const fresh = await create(ctx, { discountType: 'FIXED', value: 700 });
      expect(fresh.id).not.toBe(old.id);
      expect(await activeCount(ctx.tenantId, 'PROMO10')).toBe(1);
      expect(
        await prisma().coupon.count({ where: { tenantId: ctx.tenantId, code: 'PROMO10' } }),
      ).toBe(2);

      // the old one cannot come back while the new one is active...
      const react = await post(ctx.accessToken, `/v1/coupons/${old.id}/activate`);
      expect([react.status, react.body.code]).toEqual([409, 'COUPON_CODE_TAKEN']);
      expect(await activeCount(ctx.tenantId, 'PROMO10')).toBe(1);

      // ...but can once the new one is deactivated (and then the new one is the one that is blocked)
      await post(ctx.accessToken, `/v1/coupons/${fresh.id}/deactivate`).expect(200);
      await post(ctx.accessToken, `/v1/coupons/${old.id}/activate`).expect(200);
      expect((await post(ctx.accessToken, `/v1/coupons/${fresh.id}/activate`)).status).toBe(409);
      expect(await activeCount(ctx.tenantId, 'PROMO10')).toBe(1);
      expect((await prisma().coupon.findUniqueOrThrow({ where: { id: old.id } })).active).toBe(
        true,
      );
    });

    it('10 simultaneous creations of the same code leave exactly ONE active coupon', async () => {
      const ctx = await setup();
      const results = await Promise.all(
        [
          'promo10',
          'PROMO10',
          ' PROMO10 ',
          'Promo10',
          'promo10',
          'PROMO10',
          ' promo10',
          'PROMO10 ',
          'pROMO10',
          'PROMO10',
        ].map((code) => post(ctx.accessToken, '/v1/coupons', body({ code }))),
      );
      const statuses = results.map((r) => r.status).sort();
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);
      expect(statuses.filter((s) => s === 409)).toHaveLength(9);
      expect(statuses.every((s) => s === 201 || s === 409)).toBe(true); // never a 500
      expect(await activeCount(ctx.tenantId, 'PROMO10')).toBe(1);
    });

    it('simultaneous activation of two inactive homonyms activates at most one', async () => {
      const ctx = await setup();
      const a = await create(ctx);
      await post(ctx.accessToken, `/v1/coupons/${a.id}/deactivate`).expect(200);
      const b = await create(ctx);
      await post(ctx.accessToken, `/v1/coupons/${b.id}/deactivate`).expect(200);
      const results = await Promise.all([
        post(ctx.accessToken, `/v1/coupons/${a.id}/activate`),
        post(ctx.accessToken, `/v1/coupons/${b.id}/activate`),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await activeCount(ctx.tenantId, 'PROMO10')).toBe(1);
    });

    it('the database itself refuses a second active homonym and non-canonical codes (not only the API)', async () => {
      const ctx = await setup();
      await create(ctx);
      const raw = (code: string, active = true) =>
        prisma().coupon.create({
          data: { tenantId: ctx.tenantId, code, discountType: 'FIXED', value: 100, active },
        });
      await expect(raw('PROMO10')).rejects.toMatchObject({ code: 'P2002' });
      await expect(raw('promo11')).rejects.toBeDefined(); // CHECK coupons_code_canonical
      await expect(raw(' PROMO12 ')).rejects.toBeDefined();
      await expect(raw('PROMO10', false)).resolves.toBeDefined(); // an inactive homonym is fine
    });
  });

  // ---------------------------------------------------------------------------------------
  describe('read: list, search, detail', () => {
    it('lists only the tenant coupons, newest first, with counters, search and pagination', async () => {
      const ctx = await setup();
      const other = await setup();
      await create(other, { code: 'OUTROTENANT' });
      const codes = ['ALFA10', 'BETA10', 'GAMA10', 'DELTA10', 'EPSILON10'];
      for (const code of codes) await create(ctx, { code });
      const off = await create(ctx, { code: 'DESLIGADO' });
      await post(ctx.accessToken, `/v1/coupons/${off.id}/deactivate`).expect(200);

      const all = (await get(ctx.accessToken, '/v1/coupons?status=all').expect(200)).body;
      expect(all.data).toHaveLength(6);
      expect(all.data.map((c: { code: string }) => c.code)).not.toContain('OUTROTENANT');
      expect(all.summary).toEqual({ active: 5, inactive: 1 });

      const active = (await get(ctx.accessToken, '/v1/coupons').expect(200)).body; // default: active
      expect(active.data).toHaveLength(5);
      expect(active.data.every((c: { active: boolean }) => c.active)).toBe(true);
      const inactive = (await get(ctx.accessToken, '/v1/coupons?status=inactive').expect(200)).body;
      expect(inactive.data.map((c: { code: string }) => c.code)).toEqual(['DESLIGADO']);

      // search ignores case and surrounding spaces; % and _ are plain text
      const found = (
        await get(ctx.accessToken, '/v1/coupons?status=all&search=%20delta').expect(200)
      ).body;
      expect(found.data.map((c: { code: string }) => c.code)).toEqual(['DELTA10']);
      expect(found.summary).toEqual({ active: 1, inactive: 0 });
      const wild = (await get(ctx.accessToken, '/v1/coupons?status=all&search=%25').expect(200))
        .body;
      expect(wild.data).toHaveLength(0);
      const underscore = (await get(ctx.accessToken, '/v1/coupons?status=all&search=_').expect(200))
        .body;
      expect(underscore.data).toHaveLength(0);

      // deterministic pagination: no overlap, no gap
      const p1 = (
        await get(ctx.accessToken, '/v1/coupons?status=all&pageSize=4&page=1').expect(200)
      ).body;
      const p2 = (
        await get(ctx.accessToken, '/v1/coupons?status=all&pageSize=4&page=2').expect(200)
      ).body;
      expect(p1.meta).toMatchObject({ page: 1, pageSize: 4, total: 6, totalPages: 2 });
      const ids = [...p1.data, ...p2.data].map((c: { id: string }) => c.id);
      expect(ids).toHaveLength(6);
      expect(new Set(ids).size).toBe(6);
      expect((await get(ctx.accessToken, '/v1/coupons?pageSize=101')).status).toBe(400);
      expect((await get(ctx.accessToken, '/v1/coupons?status=weird')).status).toBe(400);
    });

    it('derives the availability: inactive, scheduled, expired, exhausted, available', async () => {
      const ctx = await setup();
      const day = 86_400_000;
      const scheduled = await create(ctx, {
        code: 'FUTURO',
        startsAt: new Date(Date.now() + day).toISOString(),
      });
      const expired = await create(ctx, {
        code: 'PASSADO',
        startsAt: new Date(Date.now() - 2 * day).toISOString(),
        endsAt: new Date(Date.now() - day).toISOString(),
      });
      const exhausted = await create(ctx, { code: 'ESGOTADO', usageLimit: 1 });
      await prisma().coupon.update({ where: { id: exhausted.id }, data: { usageCount: 1 } });
      const off = await create(ctx, { code: 'OFF' });
      await post(ctx.accessToken, `/v1/coupons/${off.id}/deactivate`).expect(200);
      const ok = await create(ctx, { code: 'VALE' });
      const availability = async (id: string) =>
        (await get(ctx.accessToken, `/v1/coupons/${id}`).expect(200)).body.availability;
      expect(await availability(scheduled.id)).toBe('SCHEDULED');
      expect(await availability(expired.id)).toBe('EXPIRED');
      expect(await availability(exhausted.id)).toBe('EXHAUSTED');
      expect(await availability(off.id)).toBe('INACTIVE');
      expect(await availability(ok.id)).toBe('AVAILABLE');
    });

    it('answers 404 for unknown ids and 400 for malformed ones', async () => {
      const ctx = await setup();
      expect(
        (await get(ctx.accessToken, '/v1/coupons/3f2504e0-4f89-41d3-9a0c-0305e82c3301')).status,
      ).toBe(404);
      expect((await get(ctx.accessToken, '/v1/coupons/not-a-uuid')).status).toBe(400);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe('update, activate and deactivate', () => {
    it('updates only what was sent, clears optional fields and keeps code, branch and usage untouched', async () => {
      const ctx = await setup();
      const c = await create(ctx, {
        value: 10,
        maxDiscountCents: 1000,
        usageLimit: 5,
        description: 'antes',
      });
      const res = await patch(ctx.accessToken, `/v1/coupons/${c.id}`, {
        value: 15,
        description: 'depois',
        maxDiscountCents: null,
        usageLimit: null,
      }).expect(200);
      expect(res.body).toMatchObject({
        code: 'PROMO10',
        value: 15,
        description: 'depois',
        maxDiscountCents: null,
        usageLimit: null,
        active: true,
      });
      const fields = (
        await prisma().auditLog.findFirstOrThrow({
          where: { tenantId: ctx.tenantId, action: 'COUPON_UPDATED' },
        })
      ).afterData as { fields: string[] };
      expect(fields.fields.sort()).toEqual([
        'description',
        'maxDiscountCents',
        'usageLimit',
        'value',
      ]);
    });

    it('validates the MERGED state: switching to FIXED while a cap exists is refused', async () => {
      const ctx = await setup();
      const c = await create(ctx, { value: 10, maxDiscountCents: 1000 });
      const res = await patch(ctx.accessToken, `/v1/coupons/${c.id}`, {
        discountType: 'FIXED',
        value: 500,
      });
      expect([res.status, res.body.code]).toEqual([400, 'COUPON_INVALID_INPUT']);
      expect(
        (
          await patch(ctx.accessToken, `/v1/coupons/${c.id}`, {
            discountType: 'FIXED',
            value: 500,
            maxDiscountCents: null,
          })
        ).status,
      ).toBe(200);
      expect((await patch(ctx.accessToken, `/v1/coupons/${c.id}`, { value: 150 })).status).toBe(
        200,
      ); // FIXED 150 cents is fine
      expect(
        (await patch(ctx.accessToken, `/v1/coupons/${c.id}`, { discountType: 'PERCENTAGE' }))
          .status,
      ).toBe(400); // 150 %
    });

    it('cannot change the code, the branch, the activation, the tenant or the usage through PATCH', async () => {
      const ctx = await setup();
      const c = await create(ctx);
      for (const extra of [
        { code: 'OUTRO' },
        { branchId: ctx.branchId },
        { active: false },
        { tenantId: 'x' },
        { usageCount: 0 },
        { id: 'x' },
      ]) {
        const res = await patch(ctx.accessToken, `/v1/coupons/${c.id}`, extra);
        expect([JSON.stringify(extra), res.status]).toEqual([JSON.stringify(extra), 400]);
      }
      const row = await prisma().coupon.findUniqueOrThrow({ where: { id: c.id } });
      expect([row.code, row.active, row.usageCount, row.tenantId]).toEqual([
        'PROMO10',
        true,
        0,
        ctx.tenantId,
      ]);
    });

    it('refuses a usage limit below the usages already made', async () => {
      const ctx = await setup();
      const c = await create(ctx, { usageLimit: 10 });
      await prisma().coupon.update({ where: { id: c.id }, data: { usageCount: 4 } });
      const res = await patch(ctx.accessToken, `/v1/coupons/${c.id}`, { usageLimit: 3 });
      expect([res.status, res.body.code]).toEqual([400, 'COUPON_USAGE_LIMIT_BELOW_USED']);
      await patch(ctx.accessToken, `/v1/coupons/${c.id}`, { usageLimit: 4 }).expect(200);
      expect((await prisma().coupon.findUniqueOrThrow({ where: { id: c.id } })).usageLimit).toBe(4);
    });

    it('a no-op patch changes nothing and writes no audit', async () => {
      const ctx = await setup();
      const c = await create(ctx, { value: 10 });
      const before = await prisma().coupon.findUniqueOrThrow({ where: { id: c.id } });
      await patch(ctx.accessToken, `/v1/coupons/${c.id}`, { value: 10 }).expect(200);
      await patch(ctx.accessToken, `/v1/coupons/${c.id}`, {}).expect(200);
      expect(await audits(ctx, 'COUPON_UPDATED')).toBe(0);
      expect((await prisma().coupon.findUniqueOrThrow({ where: { id: c.id } })).updatedAt).toEqual(
        before.updatedAt,
      );
    });

    it('deactivates and reactivates, one audit event each, idempotent repeats write nothing', async () => {
      const ctx = await setup();
      const c = await create(ctx);
      expect(
        (await post(ctx.accessToken, `/v1/coupons/${c.id}/deactivate`).expect(200)).body,
      ).toMatchObject({ active: false, availability: 'INACTIVE' });
      await post(ctx.accessToken, `/v1/coupons/${c.id}/deactivate`).expect(200); // repeat
      expect(
        (await post(ctx.accessToken, `/v1/coupons/${c.id}/activate`).expect(200)).body,
      ).toMatchObject({ active: true });
      await post(ctx.accessToken, `/v1/coupons/${c.id}/activate`).expect(200); // repeat
      expect([
        await audits(ctx, 'COUPON_DEACTIVATED'),
        await audits(ctx, 'COUPON_ACTIVATED'),
      ]).toEqual([1, 1]);
    });

    it('never deletes: there is no DELETE route and a deactivated coupon stays readable', async () => {
      const ctx = await setup();
      const c = await create(ctx);
      await post(ctx.accessToken, `/v1/coupons/${c.id}/deactivate`).expect(200);
      expect(
        (await request(server).delete(`/v1/coupons/${c.id}`).set(auth(ctx.accessToken))).status,
      ).toBe(404);
      await get(ctx.accessToken, `/v1/coupons/${c.id}`).expect(200);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe('tenant isolation', () => {
    it('tenant A cannot read, list, search, edit, activate or deactivate a coupon of tenant B', async () => {
      const a = await setup();
      const b = await setup();
      const theirs = await create(b, { code: 'SEGREDO10' });
      expect((await get(a.accessToken, `/v1/coupons/${theirs.id}`)).status).toBe(404);
      expect((await patch(a.accessToken, `/v1/coupons/${theirs.id}`, { value: 99 })).status).toBe(
        404,
      );
      expect((await post(a.accessToken, `/v1/coupons/${theirs.id}/deactivate`)).status).toBe(404);
      expect((await post(a.accessToken, `/v1/coupons/${theirs.id}/activate`)).status).toBe(404);
      const list = (await get(a.accessToken, '/v1/coupons?status=all&search=SEGREDO').expect(200))
        .body;
      expect(list.data).toHaveLength(0);
      expect(
        JSON.stringify((await get(a.accessToken, '/v1/coupons?status=all').expect(200)).body),
      ).not.toContain('SEGREDO10');
      const row = await prisma().coupon.findUniqueOrThrow({ where: { id: theirs.id } });
      expect([row.value, row.active]).toEqual([10, true]);
    });

    it('cannot scope a coupon to a branch of another tenant', async () => {
      const a = await setup();
      const b = await setup();
      const res = await post(a.accessToken, '/v1/coupons', body({ branchId: b.branchId }));
      expect(res.status).toBe(404);
      expect(await prisma().coupon.count({ where: { tenantId: a.tenantId } })).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe('branch isolation', () => {
    it('a branch-limited manager sees tenant-wide and own-branch coupons, and manages only own-branch ones', async () => {
      const ctx = await setup();
      const branch2 = await prisma().branch.create({
        data: { tenantId: ctx.tenantId, name: 'Filial 2', code: 'F2', status: 'ACTIVE' },
      });
      const wide = await create(ctx, { code: 'TODAS' });
      const inB1 = await create(ctx, { code: 'FILIAL1', branchId: ctx.branchId });
      const inB2 = await create(ctx, { code: 'FILIAL2', branchId: branch2.id });
      const m1 = await createStaffAndLoginE2E(app, server, ctx.tenantId, RoleName.MANAGER, [
        ctx.branchId,
      ]);

      const list = (await get(m1, '/v1/coupons?status=all').expect(200)).body.data
        .map((c: { code: string }) => c.code)
        .sort();
      expect(list).toEqual(['FILIAL1', 'TODAS']);
      expect((await get(m1, `/v1/coupons/${inB2.id}`)).status).toBe(404); // another branch: invisible
      await get(m1, `/v1/coupons/${wide.id}`).expect(200); // tenant-wide: readable...
      const editWide = await patch(m1, `/v1/coupons/${wide.id}`, { value: 50 });
      expect([editWide.status, editWide.body.code]).toEqual([403, 'COUPON_BRANCH_FORBIDDEN']); // ...not editable
      expect((await post(m1, `/v1/coupons/${wide.id}/deactivate`)).status).toBe(403);
      expect((await patch(m1, `/v1/coupons/${inB2.id}`, { value: 50 })).status).toBe(404);
      expect((await patch(m1, `/v1/coupons/${inB1.id}`, { value: 50 })).status).toBe(200); // own branch

      // creation: only for own branches, never tenant-wide, never another branch
      expect((await post(m1, '/v1/coupons', body({ code: 'NOVO1' }))).status).toBe(403);
      expect(
        (await post(m1, '/v1/coupons', body({ code: 'NOVO2', branchId: branch2.id }))).status,
      ).toBe(403);
      expect(
        (await post(m1, '/v1/coupons', body({ code: 'NOVO3', branchId: ctx.branchId }))).status,
      ).toBe(201);

      // the untouched ones really are untouched
      const rows = await prisma().coupon.findMany({ where: { id: { in: [wide.id, inB2.id] } } });
      expect(rows.every((r) => r.value === 10 && r.active)).toBe(true);
    });
  });

  // ---------------------------------------------------------------------------------------
  describe('permissions (backend)', () => {
    it('OWNER/ADMIN/MANAGER administer; CASHIER and everyone else are refused', async () => {
      const ctx = await setup();
      // Scoped to the branch the staff below are linked to: a branch-limited MANAGER manages
      // only that branch's coupons (see the branch isolation test), so the permission under test
      // is the only thing that can make a request fail.
      const target = await create(ctx, { code: 'ALVO10', branchId: ctx.branchId });
      const roles: [RoleName, boolean][] = [
        [RoleName.ADMIN, true],
        [RoleName.MANAGER, true],
        [RoleName.CASHIER, false], // may APPLY coupons (coupons.apply), never administer them
        [RoleName.WAITER, false],
        [RoleName.KITCHEN, false],
        [RoleName.DELIVERY, false],
        [RoleName.VIEWER, false],
      ];
      let n = 0;
      for (const [role, allowed] of roles) {
        const token = await createStaffAndLoginE2E(app, server, ctx.tenantId, role, [ctx.branchId]);
        const list = await get(token, '/v1/coupons');
        const detail = await get(token, `/v1/coupons/${target.id}`);
        const created = await post(
          token,
          '/v1/coupons',
          body({ code: `ROLE${n++}`, branchId: ctx.branchId }),
        );
        const updated = await patch(token, `/v1/coupons/${target.id}`, {
          description: `nota ${role}`,
        });
        const off = await post(token, `/v1/coupons/${target.id}/deactivate`);
        const on = await post(token, `/v1/coupons/${target.id}/activate`);
        const ok = (r: { status: number }, expected: number) => r.status === expected;
        expect([role, 'list', ok(list, 200)]).toEqual([role, 'list', allowed]);
        expect([role, 'detail', ok(detail, 200)]).toEqual([role, 'detail', allowed]);
        expect([role, 'create', ok(created, 201)]).toEqual([role, 'create', allowed]);
        expect([role, 'update', ok(updated, 200)]).toEqual([role, 'update', allowed]);
        expect([role, 'deactivate', ok(off, 200)]).toEqual([role, 'deactivate', allowed]);
        expect([role, 'activate', ok(on, 200)]).toEqual([role, 'activate', allowed]);
        if (!allowed)
          expect([list, detail, created, updated, off, on].map((r) => r.status)).toEqual([
            403, 403, 403, 403, 403, 403,
          ]);
      }
      const anon = await request(server).get('/v1/coupons');
      expect(anon.status).toBe(401);
      expect(
        (
          await request(server)
            .post('/v1/coupons')
            .send(body({ code: 'ANON10' }))
        ).status,
      ).toBe(401);
      // nothing a refused role tried was stored
      expect(
        await prisma().coupon.count({
          where: { tenantId: ctx.tenantId, code: { startsWith: 'ROLE' } },
        }),
      ).toBe(2);
    });

    it('the permission matrix really stored in the database', async () => {
      const rows = await prisma().rolePermission.findMany({
        where: { permission: { key: { startsWith: 'coupons.' } } },
        select: { role: { select: { name: true } }, permission: { select: { key: true } } },
      });
      const byRole: Record<string, string[]> = {};
      for (const r of rows) (byRole[r.role.name] ??= []).push(r.permission.key);
      for (const key of Object.keys(byRole)) byRole[key].sort();
      const all = ['coupons.apply', 'coupons.create', 'coupons.read', 'coupons.update'];
      expect(byRole).toEqual({ OWNER: all, ADMIN: all, MANAGER: all, CASHIER: ['coupons.apply'] });
    });
  });

  // ---------------------------------------------------------------------------------------
  describe('audit', () => {
    it('records created/updated/activated/deactivated with tenant, user and no personal data', async () => {
      const ctx = await setup();
      const c = await create(ctx, { description: 'texto livre do administrador' });
      await patch(ctx.accessToken, `/v1/coupons/${c.id}`, { value: 20 }).expect(200);
      await post(ctx.accessToken, `/v1/coupons/${c.id}/deactivate`).expect(200);
      await post(ctx.accessToken, `/v1/coupons/${c.id}/activate`).expect(200);

      const logs = await prisma().auditLog.findMany({
        where: { tenantId: ctx.tenantId, entity: 'Coupon' },
        orderBy: { createdAt: 'asc' },
      });
      expect(logs.map((l) => l.action)).toEqual([
        'COUPON_CREATED',
        'COUPON_UPDATED',
        'COUPON_DEACTIVATED',
        'COUPON_ACTIVATED',
      ]);
      for (const log of logs) {
        expect(log.entityId).toBe(c.id);
        expect(log.tenantId).toBe(ctx.tenantId);
        expect(log.userId).not.toBeNull();
        expect(JSON.stringify(log)).not.toContain('texto livre'); // free text never goes to the trail
      }
      expect(logs[0].afterData).toMatchObject({
        code: 'PROMO10',
        discountType: 'PERCENTAGE',
        value: 10,
      });
      expect(logs[1].afterData).toMatchObject({ fields: ['value'] });
    });

    const failAudit = async (tenantId: string, action: string) => {
      await prisma().$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION fail_audit_coupons_test() RETURNS trigger LANGUAGE plpgsql AS $fn$
         BEGIN
           IF NEW."tenantId" = '${tenantId}' AND NEW."action" = '${action}' THEN
             RAISE EXCEPTION 'audit failure injected by test';
           END IF;
           RETURN NEW;
         END $fn$`,
      );
      await prisma().$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS fail_audit_coupons_test ON audit_logs`,
      );
      await prisma().$executeRawUnsafe(
        `CREATE TRIGGER fail_audit_coupons_test BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_audit_coupons_test()`,
      );
    };
    const restoreAudit = async () => {
      await prisma().$executeRawUnsafe(
        `DROP TRIGGER IF EXISTS fail_audit_coupons_test ON audit_logs`,
      );
      await prisma().$executeRawUnsafe(`DROP FUNCTION IF EXISTS fail_audit_coupons_test()`);
    };
    afterEach(restoreAudit);

    it('rolls back a creation when its audit cannot be written', async () => {
      const ctx = await setup();
      await failAudit(ctx.tenantId, 'COUPON_CREATED');
      await post(ctx.accessToken, '/v1/coupons', body()).expect(500);
      expect(await prisma().coupon.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      await restoreAudit();
      await post(ctx.accessToken, '/v1/coupons', body()).expect(201);
    });

    it.each([
      ['COUPON_UPDATED', 'patch'],
      ['COUPON_DEACTIVATED', 'deactivate'],
    ])('rolls back a change when %s cannot be audited', async (action, kind) => {
      const ctx = await setup();
      const c = await create(ctx, { value: 10 });
      await failAudit(ctx.tenantId, action);
      const attempt = () =>
        kind === 'patch'
          ? patch(ctx.accessToken, `/v1/coupons/${c.id}`, { value: 30 })
          : post(ctx.accessToken, `/v1/coupons/${c.id}/deactivate`);
      await attempt().expect(500);
      const row = await prisma().coupon.findUniqueOrThrow({ where: { id: c.id } });
      expect([row.value, row.active]).toEqual([10, true]);
      await restoreAudit();
      await attempt().expect(200);
    });
  });
});
