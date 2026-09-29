import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, uniqueSuffix, uniqueDocument } from './test-app.util';

describe('Public menu (e2e)', () => {
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
    return { accessToken: res.body.accessToken as string, slug, tenantName: payload.tenantName };
  }

  async function createCategory(token: string, name: string, opts: { active?: boolean } = {}) {
    const res = await request(server)
      .post('/v1/categories')
      .set('Authorization', `Bearer ${token}`)
      .send({ name, active: opts.active });
    return res.body;
  }

  async function createProduct(
    token: string,
    categoryId: string,
    name: string,
    price: number,
    opts: { active?: boolean } = {},
  ) {
    const res = await request(server)
      .post('/v1/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ categoryId, name, price, active: opts.active });
    return res.body;
  }

  it('returns 404 for a slug that does not exist — no auth required to hit the route', async () => {
    // No Authorization header at all: confirms the route itself is public.
    await request(server).get('/v1/public/menu/does-not-exist-slug').expect(404);
  });

  it('returns the public menu shape for an existing restaurant, without auth', async () => {
    const { accessToken, slug, tenantName } = await registerTenant();
    const category = await createCategory(accessToken, 'Hambúrgueres');
    await createProduct(accessToken, category.id, 'X-Burger', 24.9);

    const res = await request(server).get(`/v1/public/menu/${slug}`).expect(200);

    expect(res.body.restaurant).toEqual({ name: tenantName, slug });
    expect(res.body.categories).toHaveLength(1);
    const [returnedCategory] = res.body.categories;
    expect(returnedCategory.name).toBe('Hambúrgueres');
    expect(returnedCategory.products).toHaveLength(1);
    expect(returnedCategory.products[0]).toMatchObject({
      name: 'X-Burger',
      price: 24.9,
    });

    // No internal/administrative fields ever leave this endpoint.
    expect(res.body.restaurant).not.toHaveProperty('id');
    expect(returnedCategory).not.toHaveProperty('tenantId');
    expect(returnedCategory).not.toHaveProperty('active');
    expect(returnedCategory).not.toHaveProperty('displayOrder');
    expect(returnedCategory.products[0]).not.toHaveProperty('tenantId');
    expect(returnedCategory.products[0]).not.toHaveProperty('active');
    expect(returnedCategory.products[0]).not.toHaveProperty('categoryId');
  });

  it('hides an inactive category entirely, even if it has active products', async () => {
    const { accessToken, slug } = await registerTenant();
    const inactiveCategory = await createCategory(accessToken, 'Escondida', { active: false });
    await createProduct(accessToken, inactiveCategory.id, 'Produto Fantasma', 10);
    const visibleCategory = await createCategory(accessToken, 'Visível');
    await createProduct(accessToken, visibleCategory.id, 'Produto Visível', 15);

    const res = await request(server).get(`/v1/public/menu/${slug}`).expect(200);

    const names = res.body.categories.map((c: { name: string }) => c.name);
    expect(names).toEqual(['Visível']);
  });

  it('hides an inactive product but keeps the category if another product is active', async () => {
    const { accessToken, slug } = await registerTenant();
    const category = await createCategory(accessToken, 'Bebidas');
    await createProduct(accessToken, category.id, 'Refrigerante', 8, { active: false });
    await createProduct(accessToken, category.id, 'Suco Natural', 9);

    const res = await request(server).get(`/v1/public/menu/${slug}`).expect(200);

    expect(res.body.categories).toHaveLength(1);
    const productNames = res.body.categories[0].products.map((p: { name: string }) => p.name);
    expect(productNames).toEqual(['Suco Natural']);
  });

  it('hides a category whose only products are all inactive (no empty sections)', async () => {
    const { accessToken, slug } = await registerTenant();
    const category = await createCategory(accessToken, 'Sobremesas');
    await createProduct(accessToken, category.id, 'Pudim', 12, { active: false });

    const res = await request(server).get(`/v1/public/menu/${slug}`).expect(200);
    expect(res.body.categories).toEqual([]);
  });

  it('orders categories and products by displayOrder then name', async () => {
    const { accessToken, slug } = await registerTenant();

    // Both categories default to displayOrder=0, so ties break by name.
    // catB gets no products, so it won't appear in the public response at
    // all (empty categories are hidden) — this test only asserts ordering
    // among what *does* appear.
    await createCategory(accessToken, 'B Categoria');
    const catA = await createCategory(accessToken, 'A Categoria');

    await createProduct(accessToken, catA.id, 'Zebra', 5);
    await createProduct(accessToken, catA.id, 'Abacaxi', 5);

    const res = await request(server).get(`/v1/public/menu/${slug}`).expect(200);

    const categoryNames = res.body.categories.map((c: { name: string }) => c.name);
    expect(categoryNames).toEqual(['A Categoria']);

    const productNames = res.body.categories[0].products.map((p: { name: string }) => p.name);
    expect(productNames).toEqual(['Abacaxi', 'Zebra']);
  });

  it('returns a product image URL when set, and null when not', async () => {
    const { accessToken, slug } = await registerTenant();
    const category = await createCategory(accessToken, 'Com e sem foto');
    await request(server)
      .post('/v1/products')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        categoryId: category.id,
        name: 'Com Foto',
        price: 10,
        imageUrl: 'https://exemplo.com/foto.jpg',
      })
      .expect(201);
    await createProduct(accessToken, category.id, 'Sem Foto', 10);

    const res = await request(server).get(`/v1/public/menu/${slug}`).expect(200);
    const products = res.body.categories[0].products as { name: string; imageUrl: string | null }[];
    expect(products.find((p) => p.name === 'Com Foto')?.imageUrl).toBe(
      'https://exemplo.com/foto.jpg',
    );
    expect(products.find((p) => p.name === 'Sem Foto')?.imageUrl).toBeNull();
  });
});
