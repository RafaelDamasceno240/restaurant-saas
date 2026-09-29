import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, uniqueSuffix, uniqueDocument } from './test-app.util';

describe('Public orders (checkout) (e2e)', () => {
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

  async function registerTenant() {
    const suffix = uniqueSuffix();
    const slug = `tenant-${suffix}`;
    const payload = {
      tenantName: `Restaurante ${suffix}`,
      legalName: `Restaurante LTDA ${suffix}`,
      document: uniqueDocument(),
      slug,
      branchName: 'Matriz',
      userName: `Owner ${suffix}`,
      email: `owner-${suffix}@example.com`,
      password: 'Sup3rSecret!',
    };
    const res = await request(server).post('/v1/auth/register').send(payload).expect(201);
    return { accessToken: res.body.accessToken as string, slug };
  }

  async function createActiveProduct(token: string, name: string, price: number, active = true) {
    const category = await request(server)
      .post('/v1/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: `Categoria ${name}` })
      .expect(201);
    const product = await request(server)
      .post('/v1/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ categoryId: category.body.id, name, price, active })
      .expect(201);
    return product.body as { id: string; price: number };
  }

  function guestCustomer() {
    return { name: 'Cliente Teste', phone: '11987654321' };
  }

  function pickupPayload(slug: string, items: { productId: string; quantity: number }[]) {
    return {
      restaurantSlug: slug,
      items,
      customer: guestCustomer(),
      fulfillmentType: 'PICKUP',
      paymentMethod: 'CASH',
    };
  }

  it('creates a PICKUP order and recalculates the total correctly from DB prices', async () => {
    const { accessToken, slug } = await registerTenant();
    const burger = await createActiveProduct(accessToken, 'X-Burger', 24.9);
    const fries = await createActiveProduct(accessToken, 'Batata', 12.0);

    const res = await request(server)
      .post('/v1/public/orders')
      .send(
        pickupPayload(slug, [
          { productId: burger.id, quantity: 2 },
          { productId: fries.id, quantity: 1 },
        ]),
      )
      .expect(201);

    expect(res.body.orderNumber).toBeDefined();
    expect(res.body.status).toBe('PENDING');
    expect(res.body.address).toBeNull();
    expect(res.body.subtotal).toBeCloseTo(24.9 * 2 + 12.0);
    expect(res.body.total).toBeCloseTo(24.9 * 2 + 12.0);
    const itemNames = res.body.items.map((i: { name: string }) => i.name).sort();
    expect(itemNames).toEqual(['Batata', 'X-Burger'].sort());
  });

  it('creates a DELIVERY order with address', async () => {
    const { accessToken, slug } = await registerTenant();
    const burger = await createActiveProduct(accessToken, 'X-Burger', 24.9);

    const res = await request(server)
      .post('/v1/public/orders')
      .send({
        restaurantSlug: slug,
        items: [{ productId: burger.id, quantity: 1 }],
        customer: guestCustomer(),
        fulfillmentType: 'DELIVERY',
        paymentMethod: 'PIX',
        address: {
          street: 'Rua das Flores',
          number: '123',
          neighborhood: 'Centro',
          city: 'São Paulo',
          state: 'SP',
          zipCode: '01310-100',
        },
        notes: 'Sem cebola',
      })
      .expect(201);

    expect(res.body.address).toMatchObject({ street: 'Rua das Flores', city: 'São Paulo' });
    expect(res.body.notes).toBe('Sem cebola');
  });

  it('rejects DELIVERY without an address', async () => {
    const { accessToken, slug } = await registerTenant();
    const burger = await createActiveProduct(accessToken, 'X-Burger', 24.9);

    await request(server)
      .post('/v1/public/orders')
      .send({
        restaurantSlug: slug,
        items: [{ productId: burger.id, quantity: 1 }],
        customer: guestCustomer(),
        fulfillmentType: 'DELIVERY',
        paymentMethod: 'CASH',
      })
      .expect(400);
  });

  it('accepts PICKUP without an address', async () => {
    const { accessToken, slug } = await registerTenant();
    const burger = await createActiveProduct(accessToken, 'X-Burger', 24.9);
    await request(server)
      .post('/v1/public/orders')
      .send(pickupPayload(slug, [{ productId: burger.id, quantity: 1 }]))
      .expect(201);
  });

  it('rejects a nonexistent product (whole order fails, nothing partial)', async () => {
    const { slug } = await registerTenant();
    await request(server)
      .post('/v1/public/orders')
      .send(pickupPayload(slug, [{ productId: '00000000-0000-0000-0000-000000000000', quantity: 1 }]))
      .expect(400);
  });

  it('rejects an inactive product', async () => {
    const { accessToken, slug } = await registerTenant();
    const inactive = await createActiveProduct(accessToken, 'Descontinuado', 10, false);
    await request(server)
      .post('/v1/public/orders')
      .send(pickupPayload(slug, [{ productId: inactive.id, quantity: 1 }]))
      .expect(400);
  });

  it("rejects a product that belongs to a DIFFERENT tenant than restaurantSlug", async () => {
    const tenantA = await registerTenant();
    const tenantB = await registerTenant();
    const productB = await createActiveProduct(tenantB.accessToken, 'Produto B', 10);

    // Attempting to order tenant B's product under tenant A's slug.
    await request(server)
      .post('/v1/public/orders')
      .send(pickupPayload(tenantA.slug, [{ productId: productB.id, quantity: 1 }]))
      .expect(400);
  });

  it('rejects invalid quantity (zero, negative, over the cap)', async () => {
    const { accessToken, slug } = await registerTenant();
    const product = await createActiveProduct(accessToken, 'Produto', 10);

    await request(server)
      .post('/v1/public/orders')
      .send(pickupPayload(slug, [{ productId: product.id, quantity: 0 }]))
      .expect(400);
    await request(server)
      .post('/v1/public/orders')
      .send(pickupPayload(slug, [{ productId: product.id, quantity: -1 }]))
      .expect(400);
    await request(server)
      .post('/v1/public/orders')
      .send(pickupPayload(slug, [{ productId: product.id, quantity: 51 }]))
      .expect(400);
  });

  it('rejects an empty items array and a nonexistent restaurantSlug', async () => {
    const { slug } = await registerTenant();
    await request(server).post('/v1/public/orders').send(pickupPayload(slug, [])).expect(400);
    await request(server)
      .post('/v1/public/orders')
      .send(pickupPayload('does-not-exist-slug', []))
      .expect(400); // items empty is caught before slug lookup would even matter
  });

  it('returns 404 for a valid-shaped order against a nonexistent restaurant', async () => {
    await request(server)
      .post('/v1/public/orders')
      .send(pickupPayload('does-not-exist-slug', [{ productId: '00000000-0000-0000-0000-000000000000', quantity: 1 }]))
      .expect(404);
  });

  // MANDATORY per this slice's spec (section 19/20): the client can never
  // dictate price. Even if it sends a `priceCents` alongside a legitimate
  // productId/quantity, the backend must silently ignore it and use the
  // product's real, current price from the database.
  it('MANDATORY: ignores a client-supplied price and uses the DB price instead', async () => {
    const { accessToken, slug } = await registerTenant();
    const product = await createActiveProduct(accessToken, 'Produto Caro', 29.9);

    const res = await request(server)
      .post('/v1/public/orders')
      .send({
        restaurantSlug: slug,
        items: [
          {
            productId: product.id,
            quantity: 1,
            // Tampering attempt: real price is 2990 cents (R$ 29,90).
            priceCents: 100,
            price: 1.0,
            subtotal: 1.0,
          },
        ],
        customer: guestCustomer(),
        fulfillmentType: 'PICKUP',
        paymentMethod: 'CASH',
        // Also attempt to dictate the order total directly.
        total: 1.0,
        subtotalCents: 100,
      })
      .expect(201);

    expect(res.body.items[0].unitPrice).toBe(29.9);
    expect(res.body.subtotal).toBe(29.9);
    expect(res.body.total).toBe(29.9);
  });

  it('GET /public/orders/:slug/:orderId returns the order for the confirmation page', async () => {
    const { accessToken, slug } = await registerTenant();
    const product = await createActiveProduct(accessToken, 'Produto', 15);
    const created = await request(server)
      .post('/v1/public/orders')
      .send(pickupPayload(slug, [{ productId: product.id, quantity: 1 }]))
      .expect(201);

    const fetched = await request(server)
      .get(`/v1/public/orders/${slug}/${created.body.id}`)
      .expect(200);
    expect(fetched.body.orderNumber).toBe(created.body.orderNumber);
    // Everything the confirmation page actually renders must survive.
    expect(fetched.body.status).toBeDefined();
    expect(fetched.body.items).toHaveLength(1);
    expect(fetched.body.total).toBe(created.body.total);
    expect(fetched.body.fulfillmentType).toBe('PICKUP');
    expect(fetched.body.paymentMethod).toBe('CASH');
  });

  // Regression test for the privacy fix: this route has no auth and no
  // secret token, so anyone with the order id (shared link, browser
  // history, a guess) can reach it — customerName/customerPhone must never
  // be in this response, even though they legitimately are in the create
  // response the customer gets back synchronously right after checkout.
  it('MANDATORY: GET /public/orders/:slug/:orderId never exposes customerName or customerPhone', async () => {
    const { accessToken, slug } = await registerTenant();
    const product = await createActiveProduct(accessToken, 'Produto', 15);
    const created = await request(server)
      .post('/v1/public/orders')
      .send({
        ...pickupPayload(slug, [{ productId: product.id, quantity: 1 }]),
        customer: { name: 'Cliente Sigiloso', phone: '11999998888' },
      })
      .expect(201);

    // The creation response itself legitimately includes these — the
    // customer is reading back what they just typed.
    expect(created.body.customerName).toBe('Cliente Sigiloso');
    expect(created.body.customerPhone).toBe('11999998888');

    const fetched = await request(server)
      .get(`/v1/public/orders/${slug}/${created.body.id}`)
      .expect(200);
    expect(fetched.body).not.toHaveProperty('customerName');
    expect(fetched.body).not.toHaveProperty('customerPhone');
    expect(JSON.stringify(fetched.body)).not.toContain('Cliente Sigiloso');
    expect(JSON.stringify(fetched.body)).not.toContain('11999998888');
  });

  it('GET /public/orders/:slug/:orderId returns 404 for another restaurant\'s slug', async () => {
    const tenantA = await registerTenant();
    const tenantB = await registerTenant();
    const productA = await createActiveProduct(tenantA.accessToken, 'Produto A', 15);
    const created = await request(server)
      .post('/v1/public/orders')
      .send(pickupPayload(tenantA.slug, [{ productId: productA.id, quantity: 1 }]))
      .expect(201);

    await request(server).get(`/v1/public/orders/${tenantB.slug}/${created.body.id}`).expect(404);
  });
});
