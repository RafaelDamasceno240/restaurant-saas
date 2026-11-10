import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createTestApp,
  provisionAndSignInE2E,
  uniqueDocument,
  uniqueSuffix,
} from './test-app.util';

describe('Menu (categories + products) (e2e)', () => {
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
    const payload = {
      tenantName: `Tenant ${suffix}`,
      legalName: `Tenant LTDA ${suffix}`,
      document: uniqueDocument(),
      slug: `tenant-${suffix}`,
      branchName: 'Matriz',
      userName: `Owner ${suffix}`,
      email: `owner-${suffix}@example.com`,
      password: 'Sup3rSecret!',
    };
    const res = await provisionAndSignInE2E(app, payload);
    return { accessToken: res.body.accessToken as string };
  }

  async function createCategory(accessToken: string, name = `Categoria ${uniqueSuffix()}`) {
    const res = await request(server)
      .post('/v1/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name })
      .expect(201);
    return res.body;
  }

  it('creates, lists, edits and deletes a category', async () => {
    const { accessToken } = await registerTenant();
    const category = await createCategory(accessToken, 'Bebidas');
    expect(category.active).toBe(true);
    expect(category.displayOrder).toBe(0);

    const list = await request(server)
      .get('/v1/categories')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);
    expect(list.body.map((c: { id: string }) => c.id)).toContain(category.id);

    const edited = await request(server)
      .patch(`/v1/categories/${category.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Bebidas Geladas', active: false })
      .expect(200);
    expect(edited.body.name).toBe('Bebidas Geladas');
    expect(edited.body.active).toBe(false);

    await request(server)
      .delete(`/v1/categories/${category.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    await request(server)
      .get(`/v1/categories/${category.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(404);
  });

  it('creates a product under its own category, converts price to/from cents correctly', async () => {
    const { accessToken } = await registerTenant();
    const category = await createCategory(accessToken);

    const res = await request(server)
      .post('/v1/products')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ categoryId: category.id, name: 'X-Burger', price: 24.9 })
      .expect(201);

    expect(res.body.price).toBe(24.9);
    expect(res.body.categoryId).toBe(category.id);
    expect(res.body.categoryName).toBe(category.name);

    const edited = await request(server)
      .patch(`/v1/products/${res.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ price: 19.9, active: false })
      .expect(200);
    expect(edited.body.price).toBe(19.9);
    expect(edited.body.active).toBe(false);

    await request(server)
      .delete(`/v1/products/${res.body.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);
  });

  it('rejects deleting a category that still has products (409)', async () => {
    const { accessToken } = await registerTenant();
    const category = await createCategory(accessToken);
    await request(server)
      .post('/v1/products')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ categoryId: category.id, name: 'Produto', price: 10 })
      .expect(201);

    await request(server)
      .delete(`/v1/categories/${category.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(409);
  });

  it('tenant A cannot read, edit or delete tenant B\'s category', async () => {
    const tenantA = await registerTenant();
    const tenantB = await registerTenant();
    const categoryB = await createCategory(tenantB.accessToken);

    await request(server)
      .get(`/v1/categories/${categoryB.id}`)
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .expect(404);

    await request(server)
      .patch(`/v1/categories/${categoryB.id}`)
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .send({ name: 'Hijack' })
      .expect(404);

    await request(server)
      .delete(`/v1/categories/${categoryB.id}`)
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .expect(404);
  });

  // MANDATORY per this slice's spec: a product must never be creatable (or
  // editable) pointing at another tenant's category.
  it('tenant A cannot create a product using tenant B\'s category', async () => {
    const tenantA = await registerTenant();
    const tenantB = await registerTenant();
    const categoryB = await createCategory(tenantB.accessToken);

    await request(server)
      .post('/v1/products')
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .send({ categoryId: categoryB.id, name: 'Produto Invasor', price: 10 })
      .expect(404);
  });

  it('tenant A cannot move its own product onto tenant B\'s category via PATCH', async () => {
    const tenantA = await registerTenant();
    const categoryA = await createCategory(tenantA.accessToken);
    const tenantB = await registerTenant();
    const categoryB = await createCategory(tenantB.accessToken);

    const product = await request(server)
      .post('/v1/products')
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .send({ categoryId: categoryA.id, name: 'Produto A', price: 10 })
      .expect(201);

    await request(server)
      .patch(`/v1/products/${product.body.id}`)
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .send({ categoryId: categoryB.id })
      .expect(404);
  });

  it('tenant A cannot read tenant B\'s product', async () => {
    const tenantA = await registerTenant();
    const tenantB = await registerTenant();
    const categoryB = await createCategory(tenantB.accessToken);
    const productB = await request(server)
      .post('/v1/products')
      .set('Authorization', `Bearer ${tenantB.accessToken}`)
      .send({ categoryId: categoryB.id, name: 'Produto B', price: 10 })
      .expect(201);

    await request(server)
      .get(`/v1/products/${productB.body.id}`)
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .expect(404);
  });

  it('rejects unauthenticated access to categories and products', async () => {
    await request(server).get('/v1/categories').expect(401);
    await request(server).get('/v1/products').expect(401);
    await request(server).post('/v1/categories').send({ name: 'X' }).expect(401);
  });

  it('rejects an invalid product payload (negative price, missing name)', async () => {
    const { accessToken } = await registerTenant();
    const category = await createCategory(accessToken);

    await request(server)
      .post('/v1/products')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ categoryId: category.id, name: '', price: -5 })
      .expect(400);
  });

  // B6 (piloto 2026-10-23): R$ 0,00 was accepted and shown on the public menu for free.
  it('refuses a price below R$ 0,01 on create and on edit, and accepts exactly R$ 0,01', async () => {
    const { accessToken } = await registerTenant();
    const category = await createCategory(accessToken);
    const auth = { Authorization: `Bearer ${accessToken}` };

    for (const price of [0, -0.01, 0.001, 0.009]) {
      const res = await request(server)
        .post('/v1/products')
        .set(auth)
        .send({ categoryId: category.id, name: `Grátis ${price}`, price })
        .expect(400);
      expect(JSON.stringify(res.body.message)).toContain('R$ 0,01');
    }

    const cent = await request(server)
      .post('/v1/products')
      .set(auth)
      .send({ categoryId: category.id, name: 'Bala', price: 0.01 })
      .expect(201);
    expect(cent.body.price).toBe(0.01);

    await request(server).patch(`/v1/products/${cent.body.id}`).set(auth).send({ price: 0 }).expect(400);
    const after = await request(server).get(`/v1/products/${cent.body.id}`).set(auth).expect(200);
    expect(after.body.price).toBe(0.01);

    const list = await request(server).get('/v1/products').set(auth).expect(200);
    const products = Array.isArray(list.body) ? list.body : list.body.data;
    expect(products.some((p: { price: number }) => p.price < 0.01)).toBe(false);
  });
});
