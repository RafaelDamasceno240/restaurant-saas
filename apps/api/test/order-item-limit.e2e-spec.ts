import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createActiveProductE2E, createTestApp, getPrisma, registerTenantE2E, roundBody } from './test-app.util';

// B7 (piloto 2026-10-23): the cart and the PDV let one product reach 56 and 52 units, and the
// order then failed with "items.0.quantity must not be greater than 50". At most 50 units of a
// product, with a message in Portuguese, in the public order, the PDV and the tab, adding up the
// same product spread over several lines.
describe('At most 50 units of one product (e2e)', () => {
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

  function publicOrder(slug: string, items: { productId: string; quantity: number }[]) {
    return request(server)
      .post('/v1/public/orders')
      .send({
        restaurantSlug: slug,
        items,
        customer: { name: 'Cliente Teste', phone: '11987654321' },
        fulfillmentType: 'PICKUP',
        paymentMethod: 'PIX',
      });
  }
  function posOrder(token: string, branchId: string, items: { productId: string; quantity: number }[]) {
    return request(server)
      .post('/v1/pos/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({ branchId, paymentMethod: 'PIX', items });
  }
  const text = (body: { message?: unknown }) => JSON.stringify(body.message);

  it('public order: 50 units go through; 51, or 30 + 30 of the same product, are refused in Portuguese', async () => {
    const tenant = await registerTenantE2E(server);
    const product = await createActiveProductE2E(server, tenant.accessToken, 'Água', 4);
    const other = await createActiveProductE2E(server, tenant.accessToken, 'Suco', 6);

    const over = await publicOrder(tenant.slug, [{ productId: product.id, quantity: 51 }]).expect(400);
    expect(text(over.body)).toContain('No máximo 50 unidades de cada produto.');
    expect(text(over.body)).not.toContain('must not be greater');

    const split = await publicOrder(tenant.slug, [
      { productId: product.id, quantity: 30 },
      { productId: product.id, quantity: 30 },
    ]).expect(400);
    expect(split.body.code).toBe('QUANTITY_LIMIT');
    expect(split.body.message).toBe('No máximo 50 unidades de "Água" por pedido.');

    const ok = await publicOrder(tenant.slug, [
      { productId: product.id, quantity: 50 },
      { productId: other.id, quantity: 50 },
    ]).expect(201);
    expect(ok.body.items.map((i: { quantity: number }) => i.quantity)).toEqual([50, 50]);

    const orders = await getPrisma(app).order.count({ where: { tenantId: tenant.tenantId } });
    expect(orders).toBe(1);
  });

  it('PDV: the same limit, and the coupon preview uses it too', async () => {
    const tenant = await registerTenantE2E(server);
    const product = await createActiveProductE2E(server, tenant.accessToken, 'X-Burger', 20);

    const over = await posOrder(tenant.accessToken, tenant.branchId, [{ productId: product.id, quantity: 51 }]).expect(400);
    expect(text(over.body)).toContain('No máximo 50 unidades de cada produto.');
    const split = await posOrder(tenant.accessToken, tenant.branchId, [
      { productId: product.id, quantity: 25 },
      { productId: product.id, quantity: 26 },
    ]).expect(400);
    expect(split.body.code).toBe('QUANTITY_LIMIT');

    const preview = await request(server)
      .post('/v1/pos/orders/coupon-preview')
      .set('Authorization', `Bearer ${tenant.accessToken}`)
      .send({ branchId: tenant.branchId, couponCode: 'NAOEXISTE', items: [{ productId: product.id, quantity: 51 }] })
      .expect(400);
    expect(text(preview.body)).toContain('No máximo 50 unidades de cada produto.');

    const ok = await posOrder(tenant.accessToken, tenant.branchId, [{ productId: product.id, quantity: 50 }]).expect(201);
    expect(ok.body.items[0].quantity).toBe(50);
  });

  it('tab: 50 active units of a product over any number of rounds and lines, then no more', async () => {
    const tenant = await registerTenantE2E(server);
    const auth = { Authorization: `Bearer ${tenant.accessToken}` };
    const product = await createActiveProductE2E(server, tenant.accessToken, 'Chopp', 12);
    const other = await createActiveProductE2E(server, tenant.accessToken, 'Porção', 30);
    const table = (await request(server).post('/v1/tables').set(auth).send({ branchId: tenant.branchId, number: 7 }).expect(201)).body;
    const tab = (await request(server).post('/v1/tabs').set(auth).send({ branchId: tenant.branchId, tableId: table.id }).expect(201)).body;
    const send = (items: { productId: string; quantity: number }[]) =>
      request(server).post(`/v1/tabs/${tab.id}/rounds`).set(auth).send(roundBody(items));

    const over = await send([{ productId: product.id, quantity: 51 }]).expect(400);
    expect(text(over.body)).toContain('No máximo 50 unidades de cada produto.');
    // The same product over two lines of one round adds up.
    const split = await send([
      { productId: product.id, quantity: 30 },
      { productId: product.id, quantity: 21 },
    ]).expect(400);
    expect(split.body.message).toBe('No máximo 50 unidades de "Chopp" na comanda.');

    await send([{ productId: product.id, quantity: 25 }]).expect(201);
    await send([{ productId: product.id, quantity: 25 }]).expect(201);
    const full = await send([{ productId: product.id, quantity: 1 }]).expect(400);
    expect(full.body.code).toBe('QUANTITY_LIMIT');
    expect(full.body.message).toBe('No máximo 50 unidades de "Chopp" na comanda.');
    await send([{ productId: other.id, quantity: 50 }]).expect(201);

    const now = (await request(server).get(`/v1/tabs/${tab.id}`).set(auth).expect(200)).body;
    const chopp = now.items.filter((i: { name: string }) => i.name === 'Chopp');
    expect(chopp.reduce((sum: number, i: { quantity: number }) => sum + i.quantity, 0)).toBe(50);
  });
});
