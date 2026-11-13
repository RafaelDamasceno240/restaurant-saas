import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createActiveProductE2E,
  createTestApp,
  getPrisma,
  registerTenantE2E,
} from './test-app.util';

// Product photos everywhere the staff and the customer see a product (correcao-fotos-produtos).
// The public menu already showed the uploaded/imported photo (media_assets) and fell back to the
// pasted link; the PDV (GET /products -> photoUrl), the recipes list and the WhatsApp checkout link
// now resolve the photo the same way, so imported products (imageMediaId only, imageUrl empty) stop
// showing the generic icon. The photo itself is never copied: every screen points at the same
// public media URL.
describe('Product photos (e2e)', () => {
  let app: INestApplication;
  let server: ReturnType<INestApplication['getHttpServer']>;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });
  afterAll(async () => {
    await app.close();
  });

  // Smallest valid PNG (1x1).
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5a5d3500000000049454e44ae426082',
    'hex',
  );
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const MEDIA = /^\/api\/public\/media\/[0-9a-f-]{36}$/;

  it('PDV list, recipes list and public menu show the same photo: uploaded/imported, pasted link or none', async () => {
    const t = await registerTenantE2E(server);
    const prisma = getPrisma(app);

    // 1) uploaded/imported photo: stored once in media_assets, imageUrl stays empty (like the importer)
    const imported = await createActiveProductE2E(server, t.accessToken, 'Smash Importado', 30);
    const up = await request(server)
      .put(`/v1/products/${imported.id}/photo`)
      .set(auth(t.accessToken))
      .attach('file', png, { filename: 'foto.png', contentType: 'image/png' })
      .expect(200);
    expect(up.body.photoUrl).toMatch(MEDIA);
    const row = await prisma.product.findUniqueOrThrow({ where: { id: imported.id } });
    expect(row.imageUrl).toBeNull();
    expect(row.imageMediaId).not.toBeNull();

    // 2) pasted link only
    const pasted = await createActiveProductE2E(server, t.accessToken, 'Suco Link', 9);
    await request(server)
      .patch(`/v1/products/${pasted.id}`)
      .set(auth(t.accessToken))
      .send({ imageUrl: 'https://imagens.example.com/suco.jpg' })
      .expect(200);

    // 3) no photo at all
    const none = await createActiveProductE2E(server, t.accessToken, 'Água Sem Foto', 4);

    const expected = {
      [imported.id]: up.body.photoUrl,
      [pasted.id]: 'https://imagens.example.com/suco.jpg',
      [none.id]: null,
    };

    // PDV source: GET /products -> photoUrl
    const products = (
      await request(server).get('/v1/products').set(auth(t.accessToken)).expect(200)
    ).body;
    const productList = Array.isArray(products) ? products : (products.items ?? products.data);
    for (const [id, url] of Object.entries(expected)) {
      expect(productList.find((p: { id: string }) => p.id === id).photoUrl).toBe(url);
    }

    // Recipes (fichas técnicas) list: imageUrl is now the resolved photo too
    const recipes = (
      await request(server)
        .get(`/v1/inventory/recipes?branchId=${t.branchId}`)
        .set(auth(t.accessToken))
        .expect(200)
    ).body;
    for (const [id, url] of Object.entries(expected)) {
      expect(recipes.find((r: { productId: string }) => r.productId === id).imageUrl).toBe(url);
    }

    // Public menu: unchanged behaviour, same URLs
    const menu = (await request(server).get(`/v1/public/menu/${t.slug}`).expect(200)).body;
    const menuProducts = menu.categories.flatMap((c: { products: { id: string }[] }) => c.products);
    for (const [id, url] of Object.entries(expected)) {
      expect(menuProducts.find((p: { id: string }) => p.id === id).imageUrl).toBe(url);
    }

    // The URL serves the image itself, publicly, and only that (no internal path is exposed).
    const served = await request(server)
      .get(`/v1/public/media/${up.body.photoUrl.split('/').pop()}`)
      .expect(200);
    expect(served.headers['content-type']).toBe('image/png');
    expect(JSON.stringify(recipes)).not.toMatch(/var\/lib|media_assets|data:image/);
  });

  it("another restaurant never sees this restaurant's products or photos in its lists", async () => {
    const a = await registerTenantE2E(server);
    const b = await registerTenantE2E(server);
    const p = await createActiveProductE2E(server, a.accessToken, 'Burger da Casa A', 30);
    const up = await request(server)
      .put(`/v1/products/${p.id}/photo`)
      .set(auth(a.accessToken))
      .attach('file', png, { filename: 'foto.png', contentType: 'image/png' })
      .expect(200);

    const bProducts = (
      await request(server).get('/v1/products').set(auth(b.accessToken)).expect(200)
    ).body;
    const bRecipes = (
      await request(server)
        .get(`/v1/inventory/recipes?branchId=${b.branchId}`)
        .set(auth(b.accessToken))
        .expect(200)
    ).body;
    expect(JSON.stringify(bProducts)).not.toContain(p.id);
    expect(JSON.stringify(bRecipes)).not.toContain(p.id);
    expect(JSON.stringify(bProducts)).not.toContain(up.body.photoUrl);
    expect(JSON.stringify(bRecipes)).not.toContain(up.body.photoUrl);
  });
});
