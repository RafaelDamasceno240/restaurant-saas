import { INestApplication } from '@nestjs/common';
import * as argon2 from 'argon2';
import request from 'supertest';
import {
  createActiveProductE2E,
  createStaffAndLoginE2E,
  createTestApp,
  getPrisma,
  registerTenantE2E,
  uniqueSuffix,
} from './test-app.util';

// GET /v1/orders/board: the kitchen screen's four columns in ONE request.
//
// Why it exists: requests are limited per route and per network address (100 a minute), and the
// screens of a restaurant usually leave through one address. Asking for each column separately
// every 5 seconds cost a kitchen screen 48 requests a minute on the list route, so two screens
// on the same Wi-Fi were refused. The second half of this file pins that arithmetic down
// against the real limiter.
describe('Orders board (e2e)', () => {
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

  const STATUSES = ['PENDING', 'CONFIRMED', 'PREPARING', 'READY'];
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const board = (target: any, token: string, query = '') => request(target).get(`/v1/orders/board${query}`).set(auth(token));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const list = (target: any, token: string, query = '') => request(target).get(`/v1/orders${query}`).set(auth(token));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function setup(target: any = server) {
    const tenant = await registerTenantE2E(target);
    const product = await createActiveProductE2E(target, tenant.accessToken, 'X-Burger', 20);
    return { ...tenant, product };
  }
  type Ctx = Awaited<ReturnType<typeof setup>>;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function placeOrder(ctx: Ctx, target: any = server): Promise<string> {
    const res = await request(target)
      .post('/v1/public/orders')
      .send({
        restaurantSlug: ctx.slug,
        items: [{ productId: ctx.product.id, quantity: 1 }],
        customer: { name: 'Cliente Quadro', phone: '11987654321' },
        fulfillmentType: 'PICKUP',
        paymentMethod: 'PIX',
      })
      .expect(201);
    return res.body.id as string;
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async function moveTo(ctx: Ctx, orderId: string, steps: string[], target: any = server) {
    for (const status of steps) {
      await request(target).patch(`/v1/orders/${orderId}/status`).set(auth(ctx.accessToken)).send({ status }).expect(200);
    }
  }
  type Column = { status: string; total: number; data: { id: string; branchId: string }[] };
  const idsOf = (body: { columns: Column[] }) => body.columns.flatMap((column) => column.data.map((order) => order.id));
  const column = (body: { columns: Column[] }, status: string) => body.columns.find((c) => c.status === status) as Column;

  describe('contents', () => {
    it('returns the four in-progress columns, in flow order, with exactly what the list returns', async () => {
      const ctx = await setup();
      const pending = await placeOrder(ctx);
      const confirmed = await placeOrder(ctx);
      const preparing = await placeOrder(ctx);
      const ready = await placeOrder(ctx);
      const completed = await placeOrder(ctx);
      const cancelled = await placeOrder(ctx);
      await moveTo(ctx, confirmed, ['CONFIRMED']);
      await moveTo(ctx, preparing, ['CONFIRMED', 'PREPARING']);
      await moveTo(ctx, ready, ['CONFIRMED', 'PREPARING', 'READY']);
      await moveTo(ctx, completed, ['CONFIRMED', 'PREPARING', 'READY', 'COMPLETED']);
      await moveTo(ctx, cancelled, ['CANCELLED']);

      const res = await board(server, ctx.accessToken).expect(200);
      expect(res.body.columnLimit).toBe(50);
      expect(res.body.columns.map((c: Column) => c.status)).toEqual(STATUSES);
      expect(column(res.body, 'PENDING').data.map((o) => o.id)).toEqual([pending]);
      expect(column(res.body, 'CONFIRMED').data.map((o) => o.id)).toEqual([confirmed]);
      expect(column(res.body, 'PREPARING').data.map((o) => o.id)).toEqual([preparing]);
      expect(column(res.body, 'READY').data.map((o) => o.id)).toEqual([ready]);
      expect(res.body.columns.map((c: Column) => c.total)).toEqual([1, 1, 1, 1]);
      // Finished and cancelled orders are not the kitchen's business.
      expect(idsOf(res.body)).not.toContain(completed);
      expect(idsOf(res.body)).not.toContain(cancelled);

      // Card for card, the board is what the screen used to assemble from four list calls.
      for (const status of STATUSES) {
        const listed = await list(server, ctx.accessToken, `?status=${status}&pageSize=50`).expect(200);
        expect(column(res.body, status).data).toEqual(listed.body.data);
      }
      // The cards carry the items, which is what the kitchen reads.
      expect(res.body.columns[0].data[0]).toMatchObject({ itemCount: 1, items: [{ name: 'X-Burger', quantity: 1 }] });
    });

    it('is empty, not an error, for a restaurant with no orders', async () => {
      const ctx = await setup();
      const res = await board(server, ctx.accessToken).expect(200);
      expect(res.body.columns).toEqual(STATUSES.map((status) => ({ status, total: 0, data: [] })));
    });

    it('shows the newest orders first and caps a column, saying how many there really are', async () => {
      const ctx = await setup();
      const ids: string[] = [];
      for (let i = 0; i < 52; i++) ids.push(await placeOrder(ctx));

      const res = await board(server, ctx.accessToken).expect(200);
      const pending = column(res.body, 'PENDING');
      expect(pending.total).toBe(52);
      expect(pending.data).toHaveLength(50);
      const listed = await list(server, ctx.accessToken, '?status=PENDING&pageSize=50').expect(200);
      expect(pending.data.map((o) => o.id)).toEqual(listed.body.data.map((o: { id: string }) => o.id));
      // The two oldest are the ones left out.
      expect(pending.data.map((o) => o.id)).not.toContain(ids[0]);
      expect(pending.data.map((o) => o.id)).not.toContain(ids[1]);
      expect(pending.data.map((o) => o.id)).toContain(ids[51]);
    });
  });

  describe('who may see what', () => {
    it('needs a session and orders.read', async () => {
      const ctx = await setup();
      await request(server).get('/v1/orders/board').expect(401);

      const kitchen = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'KITCHEN', [ctx.branchId]);
      await board(server, kitchen).expect(200);

      // An account with no role has no permission at all.
      const email = `sem-papel-${uniqueSuffix()}@example.com`;
      await getPrisma(app).user.create({
        data: { tenantId: ctx.tenantId, name: 'Sem Papel', email, passwordHash: await argon2.hash('Sup3rSecret!'), status: 'ACTIVE' },
      });
      const login = await request(server).post('/v1/auth/login').send({ email, password: 'Sup3rSecret!' }).expect(200);
      await board(server, login.body.accessToken).expect(403);
    });

    it('never shows another restaurant, and answers 404 for a branch that is not ours', async () => {
      const mine = await setup();
      const theirs = await setup();
      const myOrder = await placeOrder(mine);
      const theirOrder = await placeOrder(theirs);

      const myBoard = await board(server, mine.accessToken).expect(200);
      expect(idsOf(myBoard.body)).toEqual([myOrder]);
      const theirBoard = await board(server, theirs.accessToken).expect(200);
      expect(idsOf(theirBoard.body)).toEqual([theirOrder]);

      const foreign = await board(server, mine.accessToken, `?branchId=${theirs.branchId}`).expect(404);
      expect(foreign.body.code).toBe('BRANCH_NOT_FOUND');
    });

    it('shows staff only the branches they work in', async () => {
      const ctx = await setup();
      const second = await getPrisma(app).branch.create({
        data: { tenantId: ctx.tenantId, name: 'Filial', code: `FILIAL-${uniqueSuffix()}` },
      });
      const inMatriz = await placeOrder(ctx); // the online menu sells from the first branch
      const inFilial = (
        await request(server)
          .post('/v1/pos/orders')
          .set(auth(ctx.accessToken))
          .send({ branchId: second.id, items: [{ productId: ctx.product.id, quantity: 1 }], paymentMethod: 'PIX' })
          .expect(201)
      ).body.id as string;

      // The owner sees both, and can narrow to one.
      expect(idsOf((await board(server, ctx.accessToken).expect(200)).body).sort()).toEqual([inMatriz, inFilial].sort());
      expect(idsOf((await board(server, ctx.accessToken, `?branchId=${second.id}`).expect(200)).body)).toEqual([inFilial]);

      const kitchen = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'KITCHEN', [ctx.branchId]);
      expect(idsOf((await board(server, kitchen).expect(200)).body)).toEqual([inMatriz]);
      const denied = await board(server, kitchen, `?branchId=${second.id}`).expect(403);
      expect(denied.body.code).toBe('BRANCH_ACCESS_DENIED');
    });

    it('takes no status, page or size: the board cannot be turned into another listing', async () => {
      const ctx = await setup();
      await board(server, ctx.accessToken, '?status=COMPLETED').expect(400);
      await board(server, ctx.accessToken, '?pageSize=1000').expect(400);
      await board(server, ctx.accessToken, '?branchId=not-a-uuid').expect(400);
      await board(server, ctx.accessToken, `?tenantId=${ctx.tenantId}`).expect(400);
    });
  });

  // -----------------------------------------------------------------------------------------
  // Several screens behind ONE address, against the real rate limiter. Every request below
  // comes from the same address (the test client), which is exactly the situation of a
  // restaurant on one Wi-Fi. Each test boots its own application: the limiter counts in memory
  // per application, so each one starts from zero.
  // -----------------------------------------------------------------------------------------
  describe('several screens on the same address', () => {
    const POLLS_PER_MINUTE = 12; // one every 5 seconds
    const ROUTE_LIMIT = 100; // ThrottlerModule in app.module.ts: per route, per address, per minute

    async function freshApp() {
      const instance = await createTestApp();
      return { instance, target: instance.getHttpServer() };
    }

    it('six kitchen screens and ten other devices, each with its own user, poll for a minute and nobody is refused', async () => {
      const { instance, target } = await freshApp();
      try {
        const ctx = await setup(target);
        const order = await placeOrder(ctx, target);
        const kitchens = [];
        for (let i = 0; i < 6; i++) kitchens.push(await createStaffAndLoginE2E(instance, target, ctx.tenantId, 'KITCHEN', [ctx.branchId]));
        const others = [];
        for (let i = 0; i < 10; i++) others.push(await createStaffAndLoginE2E(instance, target, ctx.tenantId, 'WAITER', [ctx.branchId]));

        const statuses: number[] = [];
        for (let poll = 0; poll < POLLS_PER_MINUTE; poll++) {
          // Every screen polls at the same moment.
          const round = await Promise.all(kitchens.map((token) => board(target, token)));
          for (const res of round) {
            statuses.push(res.status);
            if (res.status === 200) expect(idsOf(res.body)).toEqual([order]);
          }
        }
        expect(statuses).toHaveLength(72);
        expect(statuses.every((status) => status === 200)).toBe(true);

        // Meanwhile every other device asks the list route for its "new orders" badge, 3 times a minute.
        const badge = [];
        for (let poll = 0; poll < 3; poll++) {
          badge.push(...(await Promise.all(others.map((token) => list(target, token, '?status=PENDING&pageSize=1')))));
        }
        expect(badge).toHaveLength(30);
        expect(badge.every((res) => res.status === 200)).toBe(true);
      } finally {
        await instance.close();
      }
    });

    it('what the screen did before did not fit: two screens asking for four columns are refused', async () => {
      const { instance, target } = await freshApp();
      try {
        const ctx = await setup(target);
        const kitchens = [
          await createStaffAndLoginE2E(instance, target, ctx.tenantId, 'KITCHEN', [ctx.branchId]),
          await createStaffAndLoginE2E(instance, target, ctx.tenantId, 'KITCHEN', [ctx.branchId]),
        ];
        const statuses: number[] = [];
        for (let poll = 0; poll < POLLS_PER_MINUTE; poll++) {
          for (const token of kitchens) {
            for (const status of STATUSES) statuses.push((await list(target, token, `?status=${status}&pageSize=50`)).status);
          }
        }
        // 2 screens x 4 columns x 12 polls = 96, plus each screen's badge 3 times = 102 on one route.
        for (let poll = 0; poll < 3; poll++) {
          for (const token of kitchens) statuses.push((await list(target, token, '?status=PENDING&pageSize=1')).status);
        }
        expect(statuses).toHaveLength(102);
        expect(statuses.filter((status) => status === 200)).toHaveLength(ROUTE_LIMIT);
        expect(statuses.filter((status) => status === 429)).toHaveLength(2);
        // The same two screens on the board route are nowhere near the limit, even now.
        for (const token of kitchens) await board(target, token).expect(200);
      } finally {
        await instance.close();
      }
    });

    it('the limit is still there: the 101st request of an address in a minute is refused, whoever asks and whatever it claims', async () => {
      const { instance, target } = await freshApp();
      try {
        const ctx = await setup(target);
        const other = await setup(target);
        const kitchen = await createStaffAndLoginE2E(instance, target, ctx.tenantId, 'KITCHEN', [ctx.branchId]);

        const statuses: number[] = [];
        for (let i = 0; i < ROUTE_LIMIT; i++) statuses.push((await board(target, kitchen)).status);
        expect(statuses.every((status) => status === 200)).toBe(true);

        await board(target, kitchen).expect(429);
        // Another user, and another restaurant, from the same address: same allowance, already spent.
        await board(target, ctx.accessToken).expect(429);
        await board(target, other.accessToken).expect(429);
        // An address the client made up buys nothing (no proxy is trusted here).
        await board(target, kitchen).set('X-Forwarded-For', '203.0.113.99').expect(429);
        await board(target, kitchen).set('X-Real-IP', '203.0.113.99').set('Forwarded', 'for=203.0.113.99').expect(429);
        // Without a session the answer is 401, never a way around the limit.
        await request(target).get('/v1/orders/board').expect(401);
        // The limit is per route: the rest of the system keeps working for this address.
        await list(target, kitchen).expect(200);
        await request(target).get('/v1/auth/me').set(auth(kitchen)).expect(200);
      } finally {
        await instance.close();
      }
    });

    it('two restaurants polling at the same time on one address never see each other', async () => {
      const { instance, target } = await freshApp();
      try {
        const first = await setup(target);
        const second = await setup(target);
        const firstOrders = [await placeOrder(first, target), await placeOrder(first, target)].sort();
        const secondOrders = [await placeOrder(second, target)].sort();
        const firstKitchens = [
          await createStaffAndLoginE2E(instance, target, first.tenantId, 'KITCHEN', [first.branchId]),
          await createStaffAndLoginE2E(instance, target, first.tenantId, 'KITCHEN', [first.branchId]),
        ];
        const secondKitchen = await createStaffAndLoginE2E(instance, target, second.tenantId, 'KITCHEN', [second.branchId]);

        // 10 rounds, 4 simultaneous requests each: 2 screens of one restaurant, 2 of the other.
        for (let round = 0; round < 10; round++) {
          const [a, b, c, d] = await Promise.all([
            board(target, firstKitchens[0]),
            board(target, secondKitchen),
            board(target, firstKitchens[1]),
            board(target, second.accessToken),
          ]);
          for (const res of [a, b, c, d]) expect(res.status).toBe(200);
          expect(idsOf(a.body).sort()).toEqual(firstOrders);
          expect(idsOf(c.body).sort()).toEqual(firstOrders);
          expect(idsOf(b.body).sort()).toEqual(secondOrders);
          expect(idsOf(d.body).sort()).toEqual(secondOrders);
        }
      } finally {
        await instance.close();
      }
    });
  });
});
