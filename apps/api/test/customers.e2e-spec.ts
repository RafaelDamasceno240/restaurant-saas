import { INestApplication } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import request from 'supertest';
import { createStaffAndLoginE2E, createTestApp, getPrisma, registerTenantE2E } from './test-app.util';

type Json = Record<string, unknown>;

// Fase 11, slice 1: CRM customers. Orders/metrics live in customers-orders.e2e-spec.ts (own
// rate-limit window).
describe('Customers (e2e)', () => {
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
  const prisma = () => getPrisma(app);

  // Unique, valid phone per call so tests never collide inside a tenant.
  let seq = 0;
  const phone = () => `119${String(Date.now() + ++seq).slice(-8)}`;
  const VALID_CPFS = ['52998224725', '11144477735', '39053344705', '16899535009', '74682814820'];
  let cpfSeq = 0;
  const cpf = () => VALID_CPFS[cpfSeq++ % VALID_CPFS.length];

  async function setup() {
    return registerTenantE2E(server);
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  const body = (extra: Json = {}) => ({ name: 'Maria Souza', phone: phone(), ...extra });
  const create = async (ctx: Ctx, extra: Json = {}) => (await post(ctx.accessToken, '/v1/customers', body(extra)).expect(201)).body;
  const audits = (ctx: Ctx, action: string) => prisma().auditLog.count({ where: { tenantId: ctx.tenantId, action } });

  describe('create', () => {
    it('creates a customer with normalized data and audits it without personal data', async () => {
      const ctx = await setup();
      const res = await post(ctx.accessToken, '/v1/customers', {
        name: '  Maria Souza  ',
        phone: '+55 (11) 98765-4321',
        email: '  Maria@Example.COM ',
        cpf: '529.982.247-25',
        notes: '  prefere sem cebola ',
      }).expect(201);
      expect(res.body).toMatchObject({
        name: 'Maria Souza',
        phone: '11987654321',
        email: 'maria@example.com',
        cpf: '52998224725',
        notes: 'prefere sem cebola',
        active: true,
      });
      expect(res.body).not.toHaveProperty('tenantId');

      const log = await prisma().auditLog.findFirstOrThrow({ where: { tenantId: ctx.tenantId, action: 'CUSTOMER_CREATED' } });
      expect(log).toMatchObject({ entity: 'Customer', entityId: res.body.id });
      const payload = JSON.stringify(log);
      for (const secret of ['11987654321', 'maria@example.com', '52998224725', 'Maria Souza', 'cebola']) {
        expect(payload).not.toContain(secret);
      }
    });

    it('needs only name and phone; email, cpf and notes are optional', async () => {
      const ctx = await setup();
      const res = await post(ctx.accessToken, '/v1/customers', { name: 'Só Nome', phone: phone() }).expect(201);
      expect(res.body).toMatchObject({ email: null, cpf: null, notes: null, active: true });
    });

    it('rejects invalid input with 400 and stores nothing', async () => {
      const ctx = await setup();
      const bad: Json[] = [
        {},
        { name: 'M', phone: phone() },
        { name: 'Maria', phone: '123' },
        { name: 'Maria', phone: 'abcdefghij' },
        { name: 'Maria', phone: '1234567890123456' },
        { name: 'Maria', phone: phone(), email: 'not-an-email' },
        { name: 'Maria', phone: phone(), cpf: '123.456.789-00' },
        { name: 'Maria', phone: phone(), cpf: '000.000.000-00' },
        { name: 'x'.repeat(121), phone: phone() },
        { name: 'Maria', phone: phone(), notes: 'x'.repeat(501) },
        { name: 'Maria', phone: phone(), active: false }, // not a create field
      ];
      for (const payload of bad) {
        const res = await post(ctx.accessToken, '/v1/customers', payload);
        expect([JSON.stringify(payload).slice(0, 60), res.status]).toEqual([JSON.stringify(payload).slice(0, 60), 400]);
      }
      expect(await prisma().customer.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
    });

    it('ignores nothing it should not: tenantId and other internal fields in the body are rejected', async () => {
      const ctx = await setup();
      const other = await setup();
      const res = await post(ctx.accessToken, '/v1/customers', body({ tenantId: other.tenantId }));
      expect(res.status).toBe(400);
      expect(await prisma().customer.count({ where: { tenantId: other.tenantId } })).toBe(0);
    });
  });

  describe('duplicates', () => {
    it('refuses a second ACTIVE customer with the same phone (any spelling), pointing at the existing one', async () => {
      const ctx = await setup();
      const first = await create(ctx, { phone: '(11) 98765-4321' });
      for (const variant of ['11987654321', '+55 11 98765-4321', '5511987654321']) {
        const res = await post(ctx.accessToken, '/v1/customers', { name: 'Outra', phone: variant });
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('CUSTOMER_PHONE_TAKEN');
        expect(res.body.details).toEqual({ customerId: first.id });
      }
      expect(await prisma().customer.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
    });

    it('refuses a repeated CPF, but the same phone/CPF is fine in ANOTHER tenant', async () => {
      const ctx = await setup();
      const other = await setup();
      const first = await create(ctx, { phone: '11987654321', cpf: '529.982.247-25' });
      const res = await post(ctx.accessToken, '/v1/customers', { name: 'Outra', phone: phone(), cpf: '52998224725' }).expect(409);
      expect(res.body.code).toBe('CUSTOMER_CPF_TAKEN');
      expect(res.body.details).toEqual({ customerId: first.id });
      await post(other.accessToken, '/v1/customers', { name: 'Outra', phone: '11987654321', cpf: '52998224725' }).expect(201);
    });

    it('allows the phone of an INACTIVE customer to be reused; reactivating it then conflicts', async () => {
      const ctx = await setup();
      const first = await create(ctx, { phone: '11987654321' });
      await patch(ctx.accessToken, `/v1/customers/${first.id}`, { active: false }).expect(200);
      const second = await post(ctx.accessToken, '/v1/customers', { name: 'Novo dono', phone: '11987654321' }).expect(201);
      const res = await patch(ctx.accessToken, `/v1/customers/${first.id}`, { active: true }).expect(409);
      expect(res.body.code).toBe('CUSTOMER_PHONE_TAKEN');
      expect(res.body.details).toEqual({ customerId: second.body.id });
      expect((await prisma().customer.findUniqueOrThrow({ where: { id: first.id } })).active).toBe(false);
    });

    it('10 simultaneous creations of the same phone produce exactly one customer', async () => {
      const ctx = await setup();
      const same = phone();
      const res = await Promise.all(Array.from({ length: 10 }, () => post(ctx.accessToken, '/v1/customers', { name: 'Corrida', phone: same })));
      expect(res.filter((r) => r.status === 201)).toHaveLength(1);
      expect(res.filter((r) => r.status === 409)).toHaveLength(9);
      expect(res.filter((r) => r.status >= 500)).toHaveLength(0);
      expect(await prisma().customer.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
      expect(await audits(ctx, 'CUSTOMER_CREATED')).toBe(1);
    });
  });

  describe('update and inactivation', () => {
    it('updates only what was sent, clears optional fields and audits field names only', async () => {
      const ctx = await setup();
      const c = await create(ctx, { email: 'a@example.com', cpf: cpf(), notes: 'nota' });
      const res = await patch(ctx.accessToken, `/v1/customers/${c.id}`, { name: 'Maria Silva', email: '', cpf: null, notes: '' }).expect(200);
      expect(res.body).toMatchObject({ name: 'Maria Silva', phone: c.phone, email: null, cpf: null, notes: null, active: true });
      const log = await prisma().auditLog.findFirstOrThrow({ where: { tenantId: ctx.tenantId, action: 'CUSTOMER_UPDATED' } });
      expect(log.afterData).toEqual({ fields: expect.arrayContaining(['name', 'email', 'cpf', 'notes']) });
      expect(JSON.stringify(log)).not.toContain('Maria Silva');
    });

    it('a no-op patch changes nothing and writes no audit', async () => {
      const ctx = await setup();
      const c = await create(ctx);
      const before = await prisma().customer.findUniqueOrThrow({ where: { id: c.id } });
      await patch(ctx.accessToken, `/v1/customers/${c.id}`, {}).expect(200);
      await patch(ctx.accessToken, `/v1/customers/${c.id}`, { name: c.name, phone: c.phone }).expect(200);
      const after = await prisma().customer.findUniqueOrThrow({ where: { id: c.id } });
      expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
      expect(await audits(ctx, 'CUSTOMER_UPDATED')).toBe(0);
    });

    it('validates the patch and cannot move a customer to another tenant or change its id', async () => {
      const ctx = await setup();
      const other = await setup();
      const c = await create(ctx);
      for (const payload of [{ phone: '12' }, { cpf: '111.111.111-11' }, { email: 'nope' }, { name: 'M' }, { active: 'yes' }, { tenantId: other.tenantId }, { id: 'x' }]) {
        expect((await patch(ctx.accessToken, `/v1/customers/${c.id}`, payload)).status).toBe(400);
      }
      expect((await prisma().customer.findUniqueOrThrow({ where: { id: c.id } })).tenantId).toBe(ctx.tenantId);
    });

    it('inactivates and reactivates, with one audit event each and idempotent repeats', async () => {
      const ctx = await setup();
      const c = await create(ctx);
      expect((await patch(ctx.accessToken, `/v1/customers/${c.id}`, { active: false }).expect(200)).body.active).toBe(false);
      await patch(ctx.accessToken, `/v1/customers/${c.id}`, { active: false }).expect(200);
      expect(await audits(ctx, 'CUSTOMER_DEACTIVATED')).toBe(1);
      expect((await patch(ctx.accessToken, `/v1/customers/${c.id}`, { active: true }).expect(200)).body.active).toBe(true);
      expect(await audits(ctx, 'CUSTOMER_REACTIVATED')).toBe(1);
    });

    it('refuses to move a customer onto another customer\'s phone or CPF', async () => {
      const ctx = await setup();
      const a = await create(ctx, { cpf: '52998224725' });
      const b = await create(ctx);
      expect((await patch(ctx.accessToken, `/v1/customers/${b.id}`, { phone: a.phone })).body.code).toBe('CUSTOMER_PHONE_TAKEN');
      expect((await patch(ctx.accessToken, `/v1/customers/${b.id}`, { cpf: '529.982.247-25' })).body.code).toBe('CUSTOMER_CPF_TAKEN');
      expect((await prisma().customer.findUniqueOrThrow({ where: { id: b.id } })).phone).toBe(b.phone);
    });
  });

  describe('list, search and pagination', () => {
    it('lists the tenant customers only, name ascending, without cpf/notes, with active/inactive counters', async () => {
      const ctx = await setup();
      const other = await setup();
      await create(other, { name: 'Zé do Outro Tenant' });
      const names = ['Carla', 'Ana', 'Bruno'];
      for (const name of names) await create(ctx, { name, cpf: name === 'Ana' ? cpf() : undefined, notes: 'secreta' });
      const inactive = await create(ctx, { name: 'Dora' });
      await patch(ctx.accessToken, `/v1/customers/${inactive.id}`, { active: false }).expect(200);

      const res = await get(ctx.accessToken, '/v1/customers').expect(200);
      expect(res.body.data.map((c: { name: string }) => c.name)).toEqual(['Ana', 'Bruno', 'Carla']);
      expect(res.body.summary).toEqual({ active: 3, inactive: 1 });
      expect(res.body.meta).toMatchObject({ page: 1, pageSize: 20, total: 3, totalPages: 1 });
      for (const row of res.body.data) {
        expect(row).not.toHaveProperty('cpf');
        expect(row).not.toHaveProperty('notes');
        expect(row).not.toHaveProperty('tenantId');
        expect(row).toMatchObject({ ordersCount: 0, totalSpentCents: 0, lastOrderAt: null });
      }
      const inactiveOnly = await get(ctx.accessToken, '/v1/customers?status=inactive').expect(200);
      expect(inactiveOnly.body.data.map((c: { name: string }) => c.name)).toEqual(['Dora']);
      expect((await get(ctx.accessToken, '/v1/customers?status=all').expect(200)).body.meta.total).toBe(4);
    });

    it('searches by name, phone digits, e-mail and CPF, ignoring case and punctuation', async () => {
      const ctx = await setup();
      await create(ctx, { name: 'João da Silva', phone: '11955550001', email: 'joao@empresa.com', cpf: '52998224725' });
      await create(ctx, { name: 'Maria Souza', phone: '21944440002' });
      const find = async (q: string) =>
        (await get(ctx.accessToken, `/v1/customers?search=${encodeURIComponent(q)}`).expect(200)).body.data.map((c: { name: string }) => c.name);
      expect(await find('joão')).toEqual(['João da Silva']);
      expect(await find('SOUZA')).toEqual(['Maria Souza']);
      expect(await find('(11) 95555')).toEqual(['João da Silva']);
      expect(await find('4444')).toEqual(['Maria Souza']);
      expect(await find('EMPRESA.com')).toEqual(['João da Silva']);
      expect(await find('529.982')).toEqual(['João da Silva']);
      expect(await find('inexistente')).toEqual([]);
    });

    it('treats % and _ as plain text and tolerates odd input', async () => {
      const ctx = await setup();
      await create(ctx, { name: 'Ana' });
      for (const q of ['%', '_', '\\', "a'; DROP TABLE customers;--"]) {
        const res = await get(ctx.accessToken, `/v1/customers?search=${encodeURIComponent(q)}`).expect(200);
        expect([q, res.body.meta.total]).toEqual([q, 0]);
      }
      expect(await prisma().customer.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
    });

    it('paginates deterministically with a bounded page size, even with identical names', async () => {
      const ctx = await setup();
      for (let i = 0; i < 5; i++) await create(ctx, { name: 'Mesmo Nome' });
      const pages = [1, 2, 3].map((page) => get(ctx.accessToken, `/v1/customers?pageSize=2&page=${page}`));
      const [p1, p2, p3] = await Promise.all(pages.map(async (p) => (await p).body));
      expect(p1.meta).toMatchObject({ total: 5, totalPages: 3, pageSize: 2 });
      const ids = [...p1.data, ...p2.data, ...p3.data].map((c: { id: string }) => c.id);
      expect(new Set(ids).size).toBe(5);
      expect(p3.data).toHaveLength(1);
      // the paged order is the same total order as one big page
      const all = (await get(ctx.accessToken, '/v1/customers?pageSize=100').expect(200)).body.data.map((c: { id: string }) => c.id);
      expect(ids).toEqual(all);
      for (const bad of ['pageSize=101', 'pageSize=0', 'page=0', 'page=1001', 'status=weird', 'page=x']) {
        expect((await get(ctx.accessToken, `/v1/customers?${bad}`)).status).toBe(400);
      }
    });
  });

  describe('detail', () => {
    it('returns the full record with zeroed metrics for a customer without orders', async () => {
      const ctx = await setup();
      const c = await create(ctx, { cpf: '52998224725', notes: 'nota' });
      const res = await get(ctx.accessToken, `/v1/customers/${c.id}`).expect(200);
      expect(res.body).toMatchObject({ id: c.id, cpf: '52998224725', notes: 'nota' });
      expect(res.body.metrics).toEqual({ ordersCount: 0, cancelledCount: 0, totalSpentCents: 0, averageTicketCents: 0, firstOrderAt: null, lastOrderAt: null });
      const orders = await get(ctx.accessToken, `/v1/customers/${c.id}/orders`).expect(200);
      expect(orders.body).toEqual({ data: [], meta: { page: 1, pageSize: 20, total: 0, totalPages: 1 } });
    });

    it('answers 404 for unknown ids and 400 for malformed ones', async () => {
      const ctx = await setup();
      const unknown = '11111111-1111-4111-8111-111111111111';
      for (const path of [`/v1/customers/${unknown}`, `/v1/customers/${unknown}/orders`]) {
        const res = await get(ctx.accessToken, path).expect(404);
        expect(res.body.code).toBe('CUSTOMER_NOT_FOUND');
      }
      await patch(ctx.accessToken, `/v1/customers/${unknown}`, { name: 'Fantasma' }).expect(404);
      await get(ctx.accessToken, '/v1/customers/not-a-uuid').expect(400);
      await get(ctx.accessToken, '/v1/customers/not-a-uuid/orders').expect(400);
    });
  });

  describe('tenant isolation', () => {
    it('tenant A cannot read, list, search, edit or inactivate a customer of tenant B', async () => {
      const a = await setup();
      const b = await setup();
      const secret = await create(b, { name: 'Cliente do B', phone: '11912345678', cpf: '52998224725' });
      await get(a.accessToken, `/v1/customers/${secret.id}`).expect(404);
      await get(a.accessToken, `/v1/customers/${secret.id}/orders`).expect(404);
      await patch(a.accessToken, `/v1/customers/${secret.id}`, { name: 'Invadido' }).expect(404);
      await patch(a.accessToken, `/v1/customers/${secret.id}`, { active: false }).expect(404);
      const list = await get(a.accessToken, '/v1/customers?status=all&search=11912345678').expect(200);
      expect(list.body.meta.total).toBe(0);
      const after = await prisma().customer.findUniqueOrThrow({ where: { id: secret.id } });
      expect([after.name, after.active, after.tenantId]).toEqual(['Cliente do B', true, b.tenantId]);
    });
  });

  describe('permissions (backend)', () => {
    it('OWNER/ADMIN/MANAGER do everything, CASHIER reads and creates, everyone else gets 403', async () => {
      const ctx = await setup();
      const target = await create(ctx);
      const roles: [RoleName, { read: boolean; create: boolean; update: boolean }][] = [
        [RoleName.ADMIN, { read: true, create: true, update: true }],
        [RoleName.MANAGER, { read: true, create: true, update: true }],
        [RoleName.CASHIER, { read: true, create: true, update: false }],
        [RoleName.WAITER, { read: false, create: false, update: false }],
        [RoleName.KITCHEN, { read: false, create: false, update: false }],
        [RoleName.DELIVERY, { read: false, create: false, update: false }],
        [RoleName.VIEWER, { read: false, create: false, update: false }],
      ];
      for (const [role, allowed] of roles) {
        const token = await createStaffAndLoginE2E(app, server, ctx.tenantId, role, [ctx.branchId]);
        const list = await get(token, '/v1/customers');
        const detail = await get(token, `/v1/customers/${target.id}`);
        const orders = await get(token, `/v1/customers/${target.id}/orders`);
        const created = await post(token, '/v1/customers', body({ name: `Criado ${role}` }));
        const updated = await patch(token, `/v1/customers/${target.id}`, { notes: `nota ${role}` });
        expect([role, 'list', list.status === 200]).toEqual([role, 'list', allowed.read]);
        expect([role, 'detail', detail.status === 200]).toEqual([role, 'detail', allowed.read]);
        expect([role, 'orders', orders.status === 200]).toEqual([role, 'orders', allowed.read]);
        expect([role, 'create', created.status === 201]).toEqual([role, 'create', allowed.create]);
        expect([role, 'update', updated.status === 200]).toEqual([role, 'update', allowed.update]);
        if (!allowed.read) expect([list.status, detail.status, orders.status]).toEqual([403, 403, 403]);
        if (!allowed.create) expect(created.status).toBe(403);
        if (!allowed.update) expect(updated.status).toBe(403);
      }
      await get(ctx.accessToken, '/v1/customers').expect(200);
      const anon = await request(server).get('/v1/customers');
      expect(anon.status).toBe(401);
      expect((await request(server).post('/v1/customers').send(body())).status).toBe(401);
    });
  });

  describe('public endpoints do not expose customers', () => {
    it('the public menu and order responses carry no customer registry data and there is no public customers route', async () => {
      const ctx = await setup();
      const c = await create(ctx, { name: 'Sigilo Total', phone: '11933334444', cpf: '52998224725' });
      const menu = await request(server).get(`/v1/public/menu/${ctx.slug}`).expect(200);
      expect(JSON.stringify(menu.body)).not.toMatch(/Sigilo Total|11933334444|52998224725|customerId/);
      expect((await request(server).get('/v1/public/customers')).status).toBe(404);
      expect((await request(server).get(`/v1/public/customers/${c.id}`)).status).toBe(404);
    });
  });

  describe('audit is part of the transaction', () => {
    const failAudit = async (tenantId: string, action: string) => {
      await prisma().$executeRawUnsafe(
        `CREATE OR REPLACE FUNCTION fail_audit_customers_test() RETURNS trigger LANGUAGE plpgsql AS $fn$
         BEGIN
           IF NEW."tenantId" = '${tenantId}' AND NEW."action" = '${action}' THEN
             RAISE EXCEPTION 'audit failure injected by test';
           END IF;
           RETURN NEW;
         END $fn$`,
      );
      await prisma().$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_audit_customers_test ON audit_logs`);
      await prisma().$executeRawUnsafe(
        `CREATE TRIGGER fail_audit_customers_test BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION fail_audit_customers_test()`,
      );
    };
    const restoreAudit = async () => {
      await prisma().$executeRawUnsafe(`DROP TRIGGER IF EXISTS fail_audit_customers_test ON audit_logs`);
      await prisma().$executeRawUnsafe(`DROP FUNCTION IF EXISTS fail_audit_customers_test()`);
    };
    afterEach(restoreAudit);

    it('rolls back a creation when its audit cannot be written', async () => {
      const ctx = await setup();
      await failAudit(ctx.tenantId, 'CUSTOMER_CREATED');
      await post(ctx.accessToken, '/v1/customers', body()).expect(500);
      expect(await prisma().customer.count({ where: { tenantId: ctx.tenantId } })).toBe(0);
      await restoreAudit();
      await post(ctx.accessToken, '/v1/customers', body()).expect(201);
    });

    it.each(['CUSTOMER_UPDATED', 'CUSTOMER_DEACTIVATED'])('rolls back a change when %s cannot be audited', async (action) => {
      const ctx = await setup();
      const c = await create(ctx);
      await failAudit(ctx.tenantId, action);
      const change = action === 'CUSTOMER_UPDATED' ? { name: 'Novo Nome' } : { active: false };
      await patch(ctx.accessToken, `/v1/customers/${c.id}`, change).expect(500);
      const row = await prisma().customer.findUniqueOrThrow({ where: { id: c.id } });
      expect([row.name, row.active]).toEqual([c.name, true]);
      await restoreAudit();
      await patch(ctx.accessToken, `/v1/customers/${c.id}`, change).expect(200);
    });
  });
});
