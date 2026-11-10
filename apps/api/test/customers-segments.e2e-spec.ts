import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createActiveProductE2E,
  createStaffAndLoginE2E,
  createTestApp,
  getPrisma,
  registerTenantE2E,
  uniqueSuffix,
  statusBody,
} from './test-app.util';

type Json = Record<string, unknown>;

// Fase 11, CRM avançado (1/2): segmentation, orderings by spend/ticket and "what the customer
// buys". Everything is derived from real orders in a real database; ages are produced by moving
// the orders' createdAt back, never by mocking the clock.
describe('Customers segmentation and rankings (e2e)', () => {
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

  let seq = 0;
  const phone = () => `117${String(Date.now() + ++seq).slice(-8)}`;
  const DAY = 86_400_000;

  interface Row {
    id: string;
    name: string;
    ordersCount: number;
    totalSpentCents: number;
    averageTicketCents: number;
    firstOrderAt: string | null;
    lastOrderAt: string | null;
    segments: string[];
  }

  async function newTenant() {
    const tenant = await registerTenantE2E(server);
    // 2500 and 1000 cents.
    const burger = await createActiveProductE2E(server, tenant.accessToken, `Burger ${uniqueSuffix()}`, 25);
    const soda = await createActiveProductE2E(server, tenant.accessToken, `Refri ${uniqueSuffix()}`, 10);
    return { ...tenant, burger, soda };
  }
  type Ctx = Awaited<ReturnType<typeof newTenant>>;

  const customer = async (ctx: Ctx, name: string) =>
    (await post(ctx.accessToken, '/v1/customers', { name, phone: phone() }).expect(201)).body as { id: string; name: string };

  // One PDV order for the customer, `daysAgo` days in the past.
  async function order(
    ctx: Ctx,
    customerId: string,
    daysAgo: number,
    items: { productId: string; quantity: number }[] = [{ productId: ctx.burger.id, quantity: 1 }],
    branchId: string = ctx.branchId,
  ) {
    const created = await post(ctx.accessToken, '/v1/pos/orders', {
      branchId,
      items,
      paymentMethod: 'PIX',
      customerId,
    }).expect(201);
    if (daysAgo > 0) {
      await prisma().order.update({
        where: { id: created.body.id },
        data: { createdAt: new Date(Date.now() - daysAgo * DAY) },
      });
    }
    return created.body as { id: string };
  }

  const cancel = (ctx: Ctx, orderId: string) =>
    patch(ctx.accessToken, `/v1/orders/${orderId}/status`, statusBody('CANCELLED')).expect(200);

  const list = async (token: string, query = '') => (await get(token, `/v1/customers${query}`).expect(200)).body as {
    data: Row[];
    meta: { total: number; totalPages: number; page: number };
    summary: { active: number; inactive: number };
  };
  const names = (rows: Row[]) => rows.map((row) => row.name);

  // The base every test of this block reads (created once: the block only reads it).
  //   Nova       1 order today                         -> NEW
  //   NovaFiel   2 orders this week                    -> NEW + RECURRING
  //   Fiel       3 orders: 200, 20 and 2 days ago      -> RECURRING
  //   Sumida     2 orders: 100 and 90 days ago         -> AT_RISK
  //   Antiga     1 order 300 days ago                  -> LOST
  //   Nunca      no order                              -> LOST
  //   Cancelou   1 cancelled order today               -> LOST (cancelled orders never count)
  //   Morna      1 order 45 days ago                   -> no segment
  //   Arquivada  inactive in the registry, 1 order now -> NEW, but out of the active counters
  describe('segments', () => {
    let ctx: Ctx;
    const ids: Record<string, string> = {};

    beforeAll(async () => {
      ctx = await newTenant();
      for (const name of ['Nova', 'NovaFiel', 'Fiel', 'Sumida', 'Antiga', 'Nunca', 'Cancelou', 'Morna', 'Arquivada']) {
        ids[name] = (await customer(ctx, name)).id;
      }
      await order(ctx, ids.Nova, 0);
      await order(ctx, ids.NovaFiel, 5);
      await order(ctx, ids.NovaFiel, 1, [{ productId: ctx.burger.id, quantity: 3 }]);
      await order(ctx, ids.Fiel, 200);
      await order(ctx, ids.Fiel, 20);
      await order(ctx, ids.Fiel, 2);
      await order(ctx, ids.Sumida, 100);
      await order(ctx, ids.Sumida, 90);
      await order(ctx, ids.Antiga, 300);
      await cancel(ctx, (await order(ctx, ids.Cancelou, 0)).id);
      await order(ctx, ids.Morna, 45);
      await order(ctx, ids.Arquivada, 0);
      await patch(ctx.accessToken, `/v1/customers/${ids.Arquivada}`, { active: false }).expect(200);
    });

    it('classifies every customer in the list and in the detail the same way', async () => {
      const all = await list(ctx.accessToken, '?status=all&pageSize=50');
      const byName = Object.fromEntries(all.data.map((row) => [row.name, row.segments]));
      expect(byName).toEqual({
        Nova: ['NEW'],
        NovaFiel: ['NEW', 'RECURRING'],
        Fiel: ['RECURRING'],
        Sumida: ['AT_RISK'],
        Antiga: ['LOST'],
        Nunca: ['LOST'],
        Cancelou: ['LOST'],
        Morna: [],
        Arquivada: ['NEW'],
      });
      for (const [name, id] of Object.entries(ids)) {
        const detail = await get(ctx.accessToken, `/v1/customers/${id}`).expect(200);
        expect(detail.body.segments).toEqual(byName[name]);
      }
    });

    it.each([
      ['NEW', ['Nova', 'NovaFiel']],
      ['RECURRING', ['Fiel', 'NovaFiel']],
      ['AT_RISK', ['Sumida']],
      ['LOST', ['Antiga', 'Cancelou', 'Nunca']],
    ])('filters %s among the active customers, and every row returned carries that segment', async (segment, expected) => {
      const page = await list(ctx.accessToken, `?segment=${segment}`);
      expect(names(page.data)).toEqual(expected);
      expect(page.meta.total).toBe(expected.length);
      expect(page.data.every((row) => row.segments.includes(segment))).toBe(true);
    });

    it('the tab counters follow the segment filter, and the status tab still applies', async () => {
      const active = await list(ctx.accessToken, '?segment=NEW');
      expect(active.summary).toEqual({ active: 2, inactive: 1 });
      expect(names((await list(ctx.accessToken, '?segment=NEW&status=inactive')).data)).toEqual(['Arquivada']);
      expect(names((await list(ctx.accessToken, '?segment=NEW&status=all')).data)).toEqual(['Arquivada', 'Nova', 'NovaFiel']);
    });

    it('combines segment and search', async () => {
      expect(names((await list(ctx.accessToken, '?segment=LOST&search=an')).data)).toEqual(['Antiga', 'Cancelou']);
      expect((await list(ctx.accessToken, '?segment=AT_RISK&search=nova')).data).toEqual([]);
    });

    it('counts the active customers of each segment', async () => {
      const summary = await get(ctx.accessToken, '/v1/customers/segments').expect(200);
      expect(summary.body).toEqual({ total: 8, segments: { NEW: 2, RECURRING: 2, AT_RISK: 1, LOST: 3 } });
    });

    it('rejects unknown segments and orderings', async () => {
      await get(ctx.accessToken, '/v1/customers?segment=VIP').expect(400);
      await get(ctx.accessToken, '/v1/customers?sort=password').expect(400);
      await get(ctx.accessToken, `/v1/customers?sort=${encodeURIComponent('name; DROP TABLE customers')}`).expect(400);
    });

    it('treats hostile search text as plain text, with any ordering and segment', async () => {
      for (const text of ["' OR 1=1 --", '%', '_', "'; DROP TABLE customers; --", '\\', '$1', 'a\'b"c']) {
        const page = await list(ctx.accessToken, `?search=${encodeURIComponent(text)}&sort=spent&segment=LOST`);
        expect(page.data).toEqual([]);
      }
      expect((await list(ctx.accessToken, '?status=all')).meta.total).toBe(9);
    });

    it('ages with time: the same customer changes segment when its last order gets older', async () => {
      const fresh = await newTenant();
      const c = await customer(fresh, 'Cliente Que Envelhece');
      const first = await order(fresh, c.id, 0);
      const segmentsNow = async () => (await get(fresh.accessToken, `/v1/customers/${c.id}`).expect(200)).body.segments;
      expect(await segmentsNow()).toEqual(['NEW']);
      const move = (days: number) =>
        prisma().order.update({ where: { id: first.id }, data: { createdAt: new Date(Date.now() - days * DAY) } });
      await move(31);
      expect(await segmentsNow()).toEqual([]);
      await move(61);
      expect(await segmentsNow()).toEqual(['AT_RISK']);
      await move(181);
      expect(await segmentsNow()).toEqual(['LOST']);
    });
  });

  describe('orderings: biggest spenders, highest ticket, most orders, most recent', () => {
    let ctx: Ctx;

    //   Ana    3 orders of 2500           -> spent 7500, ticket 2500, last 1 day ago
    //   Bia    1 order of 4 burgers       -> spent 10000, ticket 10000, last 10 days ago
    //   Caio   2 orders: 2500 and 1000    -> spent 3500, ticket 1750, last today
    //   Davi   no orders
    beforeAll(async () => {
      ctx = await newTenant();
      const ana = await customer(ctx, 'Ana');
      const bia = await customer(ctx, 'Bia');
      const caio = await customer(ctx, 'Caio');
      await customer(ctx, 'Davi');
      await order(ctx, ana.id, 9);
      await order(ctx, ana.id, 4);
      await order(ctx, ana.id, 1);
      await order(ctx, bia.id, 10, [{ productId: ctx.burger.id, quantity: 4 }]);
      await order(ctx, caio.id, 3);
      await order(ctx, caio.id, 0, [{ productId: ctx.soda.id, quantity: 1 }]);
    });

    it('returns the figures each ordering is based on', async () => {
      const rows = Object.fromEntries((await list(ctx.accessToken)).data.map((row) => [row.name, row]));
      expect([rows.Ana.ordersCount, rows.Ana.totalSpentCents, rows.Ana.averageTicketCents]).toEqual([3, 7500, 2500]);
      expect([rows.Bia.ordersCount, rows.Bia.totalSpentCents, rows.Bia.averageTicketCents]).toEqual([1, 10000, 10000]);
      expect([rows.Caio.ordersCount, rows.Caio.totalSpentCents, rows.Caio.averageTicketCents]).toEqual([2, 3500, 1750]);
      expect([rows.Davi.ordersCount, rows.Davi.totalSpentCents, rows.Davi.averageTicketCents]).toEqual([0, 0, 0]);
      expect(rows.Davi.firstOrderAt).toBeNull();
      expect(new Date(rows.Ana.firstOrderAt as string).getTime()).toBeLessThan(new Date(rows.Ana.lastOrderAt as string).getTime());
    });

    it.each([
      ['name', ['Ana', 'Bia', 'Caio', 'Davi']],
      ['spent', ['Bia', 'Ana', 'Caio', 'Davi']],
      ['ticket', ['Bia', 'Ana', 'Caio', 'Davi']],
      ['orders', ['Ana', 'Caio', 'Bia', 'Davi']],
      ['recent', ['Caio', 'Ana', 'Bia', 'Davi']],
    ])('sort=%s', async (sort, expected) => {
      expect(names((await list(ctx.accessToken, `?sort=${sort}`)).data)).toEqual(expected);
    });

    it('name is the default and the tie-break, so customers without orders stay in a stable order', async () => {
      await customer(ctx, 'Eva');
      expect(names((await list(ctx.accessToken)).data)).toEqual(['Ana', 'Bia', 'Caio', 'Davi', 'Eva']);
      expect(names((await list(ctx.accessToken, '?sort=spent')).data).slice(3)).toEqual(['Davi', 'Eva']);
    });

    it('paginates an ordering without overlap or gap', async () => {
      const seen: string[] = [];
      for (let page = 1; page <= 3; page++) {
        const result = await list(ctx.accessToken, `?sort=spent&pageSize=2&page=${page}`);
        expect(result.meta.total).toBe(5);
        expect(result.meta.totalPages).toBe(3);
        seen.push(...names(result.data));
      }
      expect(seen).toEqual(['Bia', 'Ana', 'Caio', 'Davi', 'Eva']);
      const beyond = await list(ctx.accessToken, '?sort=spent&pageSize=2&page=9');
      expect(beyond.data).toEqual([]);
      expect(beyond.meta.total).toBe(5);
    });

    it('a cancelled order leaves every figure and every ordering', async () => {
      const fresh = await newTenant();
      const a = await customer(fresh, 'Alfa');
      const b = await customer(fresh, 'Beta');
      await order(fresh, a.id, 0);
      const big = await order(fresh, b.id, 0, [{ productId: fresh.burger.id, quantity: 9 }]);
      expect(names((await list(fresh.accessToken, '?sort=spent')).data)).toEqual(['Beta', 'Alfa']);
      await cancel(fresh, big.id);
      const after = await list(fresh.accessToken, '?sort=spent');
      expect(names(after.data)).toEqual(['Alfa', 'Beta']);
      expect(after.data[1]).toMatchObject({ ordersCount: 0, totalSpentCents: 0, lastOrderAt: null });
    });
  });

  describe('what the customer buys', () => {
    it('ranks the products by quantity, ignoring cancelled orders, with the item value', async () => {
      const ctx = await newTenant();
      const c = await customer(ctx, 'Cliente Guloso');
      await order(ctx, c.id, 3, [
        { productId: ctx.burger.id, quantity: 2 },
        { productId: ctx.soda.id, quantity: 1 },
      ]);
      await order(ctx, c.id, 1, [{ productId: ctx.soda.id, quantity: 4 }]);
      const cancelled = await order(ctx, c.id, 0, [{ productId: ctx.burger.id, quantity: 50 }]);
      await cancel(ctx, cancelled.id);

      const detail = await get(ctx.accessToken, `/v1/customers/${c.id}`).expect(200);
      expect(detail.body.topProducts).toEqual([
        { productId: ctx.soda.id, name: expect.stringContaining('Refri'), quantity: 5, totalCents: 5000, timesOrdered: 2 },
        { productId: ctx.burger.id, name: expect.stringContaining('Burger'), quantity: 2, totalCents: 5000, timesOrdered: 1 },
      ]);
    });

    it('is empty for a customer without orders and never lists more than five products', async () => {
      const ctx = await newTenant();
      const none = await customer(ctx, 'Sem Pedidos');
      expect((await get(ctx.accessToken, `/v1/customers/${none.id}`).expect(200)).body.topProducts).toEqual([]);

      const many = await customer(ctx, 'Muitos Produtos');
      const items = [];
      for (let i = 1; i <= 7; i++) {
        const product = await createActiveProductE2E(server, ctx.accessToken, `Item ${i} ${uniqueSuffix()}`, 5);
        items.push({ productId: product.id, quantity: i });
      }
      await order(ctx, many.id, 0, items);
      const top = (await get(ctx.accessToken, `/v1/customers/${many.id}`).expect(200)).body.topProducts as { quantity: number }[];
      expect(top.map((product) => product.quantity)).toEqual([7, 6, 5, 4, 3]);
    });

    it('never mixes another customer or another tenant into the ranking', async () => {
      const ctx = await newTenant();
      const mine = await customer(ctx, 'Minha Cliente');
      const other = await customer(ctx, 'Outra Cliente');
      await order(ctx, mine.id, 0, [{ productId: ctx.soda.id, quantity: 1 }]);
      await order(ctx, other.id, 0, [{ productId: ctx.burger.id, quantity: 8 }]);

      const stranger = await newTenant();
      const theirs = await customer(stranger, 'Cliente de Outro Restaurante');
      await order(stranger, theirs.id, 0, [{ productId: stranger.burger.id, quantity: 9 }]);

      const top = (await get(ctx.accessToken, `/v1/customers/${mine.id}`).expect(200)).body.topProducts;
      expect(top).toEqual([expect.objectContaining({ productId: ctx.soda.id, quantity: 1 })]);
      await get(ctx.accessToken, `/v1/customers/${theirs.id}`).expect(404);
    });
  });

  describe('isolation', () => {
    it('another tenant never shows up in the list, the counters or the orderings', async () => {
      const a = await newTenant();
      const b = await newTenant();
      const mine = await customer(a, 'Cliente A');
      const theirs = await customer(b, 'Cliente B');
      await order(a, mine.id, 0);
      await order(b, theirs.id, 0, [{ productId: b.burger.id, quantity: 20 }]);

      for (const query of ['', '?sort=spent', '?segment=NEW', '?status=all&sort=ticket']) {
        expect(names((await list(a.accessToken, query)).data)).toEqual(['Cliente A']);
      }
      expect((await get(a.accessToken, '/v1/customers/segments').expect(200)).body).toEqual({
        total: 1,
        segments: { NEW: 1, RECURRING: 0, AT_RISK: 0, LOST: 0 },
      });
      // A tenantId in the query string is not a way in.
      await get(a.accessToken, `/v1/customers?tenantId=${b.tenantId}`).expect(400);
    });

    it('a branch-limited manager is measured on the orders of their own branches only', async () => {
      const ctx = await newTenant();
      const second = await prisma().branch.create({ data: { tenantId: ctx.tenantId, name: 'Filial', code: 'FILIAL' } });
      const manager = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'MANAGER', [second.id]);
      const c = await customer(ctx, 'Cliente das Duas Unidades');
      await order(ctx, c.id, 0, [{ productId: ctx.burger.id, quantity: 4 }]); // matriz: 10000
      await order(ctx, c.id, 0, [{ productId: ctx.soda.id, quantity: 1 }], second.id); // filial: 1000
      const onlyMatriz = await customer(ctx, 'Cliente So da Matriz');
      await order(ctx, onlyMatriz.id, 0);

      const owner = await list(ctx.accessToken, '?sort=spent');
      expect(owner.data.map((row) => [row.name, row.totalSpentCents])).toEqual([
        ['Cliente das Duas Unidades', 11000],
        ['Cliente So da Matriz', 2500],
      ]);

      const scoped = await list(manager, '?sort=spent');
      expect(scoped.data.map((row) => [row.name, row.totalSpentCents, row.segments])).toEqual([
        ['Cliente das Duas Unidades', 1000, ['NEW']],
        ['Cliente So da Matriz', 0, ['LOST']],
      ]);
      expect((await get(manager, '/v1/customers/segments').expect(200)).body.segments).toEqual({
        NEW: 1,
        RECURRING: 0,
        AT_RISK: 0,
        LOST: 1,
      });
      const detail = await get(manager, `/v1/customers/${c.id}`).expect(200);
      expect(detail.body.topProducts).toEqual([expect.objectContaining({ productId: ctx.soda.id, quantity: 1 })]);
    });

    it('needs customers.read', async () => {
      const ctx = await newTenant();
      const kitchen = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'KITCHEN', [ctx.branchId]);
      const cashier = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'CASHIER', [ctx.branchId]);
      await get(kitchen, '/v1/customers/segments').expect(403);
      await get(kitchen, '/v1/customers?segment=NEW').expect(403);
      await get(cashier, '/v1/customers/segments').expect(200);
      await request(server).get('/v1/customers/segments').expect(401);
    });
  });
});
