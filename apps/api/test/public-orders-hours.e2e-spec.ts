import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  getPrisma,
  provisionAndSignInE2E,
  uniqueSuffix,
  uniqueDocument,
} from './test-app.util';

// B1 (piloto 2026-10-23): the public checkout follows the published opening hours, on the API.
// The hours are built around the CURRENT time on the restaurant's clock (São Paulo, the default
// time zone), so the suite does not depend on when it runs.
describe('Public orders vs opening hours (e2e)', () => {
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

  const DAY = 24 * 60;
  const WEEK = 7 * DAY;
  const hhmm = (minutes: number) => {
    const m = ((minutes % DAY) + DAY) % DAY;
    return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
  };

  // Minute of the week now in São Paulo (0 = Sunday 00:00).
  function nowInSaoPaulo(): number {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/Sao_Paulo',
      hourCycle: 'h23',
      weekday: 'short',
      hour: '2-digit',
      minute: '2-digit',
    }).formatToParts(new Date());
    const value = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
    const weekday = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(value('weekday'));
    return weekday * DAY + Number(value('hour')) * 60 + Number(value('minute'));
  }

  // One interval starting `startOffset` minutes from now and lasting `length` minutes.
  function interval(startOffset: number, length: number) {
    const start = (((nowInSaoPaulo() + startOffset) % WEEK) + WEEK) % WEEK;
    return { weekday: Math.floor(start / DAY), opens: hhmm(start), closes: hhmm(start + length) };
  }

  async function setup() {
    const suffix = uniqueSuffix();
    const slug = `hours-${suffix}`;
    const reg = await provisionAndSignInE2E(app, {
      tenantName: `Horario ${suffix}`,
      legalName: `Horario LTDA ${suffix}`,
      document: uniqueDocument(),
      slug,
      branchName: 'Matriz',
      userName: `Owner ${suffix}`,
      email: `owner-${suffix}@example.com`,
      password: 'Sup3rSecret!',
    });
    const token = reg.body.accessToken as string;
    // B11: delivery starts off for a new restaurant; the hours tests also try a delivery order.
    await getPrisma(app).branch.updateMany({ where: { tenant: { slug } }, data: { deliveryEnabled: true } });
    const category = await request(server).post('/v1/categories').set('Authorization', `Bearer ${token}`).send({ name: 'Lanches' }).expect(201);
    const product = await request(server)
      .post('/v1/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ categoryId: category.body.id, name: 'X-Burger', price: 20 })
      .expect(201);
    return { token, slug, productId: product.body.id as string };
  }

  const setHours = (token: string, openingHours: unknown) =>
    request(server).patch('/v1/tenants/current/profile').set('Authorization', `Bearer ${token}`).send({ openingHours }).expect(200);

  const order = (slug: string, productId: string, extra: Record<string, unknown> = {}) =>
    request(server)
      .post('/v1/public/orders')
      .send({
        restaurantSlug: slug,
        items: [{ productId, quantity: 1 }],
        customer: { name: 'Cliente Teste', phone: '11987654321' },
        fulfillmentType: 'PICKUP',
        paymentMethod: 'PIX',
        ...extra,
      });

  const orderCount = async (token: string) => {
    const res = await request(server).get('/v1/orders?pageSize=100').set('Authorization', `Bearer ${token}`).expect(200);
    return (res.body.meta?.total ?? res.body.data?.length) as number;
  };

  it('accepts orders when the hours were never informed (no restriction, like the menu)', async () => {
    const { slug, productId } = await setup();
    await order(slug, productId).expect(201);
  });

  it('accepts an order while the restaurant is open', async () => {
    const { token, slug, productId } = await setup();
    await setHours(token, [interval(-60, 120)]);
    const menu = await request(server).get(`/v1/public/menu/${slug}`).expect(200);
    expect(menu.body.restaurant.openNow).toBe(true);
    await order(slug, productId).expect(201);
  });

  it('refuses an order while closed, with a friendly message, and creates nothing', async () => {
    const { token, slug, productId } = await setup();
    await setHours(token, [interval(120, 60)]);
    const menu = await request(server).get(`/v1/public/menu/${slug}`).expect(200);
    expect(menu.body.restaurant.openNow).toBe(false);

    // A direct call to the API, with and without an idempotency key, cannot bypass it.
    const res = await order(slug, productId).expect(409);
    expect(res.body.code).toBe('RESTAURANT_CLOSED');
    expect(res.body.message).toMatch(/fechado/);
    await order(slug, productId, { idempotencyKey: `never-used-${uniqueSuffix()}` }).expect(409);
    await order(slug, productId, { fulfillmentType: 'DELIVERY', address: { street: 'Rua A', number: '1', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', zipCode: '01001-000' } }).expect(409);
    expect(await orderCount(token)).toBe(0);
  });

  it('refuses an empty week (closed every day)', async () => {
    const { token, slug, productId } = await setup();
    await setHours(token, []);
    const res = await order(slug, productId).expect(409);
    expect(res.body.code).toBe('RESTAURANT_CLOSED');
  });

  it('accepts inside an interval that crosses midnight', async () => {
    const { token, slug, productId } = await setup();
    // Opened 60-120 minutes ago and closes 30 minutes before it would open again: the interval
    // always runs past midnight into the next day (closes earlier than it opens).
    let hours = interval(-60, DAY - 30);
    for (const back of [-90, -120]) if (hours.closes >= hours.opens) hours = interval(back, DAY - 30);
    expect(hours.closes < hours.opens).toBe(true);
    await setHours(token, [hours]);
    await order(slug, productId).expect(201);
  });

  it('still answers a retry of an order taken while open, after closing', async () => {
    const { token, slug, productId } = await setup();
    await setHours(token, [interval(-60, 120)]);
    const key = `retry-${uniqueSuffix()}`;
    const first = await order(slug, productId, { idempotencyKey: key }).expect(201);
    await setHours(token, [interval(120, 60)]);
    const again = await order(slug, productId, { idempotencyKey: key }).expect(201);
    expect(again.body.id).toBe(first.body.id);
    expect(await orderCount(token)).toBe(1);
  });

  it('keeps the PDV available outside the published hours (staff flow)', async () => {
    const { token, productId } = await setup();
    await setHours(token, [interval(120, 60)]);
    const branches = await request(server).get('/v1/branches/accessible').set('Authorization', `Bearer ${token}`).expect(200);
    const branchId = (branches.body.data ?? branches.body)[0].id;
    await request(server)
      .post('/v1/pos/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ branchId, items: [{ productId, quantity: 1 }], paymentMethod: 'PIX' })
      .expect(201);
  });
});
