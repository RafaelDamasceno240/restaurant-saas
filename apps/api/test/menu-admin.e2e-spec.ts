import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createActiveProductE2E,
  createStaffAndLoginE2E,
  createTestApp,
  getPrisma,
  registerTenantE2E,
} from './test-app.util';

// Menu administration from the panel: product fields (promotion, sold out, highlight, photo,
// order), add-on groups and options, the restaurant's look (logo, cover, color), and who may do
// each of them. Everything is checked through the API and then on the public menu / order.
describe('Menu administration (e2e)', () => {
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

  // Smallest valid PNG (1x1) and JPEG headers: the API decides by the bytes, never by the name.
  const png = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8cfc0f01f0005000201a5a5d3500000000049454e44ae426082',
    'hex',
  );
  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('outra foto')]);

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const menuOf = async (slug: string) =>
    (await request(server).get(`/v1/public/menu/${slug}`).expect(200)).body;
  const publicProduct = async (slug: string, id: string) =>
    (await menuOf(slug)).categories
      .flatMap((c: { products: { id: string }[] }) => c.products)
      .find((p: { id: string }) => p.id === id);

  describe('products', () => {
    it('promotion, sold out and highlight are saved, validated and shown on the public menu', async () => {
      const t = await registerTenantE2E(server);
      const p = await createActiveProductE2E(server, t.accessToken, 'Bacon Melt', 32);

      const saved = await request(server)
        .patch(`/v1/products/${p.id}`)
        .set(auth(t.accessToken))
        .send({ compareAtPrice: 35, featured: true, description: 'Blend 160g' })
        .expect(200);
      expect(saved.body).toMatchObject({
        price: 32,
        compareAtPrice: 35,
        featured: true,
        soldOut: false,
        description: 'Blend 160g',
        photoUrl: null,
        optionGroupIds: [],
        imported: false,
      });
      expect(await publicProduct(t.slug, p.id)).toMatchObject({
        price: 32,
        compareAtPrice: 35,
        featured: true,
        soldOut: false,
      });

      // The "de" price must stay above the price, even when only the price changes.
      const below = await request(server)
        .patch(`/v1/products/${p.id}`)
        .set(auth(t.accessToken))
        .send({ price: 36 })
        .expect(400);
      expect(below.body.code).toBe('PROMOTION_PRICE_INVALID');
      await request(server)
        .patch(`/v1/products/${p.id}`)
        .set(auth(t.accessToken))
        .send({ compareAtPrice: 32 })
        .expect(400);

      // Sold out: still listed, cannot be ordered. Clearing promotion and description with null.
      await request(server)
        .patch(`/v1/products/${p.id}`)
        .set(auth(t.accessToken))
        .send({ soldOut: true, compareAtPrice: null, description: null })
        .expect(200);
      expect(await publicProduct(t.slug, p.id)).toMatchObject({
        soldOut: true,
        compareAtPrice: null,
        description: null,
      });
      await request(server)
        .post('/v1/public/orders')
        .send({
          restaurantSlug: t.slug,
          items: [{ productId: p.id, quantity: 1 }],
          customer: { name: 'Cliente', phone: '11987654321' },
          fulfillmentType: 'PICKUP',
          paymentMethod: 'PIX',
        })
        .expect((res) => expect(res.status).toBeGreaterThanOrEqual(400));
    });

    it('photo: upload, same picture stored once, bad files refused, removal', async () => {
      const t = await registerTenantE2E(server);
      const p = await createActiveProductE2E(server, t.accessToken, 'Burger Tudo', 34);

      const up = await request(server)
        .put(`/v1/products/${p.id}/photo`)
        .set(auth(t.accessToken))
        .attach('file', png, { filename: 'foto.txt', contentType: 'text/plain' })
        .expect(200);
      expect(up.body.photoUrl).toMatch(/^\/api\/public\/media\/[0-9a-f-]{36}$/);
      expect(up.body.hasUploadedPhoto).toBe(true);
      const mediaId = up.body.photoUrl.split('/').pop();
      const served = await request(server).get(`/v1/public/media/${mediaId}`).expect(200);
      expect(served.headers['content-type']).toBe('image/png');
      expect((await publicProduct(t.slug, p.id)).imageUrl).toBe(up.body.photoUrl);

      // The same bytes again: the same stored image, not a copy.
      const again = await request(server)
        .put(`/v1/products/${p.id}/photo`)
        .set(auth(t.accessToken))
        .attach('file', png, 'outra.png')
        .expect(200);
      expect(again.body.photoUrl).toBe(up.body.photoUrl);
      expect(await getPrisma(app).mediaAsset.count({ where: { tenantId: t.tenantId } })).toBe(1);

      // Not an image (an SVG/HTML named .png), too large, missing, or extra fields: refused.
      const svg = await request(server)
        .put(`/v1/products/${p.id}/photo`)
        .set(auth(t.accessToken))
        .attach('file', Buffer.from('<svg onload="alert(1)"/>'), {
          filename: 'x.png',
          contentType: 'image/png',
        })
        .expect(400);
      expect(svg.body.code).toBe('IMAGE_INVALID');
      const big = await request(server)
        .put(`/v1/products/${p.id}/photo`)
        .set(auth(t.accessToken))
        .attach('file', Buffer.concat([png, Buffer.alloc(3 * 1024 * 1024)]), 'grande.png')
        .expect(413);
      expect(big.body.code).toBe('IMAGE_TOO_LARGE');
      expect(big.body.message).toMatch(/3 MB/);
      const none = await request(server)
        .put(`/v1/products/${p.id}/photo`)
        .set(auth(t.accessToken))
        .expect(400);
      expect(none.body.code).toBe('IMAGE_REQUIRED');
      const extra = await request(server)
        .put(`/v1/products/${p.id}/photo`)
        .set(auth(t.accessToken))
        .field('tenantId', 'outro')
        .attach('file', png, 'foto.png')
        .expect(400);
      expect(extra.body.code).toBe('IMAGE_UPLOAD_INVALID');
      // The refused uploads did not change the photo.
      expect((await publicProduct(t.slug, p.id)).imageUrl).toBe(up.body.photoUrl);

      const removed = await request(server)
        .delete(`/v1/products/${p.id}/photo`)
        .set(auth(t.accessToken))
        .expect(200);
      expect(removed.body.photoUrl).toBeNull();
      expect((await publicProduct(t.slug, p.id)).imageUrl).toBeNull();
    });

    it('order inside a category and of the categories; an outdated list is refused', async () => {
      const t = await registerTenantE2E(server);
      const category = await request(server)
        .post('/v1/categories')
        .set(auth(t.accessToken))
        .send({ name: 'Burgers' })
        .expect(201);
      const ids: string[] = [];
      for (const name of ['A', 'B', 'C']) {
        const res = await request(server)
          .post('/v1/products')
          .set(auth(t.accessToken))
          .send({ categoryId: category.body.id, name, price: 10 })
          .expect(201);
        ids.push(res.body.id);
      }
      await request(server)
        .post('/v1/products/reorder')
        .set(auth(t.accessToken))
        .send({ categoryId: category.body.id, productIds: [ids[2], ids[0], ids[1]] })
        .expect(200);
      const menu = await menuOf(t.slug);
      expect(menu.categories[0].products.map((p: { name: string }) => p.name)).toEqual([
        'C',
        'A',
        'B',
      ]);
      const outdated = await request(server)
        .post('/v1/products/reorder')
        .set(auth(t.accessToken))
        .send({ categoryId: category.body.id, productIds: [ids[0], ids[1]] })
        .expect(409);
      expect(outdated.body.code).toBe('PRODUCT_ORDER_OUTDATED');

      const second = await request(server)
        .post('/v1/categories')
        .set(auth(t.accessToken))
        .send({ name: 'Bebidas' })
        .expect(201);
      await request(server)
        .post('/v1/products')
        .set(auth(t.accessToken))
        .send({ categoryId: second.body.id, name: 'Refri', price: 6 })
        .expect(201);
      await request(server)
        .post('/v1/categories/reorder')
        .set(auth(t.accessToken))
        .send({ categoryIds: [second.body.id, category.body.id] })
        .expect(200);
      expect((await menuOf(t.slug)).categories.map((c: { name: string }) => c.name)).toEqual([
        'Bebidas',
        'Burgers',
      ]);
    });
  });

  describe('add-on groups', () => {
    async function setupGroups() {
      const t = await registerTenantE2E(server);
      const burger = await createActiveProductE2E(server, t.accessToken, 'Burger Tudo', 34);
      const combo = await createActiveProductE2E(server, t.accessToken, 'Combo', 15);
      const turbine = await request(server)
        .post('/v1/option-groups')
        .set(auth(t.accessToken))
        .send({ name: '  Turbine seu lanche! ', minSelect: 0, maxSelect: 3 })
        .expect(201);
      expect(turbine.body).toMatchObject({
        name: 'Turbine seu lanche!',
        required: false,
        options: [],
      });
      let g = await request(server)
        .post(`/v1/option-groups/${turbine.body.id}/options`)
        .set(auth(t.accessToken))
        .send({ name: 'Bacon', price: 4, maxQuantity: 2 })
        .expect(201);
      g = await request(server)
        .post(`/v1/option-groups/${turbine.body.id}/options`)
        .set(auth(t.accessToken))
        .send({ name: 'Ovo', price: 2 })
        .expect(201);
      const [bacon, ovo] = g.body.options;
      const refri = await request(server)
        .post('/v1/option-groups')
        .set(auth(t.accessToken))
        .send({ name: 'Refrigerante', minSelect: 1, maxSelect: 1 })
        .expect(201);
      // Required with nothing to choose: saved, with a warning for the panel.
      expect(refri.body.required).toBe(true);
      expect(refri.body.warnings).toEqual([expect.stringMatching(/esgotados/)]);
      const withCoca = await request(server)
        .post(`/v1/option-groups/${refri.body.id}/options`)
        .set(auth(t.accessToken))
        .send({ name: 'Coca lata', price: 0 })
        .expect(201);
      expect(withCoca.body.warnings).toEqual([]);
      return {
        ...t,
        burger,
        combo,
        turbine: turbine.body,
        refri: withCoca.body,
        bacon,
        ovo,
        coca: withCoca.body.options[0],
      };
    }

    const order = (slug: string, items: unknown[]) =>
      request(server)
        .post('/v1/public/orders')
        .send({
          restaurantSlug: slug,
          items,
          customer: { name: 'Cliente Teste', phone: '11987654321' },
          fulfillmentType: 'PICKUP',
          paymentMethod: 'PIX',
        });

    it('ranges are validated; groups are linked to products from either side, in order', async () => {
      const t = await setupGroups();
      for (const bad of [
        { minSelect: 2, maxSelect: 1 },
        { minSelect: 0, maxSelect: 0 },
        { minSelect: -1, maxSelect: 2 },
        { minSelect: 0, maxSelect: 51 },
      ]) {
        await request(server)
          .patch(`/v1/option-groups/${t.turbine.id}`)
          .set(auth(t.accessToken))
          .send(bad)
          .expect(400);
      }
      await request(server)
        .post(`/v1/option-groups/${t.turbine.id}/options`)
        .set(auth(t.accessToken))
        .send({ name: 'Negativo', price: -1 })
        .expect(400);

      // From the product: its groups, in order.
      const linked = await request(server)
        .put(`/v1/products/${t.combo.id}/option-groups`)
        .set(auth(t.accessToken))
        .send({ groupIds: [t.refri.id, t.turbine.id] })
        .expect(200);
      expect(linked.body.optionGroupIds).toEqual([t.refri.id, t.turbine.id]);
      // From the group: which products offer it (the burger gets it last, the combo keeps it).
      const group = await request(server)
        .put(`/v1/option-groups/${t.turbine.id}/products`)
        .set(auth(t.accessToken))
        .send({ productIds: [t.burger.id, t.combo.id] })
        .expect(200);
      expect(group.body.productIds.sort()).toEqual([t.burger.id, t.combo.id].sort());
      const combo = await publicProduct(t.slug, t.combo.id);
      expect(combo.optionGroups.map((g: { name: string }) => g.name)).toEqual([
        'Refrigerante',
        'Turbine seu lanche!',
      ]);
      expect(combo.optionGroups[0]).toMatchObject({ minSelect: 1, maxSelect: 1 });
      // Unlinking from the group side removes only that group from the combo.
      await request(server)
        .put(`/v1/option-groups/${t.turbine.id}/products`)
        .set(auth(t.accessToken))
        .send({ productIds: [t.burger.id] })
        .expect(200);
      expect(
        (await publicProduct(t.slug, t.combo.id)).optionGroups.map((g: { name: string }) => g.name),
      ).toEqual(['Refrigerante']);
    });

    it('the API enforces required groups and prices; old orders keep what was sold', async () => {
      const t = await setupGroups();
      await request(server)
        .put(`/v1/products/${t.burger.id}/option-groups`)
        .set(auth(t.accessToken))
        .send({ groupIds: [t.refri.id, t.turbine.id] })
        .expect(200);

      // Required group without a choice: refused.
      await order(t.slug, [{ productId: t.burger.id, quantity: 1 }]).expect(400);
      // Above the option's own maximum: refused.
      await order(t.slug, [
        {
          productId: t.burger.id,
          quantity: 1,
          options: [
            { optionId: t.coca.id, quantity: 1 },
            { optionId: t.bacon.id, quantity: 3 },
          ],
        },
      ]).expect(400);
      const placed = await order(t.slug, [
        {
          productId: t.burger.id,
          quantity: 1,
          options: [
            { optionId: t.coca.id, quantity: 1 },
            { optionId: t.bacon.id, quantity: 2 },
          ],
        },
      ]).expect(201);
      expect(placed.body.items[0]).toMatchObject({ unitPrice: 42 }); // 34 + 2 x 4

      // The owner changes the bacon price, then removes the option, then the whole group.
      await request(server)
        .patch(`/v1/option-groups/${t.turbine.id}/options/${t.bacon.id}`)
        .set(auth(t.accessToken))
        .send({ price: 6 })
        .expect(200);
      const repriced = await order(t.slug, [
        {
          productId: t.burger.id,
          quantity: 1,
          options: [
            { optionId: t.coca.id, quantity: 1 },
            { optionId: t.bacon.id, quantity: 1 },
          ],
        },
      ]).expect(201);
      expect(repriced.body.items[0].unitPrice).toBe(40); // the new price, from the server
      await request(server)
        .delete(`/v1/option-groups/${t.turbine.id}/options/${t.bacon.id}`)
        .set(auth(t.accessToken))
        .expect(200);
      await request(server)
        .delete(`/v1/option-groups/${t.turbine.id}`)
        .set(auth(t.accessToken))
        .expect(204);

      const old = await request(server)
        .get(`/v1/orders/${placed.body.id}`)
        .set(auth(t.accessToken))
        .expect(200);
      expect(old.body.items[0]).toMatchObject({
        unitPrice: 42,
        options: expect.arrayContaining([
          expect.objectContaining({
            group: 'Turbine seu lanche!',
            name: 'Bacon',
            unitPrice: 4,
            quantity: 2,
          }),
        ]),
      });
      expect(old.body.total).toBe(placed.body.total);

      // A sold-out option disappears from the menu and cannot be ordered.
      await request(server)
        .patch(`/v1/option-groups/${t.refri.id}/options/${t.coca.id}`)
        .set(auth(t.accessToken))
        .send({ soldOut: true })
        .expect(200);
      expect((await publicProduct(t.slug, t.burger.id)).soldOut).toBe(true); // required group empty
      await order(t.slug, [
        { productId: t.burger.id, quantity: 1, options: [{ optionId: t.coca.id, quantity: 1 }] },
      ]).expect(400);
    });

    it('duplicating a product copies its photo, promotion and add-on groups', async () => {
      const t = await setupGroups();
      await request(server)
        .patch(`/v1/products/${t.burger.id}`)
        .set(auth(t.accessToken))
        .send({ compareAtPrice: 40, featured: true })
        .expect(200);
      await request(server)
        .put(`/v1/products/${t.burger.id}/photo`)
        .set(auth(t.accessToken))
        .attach('file', jpeg, 'foto.jpg')
        .expect(200);
      await request(server)
        .put(`/v1/products/${t.burger.id}/option-groups`)
        .set(auth(t.accessToken))
        .send({ groupIds: [t.turbine.id] })
        .expect(200);
      const copy = await request(server)
        .post(`/v1/products/${t.burger.id}/duplicate`)
        .set(auth(t.accessToken))
        .expect(201);
      const original = await request(server)
        .get(`/v1/products/${t.burger.id}`)
        .set(auth(t.accessToken));
      expect(copy.body).toMatchObject({
        name: 'Burger Tudo (cópia)',
        price: 34,
        compareAtPrice: 40,
        featured: true,
        soldOut: false,
        photoUrl: original.body.photoUrl,
        optionGroupIds: [t.turbine.id],
      });
    });
  });

  describe('look of the restaurant', () => {
    it('logo, cover and color: preview data on the profile, shown on the menu, audited', async () => {
      const t = await registerTenantE2E(server);
      const color = await request(server)
        .patch('/v1/tenants/current/profile')
        .set(auth(t.accessToken))
        .send({ brandColor: '#c8102e' })
        .expect(200);
      expect(color.body.brandColor).toBe('#C8102E');
      await request(server)
        .patch('/v1/tenants/current/profile')
        .set(auth(t.accessToken))
        .send({ brandColor: 'red' })
        .expect(400);

      const logo = await request(server)
        .put('/v1/tenants/current/logo')
        .set(auth(t.accessToken))
        .attach('file', png, 'logo.png')
        .expect(200);
      const cover = await request(server)
        .put('/v1/tenants/current/cover')
        .set(auth(t.accessToken))
        .attach('file', jpeg, 'capa.jpg')
        .expect(200);
      expect(logo.body.logoUrl).toMatch(/^\/api\/public\/media\//);
      expect(cover.body).toMatchObject({
        logoUrl: logo.body.logoUrl,
        coverUrl: expect.stringMatching(/media/),
      });
      const menu = await menuOf(t.slug);
      expect(menu.restaurant).toMatchObject({
        logoUrl: logo.body.logoUrl,
        coverUrl: cover.body.coverUrl,
        brandColor: '#C8102E',
      });
      const me = await request(server).get('/v1/auth/me').set(auth(t.accessToken)).expect(200);
      expect(me.body.tenant.logoUrl).toBe(logo.body.logoUrl);

      await request(server)
        .put('/v1/tenants/current/banner')
        .set(auth(t.accessToken))
        .attach('file', png, 'x.png')
        .expect(400);
      const removed = await request(server)
        .delete('/v1/tenants/current/logo')
        .set(auth(t.accessToken))
        .expect(200);
      expect(removed.body.logoUrl).toBeNull();
      expect((await menuOf(t.slug)).restaurant.logoUrl).toBeNull();

      const audits = await getPrisma(app).auditLog.findMany({
        where: { tenantId: t.tenantId, action: 'RESTAURANT_BRANDING_UPDATED' },
        orderBy: { createdAt: 'asc' },
      });
      expect(audits.map((a) => Object.keys(a.afterData as object)[0])).toEqual([
        'logoMediaId',
        'coverMediaId',
        'logoMediaId',
      ]);
    });
  });

  describe('permissions and isolation', () => {
    it('a manager runs the menu but not the look of the restaurant nor deletions', async () => {
      const t = await registerTenantE2E(server);
      const p = await createActiveProductE2E(server, t.accessToken, 'Burger', 30);
      const manager = await createStaffAndLoginE2E(app, server, t.tenantId, 'MANAGER');
      await request(server)
        .patch(`/v1/products/${p.id}`)
        .set(auth(manager))
        .send({ soldOut: true })
        .expect(200);
      await request(server)
        .put(`/v1/products/${p.id}/photo`)
        .set(auth(manager))
        .attach('file', png, 'f.png')
        .expect(200);
      const group = await request(server)
        .post('/v1/option-groups')
        .set(auth(manager))
        .send({ name: 'Molhos', minSelect: 0, maxSelect: 2 })
        .expect(201);
      await request(server)
        .post(`/v1/option-groups/${group.body.id}/options`)
        .set(auth(manager))
        .send({ name: 'Barbecue', price: 1.5 })
        .expect(201);
      await request(server)
        .put(`/v1/products/${p.id}/option-groups`)
        .set(auth(manager))
        .send({ groupIds: [group.body.id] })
        .expect(200);
      await request(server)
        .delete(`/v1/option-groups/${group.body.id}`)
        .set(auth(manager))
        .expect(403);
      await request(server)
        .put('/v1/tenants/current/logo')
        .set(auth(manager))
        .attach('file', png, 'l.png')
        .expect(403);
      await request(server)
        .patch('/v1/tenants/current/profile')
        .set(auth(manager))
        .send({ brandColor: '#000000' })
        .expect(403);
    });

    it('cashier, waiter and kitchen cannot change the menu', async () => {
      const t = await registerTenantE2E(server);
      const p = await createActiveProductE2E(server, t.accessToken, 'Burger', 30);
      const group = await request(server)
        .post('/v1/option-groups')
        .set(auth(t.accessToken))
        .send({ name: 'Molhos', minSelect: 0, maxSelect: 2 })
        .expect(201);
      for (const role of ['CASHIER', 'WAITER', 'KITCHEN'] as const) {
        const token = await createStaffAndLoginE2E(app, server, t.tenantId, role);
        await request(server)
          .patch(`/v1/products/${p.id}`)
          .set(auth(token))
          .send({ soldOut: true })
          .expect(403);
        await request(server)
          .put(`/v1/products/${p.id}/photo`)
          .set(auth(token))
          .attach('file', png, 'f.png')
          .expect(403);
        await request(server).delete(`/v1/products/${p.id}/photo`).set(auth(token)).expect(403);
        await request(server)
          .post('/v1/option-groups')
          .set(auth(token))
          .send({ name: 'X', minSelect: 0, maxSelect: 1 })
          .expect(403);
        await request(server)
          .post(`/v1/option-groups/${group.body.id}/options`)
          .set(auth(token))
          .send({ name: 'Y', price: 1 })
          .expect(403);
        await request(server)
          .put(`/v1/products/${p.id}/option-groups`)
          .set(auth(token))
          .send({ groupIds: [] })
          .expect(403);
        await request(server)
          .put('/v1/tenants/current/cover')
          .set(auth(token))
          .attach('file', png, 'c.png')
          .expect(403);
      }
      // Kitchen does not even read the menu administration.
      const kitchen = await createStaffAndLoginE2E(app, server, t.tenantId, 'KITCHEN');
      await request(server).get('/v1/option-groups').set(auth(kitchen)).expect(403);
      const unchanged = await request(server)
        .get(`/v1/products/${p.id}`)
        .set(auth(t.accessToken))
        .expect(200);
      expect(unchanged.body).toMatchObject({ soldOut: false, photoUrl: null, optionGroupIds: [] });
    });

    it("another restaurant cannot see, change or borrow this restaurant's groups and photos", async () => {
      const a = await registerTenantE2E(server);
      const b = await registerTenantE2E(server);
      const productA = await createActiveProductE2E(server, a.accessToken, 'Burger A', 30);
      const productB = await createActiveProductE2E(server, b.accessToken, 'Burger B', 30);
      const groupA = await request(server)
        .post('/v1/option-groups')
        .set(auth(a.accessToken))
        .send({ name: 'Grupo A', minSelect: 0, maxSelect: 2 })
        .expect(201);
      const withOption = await request(server)
        .post(`/v1/option-groups/${groupA.body.id}/options`)
        .set(auth(a.accessToken))
        .send({ name: 'Opção A', price: 1 })
        .expect(201);
      const optionA = withOption.body.options[0];

      expect(
        (await request(server).get('/v1/option-groups').set(auth(b.accessToken)).expect(200)).body,
      ).toEqual([]);
      await request(server)
        .get(`/v1/option-groups/${groupA.body.id}`)
        .set(auth(b.accessToken))
        .expect(404);
      await request(server)
        .patch(`/v1/option-groups/${groupA.body.id}`)
        .set(auth(b.accessToken))
        .send({ name: 'Invadido' })
        .expect(404);
      await request(server)
        .patch(`/v1/option-groups/${groupA.body.id}/options/${optionA.id}`)
        .set(auth(b.accessToken))
        .send({ price: 0 })
        .expect(404);
      await request(server)
        .delete(`/v1/option-groups/${groupA.body.id}`)
        .set(auth(b.accessToken))
        .expect(404);
      // B cannot hang A's group on its own product, nor put its product into A's group.
      await request(server)
        .put(`/v1/products/${productB.id}/option-groups`)
        .set(auth(b.accessToken))
        .send({ groupIds: [groupA.body.id] })
        .expect(404);
      await request(server)
        .put(`/v1/option-groups/${groupA.body.id}/products`)
        .set(auth(a.accessToken))
        .send({ productIds: [productB.id] })
        .expect(404);
      // Nor change A's product photo.
      await request(server)
        .put(`/v1/products/${productA.id}/photo`)
        .set(auth(b.accessToken))
        .attach('file', png, 'f.png')
        .expect(404);

      const group = await request(server)
        .get(`/v1/option-groups/${groupA.body.id}`)
        .set(auth(a.accessToken))
        .expect(200);
      expect(group.body).toMatchObject({
        name: 'Grupo A',
        productIds: [],
        options: [{ name: 'Opção A', price: 1 }],
      });
      expect(
        await getPrisma(app).mediaAsset.count({
          where: { tenantId: { in: [a.tenantId, b.tenantId] } },
        }),
      ).toBe(0);
    });
  });
});
