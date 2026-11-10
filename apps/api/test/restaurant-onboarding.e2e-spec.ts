import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createActiveProductE2E, createTestApp, getPrisma, registerTenantE2E } from './test-app.util';

// B11 (piloto 2026-10-23): a new restaurant started with delivery ON, fee R$ 0,00 and no minimum,
// so it could open with free delivery without noticing. Now delivery starts OFF and is turned on
// by the owner after setting the fee and the minimum. Pickup works from the start.
describe('New restaurant: delivery starts off (e2e)', () => {
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

  const address = { street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'São Paulo', state: 'SP', zipCode: '01001-000' };

  it('delivery is off, pickup works; after fee, minimum and "on", delivery works with them', async () => {
    const tenant = await registerTenantE2E(server, { delivery: false });
    const auth = { Authorization: `Bearer ${tenant.accessToken}` };
    const product = await createActiveProductE2E(server, tenant.accessToken, 'X-Burger', 20);
    const order = (body: Record<string, unknown>) =>
      request(server)
        .post('/v1/public/orders')
        .send({
          restaurantSlug: tenant.slug,
          items: [{ productId: product.id, quantity: 1 }],
          customer: { name: 'Cliente Teste', phone: '11987654321' },
          paymentMethod: 'PIX',
          ...body,
        });

    const settings = await request(server).get('/v1/delivery/settings').query({ branchId: tenant.branchId }).set(auth).expect(200);
    expect(settings.body).toEqual({ branchId: tenant.branchId, enabled: false, feeCents: 0, minOrderCents: 0 });
    const menu = await request(server).get(`/v1/public/menu/${tenant.slug}`).expect(200);
    expect(menu.body.delivery.enabled).toBe(false);

    const refused = await order({ fulfillmentType: 'DELIVERY', address }).expect(400);
    expect(refused.body.code).toBe('DELIVERY_UNAVAILABLE');
    await order({ fulfillmentType: 'PICKUP' }).expect(201);

    await request(server)
      .put('/v1/delivery/settings')
      .set(auth)
      .send({ branchId: tenant.branchId, enabled: true, feeCents: 700, minOrderCents: 3000 })
      .expect(200);
    const below = await order({ fulfillmentType: 'DELIVERY', address }).expect(400);
    expect(below.body.code).toBe('DELIVERY_MIN_ORDER_NOT_MET');
    const ok = await order({ fulfillmentType: 'DELIVERY', address, items: [{ productId: product.id, quantity: 2 }] }).expect(201);
    expect(ok.body.deliveryFee).toBe(7);
    expect(ok.body.total).toBe(47);
  });

  it('only registration changed: the column default still keeps delivery on for any other branch', async () => {
    const tenant = await registerTenantE2E(server, { delivery: false });
    const branch = await getPrisma(app).branch.create({ data: { tenantId: tenant.tenantId, name: 'Filial', code: `F${Date.now() % 100000}` } });
    expect(branch.deliveryEnabled).toBe(true);
    await getPrisma(app).branch.delete({ where: { id: branch.id } });
  });
});
