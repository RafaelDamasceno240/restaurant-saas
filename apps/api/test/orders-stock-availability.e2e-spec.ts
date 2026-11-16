import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createActiveProductE2E, createTestApp, getPrisma, registerTenantE2E, statusBody } from './test-app.util';

// B2 (piloto 2026-10-23): an order that consumes its recipe only when confirmed is refused when
// TAKEN if the stock cannot cover it, counting what the other PENDING orders already need.
describe('Stock availability when an order is taken (e2e)', () => {
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

  // A restaurant whose "Milkshake" takes 0.3 L of ice cream, with `litres` in stock.
  async function setup(litres: number) {
    const tenant = await registerTenantE2E(server);
    const t = tenant.accessToken;
    const shake = await createActiveProductE2E(server, t, 'Milkshake', 15);
    const water = await createActiveProductE2E(server, t, 'Água', 4);
    const iceCream = await request(server).post('/v1/inventory/items').set(auth(t)).send({ name: 'Sorvete', unit: 'L' }).expect(201);
    await request(server)
      .put(`/v1/inventory/recipes/${shake.id}`)
      .set(auth(t))
      .send({ items: [{ inventoryItemId: iceCream.body.id, quantity: 0.3 }] })
      .expect(200);
    if (litres > 0) {
      await request(server)
        .post('/v1/inventory/movements')
        .set(auth(t))
        .send({ branchId: tenant.branchId, inventoryItemId: iceCream.body.id, type: 'ENTRY', quantity: litres, unitCostCents: 1800 })
        .expect(201);
    }
    return { ...tenant, shake, water, iceCreamId: iceCream.body.id as string };
  }

  const publicOrder = (slug: string, items: { productId: string; quantity: number }[]) =>
    request(server)
      .post('/v1/public/orders')
      .send({ restaurantSlug: slug, items, customer: { name: 'Cliente Teste', phone: '11987654321' }, fulfillmentType: 'PICKUP', paymentMethod: 'PIX' });

  const orderCount = async (tenantId: string) => getPrisma(app).order.count({ where: { tenantId } });

  it('accepts a product with enough stock', async () => {
    const { slug, shake } = await setup(0.9);
    await publicOrder(slug, [{ productId: shake.id, quantity: 3 }]).expect(201);
  });

  it('refuses a product with no stock, naming it, without quantities, and creates nothing', async () => {
    const { slug, tenantId, shake, water } = await setup(0);
    const res = await publicOrder(slug, [
      { productId: water.id, quantity: 1 },
      { productId: shake.id, quantity: 1 },
    ]).expect(409);
    expect(res.body.code).toBe('PRODUCT_OUT_OF_STOCK');
    expect(res.body.message).toContain('"Milkshake"');
    expect(res.body.message).not.toMatch(/\d/);
    expect(JSON.stringify(res.body)).not.toMatch(/Sorvete|0\.3|saldo/);
    expect(await orderCount(tenantId)).toBe(0);
  });

  it('refuses a quantity larger than the stock and accepts the quantity that fits', async () => {
    const { slug, shake } = await setup(0.9);
    expect((await publicOrder(slug, [{ productId: shake.id, quantity: 4 }]).expect(409)).body.code).toBe('PRODUCT_OUT_OF_STOCK');
    await publicOrder(slug, [{ productId: shake.id, quantity: 3 }]).expect(201);
  });

  it('counts what the PENDING orders already need: the second order cannot take the same units', async () => {
    const { slug, shake } = await setup(0.9);
    await publicOrder(slug, [{ productId: shake.id, quantity: 2 }]).expect(201);
    expect((await publicOrder(slug, [{ productId: shake.id, quantity: 2 }]).expect(409)).body.code).toBe('PRODUCT_OUT_OF_STOCK');
    await publicOrder(slug, [{ productId: shake.id, quantity: 1 }]).expect(201);
  });

  it('two (and five) orders at the same moment never take more than the stock, and every taken order can be confirmed', async () => {
    const { slug, accessToken, branchId, tenantId, shake, iceCreamId } = await setup(0.9);
    const results = await Promise.all(Array.from({ length: 5 }, () => publicOrder(slug, [{ productId: shake.id, quantity: 1 }])));
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([201, 201, 201, 409, 409]);
    expect(await orderCount(tenantId)).toBe(3);
    for (const r of results.filter((x) => x.status === 201)) {
      await request(server).patch(`/v1/orders/${r.body.id}/status`).set(auth(accessToken)).send({ status: 'CONFIRMED' }).expect(200);
    }
    const balance = await getPrisma(app).inventoryBalance.findFirst({ where: { branchId, inventoryItemId: iceCreamId } });
    expect(Number(balance!.quantity)).toBe(0);

    const pair = await setup(0.3);
    const both = await Promise.all([1, 2].map(() => publicOrder(pair.slug, [{ productId: pair.shake.id, quantity: 1 }])));
    expect(both.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('a cancelled PENDING order gives its units back to new orders', async () => {
    const { slug, accessToken, shake } = await setup(0.3);
    const first = await publicOrder(slug, [{ productId: shake.id, quantity: 1 }]).expect(201);
    await publicOrder(slug, [{ productId: shake.id, quantity: 1 }]).expect(409);
    await request(server).patch(`/v1/orders/${first.body.id}/status`).set(auth(accessToken)).send(statusBody('CANCELLED')).expect(200);
    await publicOrder(slug, [{ productId: shake.id, quantity: 1 }]).expect(201);
  });

  it('applies to the PDV too, and does not restrict a branch that allows negative stock or a product without recipe', async () => {
    const { slug, accessToken, branchId, shake, water } = await setup(0);
    const pdv = await request(server)
      .post('/v1/pos/orders')
      .set(auth(accessToken))
      .send({ branchId, items: [{ productId: shake.id, quantity: 1 }], paymentMethod: 'PIX' })
      .expect(409);
    expect(pdv.body.code).toBe('PRODUCT_OUT_OF_STOCK');
    await publicOrder(slug, [{ productId: water.id, quantity: 50 }]).expect(201);

    await request(server).patch('/v1/inventory/settings').set(auth(accessToken)).send({ branchId, allowNegativeStock: true }).expect(200);
    await publicOrder(slug, [{ productId: shake.id, quantity: 1 }]).expect(201);
  });
});
