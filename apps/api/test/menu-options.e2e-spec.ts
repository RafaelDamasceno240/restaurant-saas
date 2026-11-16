import { createHash } from 'crypto';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createActiveProductE2E,
  createTestApp,
  getPrisma,
  registerTenantE2E,
} from './test-app.util';

// Add-ons (option groups), line notes, promotions, "sold out", the look of the menu and the
// images served from the database (migration 20261110210000_menu_options_and_media).
describe('Public menu with add-ons and images (e2e)', () => {
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

  const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('foto de teste')]);

  // A restaurant with: "Burger Tudo" R$ 34 (group "Turbine" 0..3: Bacon R$ 4 up to 2, Ovo R$ 2,
  // Troca de pão sold out), "Combo" R$ 14,99 (required group "Refri" 1..1, free), a promotion
  // and a sold-out product. Built straight in the database: there is no admin screen for groups
  // in this slice (the importer creates them).
  async function setup() {
    const tenant = await registerTenantE2E(server);
    const prisma = getPrisma(app);
    const burger = await createActiveProductE2E(server, tenant.accessToken, 'Burger Tudo', 34);
    const combo = await createActiveProductE2E(
      server,
      tenant.accessToken,
      'Combo Batata + Refri',
      14.99,
    );
    const melt = await createActiveProductE2E(server, tenant.accessToken, 'Bacon Melt', 32);
    const cake = await createActiveProductE2E(server, tenant.accessToken, 'Bolo Matilda', 20);
    const media = await prisma.mediaAsset.create({
      data: {
        tenantId: tenant.tenantId,
        contentType: 'image/jpeg',
        sizeBytes: jpeg.length,
        sha256: createHash('sha256').update(jpeg).digest('hex'),
        data: jpeg,
      },
    });
    await prisma.product.update({
      where: { id: burger.id },
      data: { imageMediaId: media.id, featured: true, badges: ['NEW'] },
    });
    await prisma.product.update({ where: { id: melt.id }, data: { compareAtPriceCents: 3500 } });
    await prisma.product.update({ where: { id: cake.id }, data: { soldOut: true } });
    await prisma.tenant.update({
      where: { id: tenant.tenantId },
      data: { brandColor: '#C8102E', logoMediaId: media.id },
    });

    const turbine = await prisma.optionGroup.create({
      data: { tenantId: tenant.tenantId, name: 'Turbine seu lanche!', minSelect: 0, maxSelect: 3 },
    });
    const [bacon, ovo, pao] = await Promise.all([
      prisma.optionItem.create({
        data: {
          tenantId: tenant.tenantId,
          groupId: turbine.id,
          name: 'Bacon',
          priceCents: 400,
          maxQuantity: 2,
          displayOrder: 1,
        },
      }),
      prisma.optionItem.create({
        data: {
          tenantId: tenant.tenantId,
          groupId: turbine.id,
          name: 'Ovo',
          priceCents: 200,
          maxQuantity: 10,
          displayOrder: 2,
        },
      }),
      prisma.optionItem.create({
        data: {
          tenantId: tenant.tenantId,
          groupId: turbine.id,
          name: 'Troca de pão',
          priceCents: 200,
          maxQuantity: 10,
          displayOrder: 3,
          soldOut: true,
        },
      }),
    ]);
    const refri = await prisma.optionGroup.create({
      data: { tenantId: tenant.tenantId, name: 'Refri', minSelect: 1, maxSelect: 1 },
    });
    const [coca, guarana] = await Promise.all([
      prisma.optionItem.create({
        data: {
          tenantId: tenant.tenantId,
          groupId: refri.id,
          name: 'Coca lata',
          priceCents: 0,
          maxQuantity: 1,
          displayOrder: 1,
        },
      }),
      prisma.optionItem.create({
        data: {
          tenantId: tenant.tenantId,
          groupId: refri.id,
          name: 'Guaraná lata',
          priceCents: 0,
          maxQuantity: 1,
          displayOrder: 2,
        },
      }),
    ]);
    await prisma.productOptionGroup.createMany({
      data: [
        { tenantId: tenant.tenantId, productId: burger.id, groupId: turbine.id, displayOrder: 0 },
        { tenantId: tenant.tenantId, productId: combo.id, groupId: refri.id, displayOrder: 0 },
      ],
    });
    return {
      ...tenant,
      burger,
      combo,
      melt,
      cake,
      media,
      turbine,
      refri,
      bacon,
      ovo,
      pao,
      coca,
      guarana,
    };
  }

  const order = (slug: string, items: unknown[], extra: Record<string, unknown> = {}) =>
    request(server)
      .post('/v1/public/orders')
      .send({
        restaurantSlug: slug,
        items,
        customer: { name: 'Cliente Teste', phone: '11987654321' },
        fulfillmentType: 'PICKUP',
        paymentMethod: 'PIX',
        ...extra,
      });

  it('the public menu lists groups, options, promotion, sold out, highlights and the look of the menu', async () => {
    const t = await setup();
    const res = await request(server).get(`/v1/public/menu/${t.slug}`).expect(200);
    const products = res.body.categories.flatMap((c: { products: unknown[] }) => c.products);
    const burger = products.find((p: { id: string }) => p.id === t.burger.id);
    expect(burger).toMatchObject({
      price: 34,
      compareAtPrice: null,
      soldOut: false,
      featured: true,
      badges: ['NEW'],
      imageUrl: `/api/public/media/${t.media.id}`,
      optionGroups: [
        {
          id: t.turbine.id,
          name: 'Turbine seu lanche!',
          minSelect: 0,
          maxSelect: 3,
          // The sold-out option is not offered.
          options: [
            {
              id: t.bacon.id,
              name: 'Bacon',
              price: 4,
              maxQuantity: 2,
              description: null,
              imageUrl: null,
            },
            {
              id: t.ovo.id,
              name: 'Ovo',
              price: 2,
              maxQuantity: 10,
              description: null,
              imageUrl: null,
            },
          ],
        },
      ],
    });
    expect(products.find((p: { id: string }) => p.id === t.melt.id)).toMatchObject({
      price: 32,
      compareAtPrice: 35,
    });
    expect(products.find((p: { id: string }) => p.id === t.cake.id)).toMatchObject({
      soldOut: true,
    });
    expect(res.body.restaurant).toMatchObject({
      brandColor: '#C8102E',
      logoUrl: `/api/public/media/${t.media.id}`,
      coverUrl: null,
      timeZone: 'America/Sao_Paulo',
    });
    // Nothing internal leaks: no tenantId, no externalId, no flags of the rows.
    expect(JSON.stringify(res.body)).not.toMatch(/tenantId|externalId|displayOrder/);
  });

  it('a required group whose every option is sold out makes the product sold out', async () => {
    const t = await setup();
    await getPrisma(app).optionItem.updateMany({
      where: { groupId: t.refri.id },
      data: { soldOut: true },
    });
    const res = await request(server).get(`/v1/public/menu/${t.slug}`).expect(200);
    const combo = res.body.categories
      .flatMap((c: { products: unknown[] }) => c.products)
      .find((p: { id: string }) => p.id === t.combo.id);
    expect(combo).toMatchObject({ soldOut: true, optionGroups: [] });
  });

  it('serves the image bytes with a long cache and no sniffing; unknown ids are 404, bad ids 400', async () => {
    const t = await setup();
    const res = await request(server)
      .get(`/v1/public/media/${t.media.id}`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect(res.headers['content-type']).toBe('image/jpeg');
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(Buffer.compare(res.body as Buffer, jpeg)).toBe(0);
    // A browser that has it gets 304; a menu page with dozens of photos is not throttled.
    const url = `/v1/public/media/${t.media.id}`;
    await request(server).get(url).set('If-None-Match', res.headers.etag).expect(304);
    for (let i = 0; i < 120; i++) await request(server).get(url).expect(200);
    await request(server).get('/v1/public/media/7d3f0c1e-1111-4a4a-9a9a-2f3a0a1b9c11').expect(404);
    await request(server).get('/v1/public/media/nao-e-uuid').expect(400);
    // A suspended restaurant's images go away with its menu.
    await getPrisma(app).tenant.update({
      where: { id: t.tenantId },
      data: { status: 'SUSPENDED' },
    });
    await request(server).get(`/v1/public/media/${t.media.id}`).expect(404);
  });

  it('prices the add-ons on the server, freezes them on the line with the note, and shows them to staff', async () => {
    const t = await setup();
    const res = await order(t.slug, [
      {
        productId: t.burger.id,
        quantity: 2,
        notes: '  sem cebola ',
        // A smuggled price is ignored: only ids and quantities count.
        options: [
          { optionId: t.bacon.id, quantity: 1, priceCents: 1 },
          { optionId: t.ovo.id, quantity: 2 },
        ],
        unitPrice: 0.01,
      },
      { productId: t.combo.id, quantity: 1, options: [{ optionId: t.coca.id, quantity: 1 }] },
    ]).expect(201);

    // Burger: 34 + 4 + 2*2 = 42 per unit, x2 = 84; combo 14,99.
    expect(res.body.items[0]).toMatchObject({
      unitPrice: 42,
      quantity: 2,
      subtotal: 84,
      notes: 'sem cebola',
      options: [
        { group: 'Turbine seu lanche!', name: 'Bacon', unitPrice: 4, quantity: 1 },
        { group: 'Turbine seu lanche!', name: 'Ovo', unitPrice: 2, quantity: 2 },
      ],
    });
    expect(res.body.items[1]).toMatchObject({
      unitPrice: 14.99,
      options: [{ group: 'Refri', name: 'Coca lata', unitPrice: 0, quantity: 1 }],
    });
    expect(res.body.total).toBeCloseTo(98.99);

    // Public confirmation page and staff order detail carry the same lines.
    const confirmation = await request(server)
      .get(`/v1/public/orders/${t.slug}/${res.body.id}`)
      .expect(200);
    expect(confirmation.body.items[0].options).toHaveLength(2);
    const detail = await request(server)
      .get(`/v1/orders/${res.body.id}`)
      .set('Authorization', `Bearer ${t.accessToken}`)
      .expect(200);
    expect(detail.body.items[0]).toMatchObject({
      notes: 'sem cebola',
      options: [{ name: 'Bacon' }, { name: 'Ovo', quantity: 2 }],
    });
    // The kitchen board shows them too.
    const board = await request(server)
      .get('/v1/orders/board')
      .set('Authorization', `Bearer ${t.accessToken}`)
      .expect(200);
    const card = board.body.columns
      .flatMap((c: { data: { id: string }[] }) => c.data)
      .find((o: { id: string }) => o.id === res.body.id);
    expect(card.items[0].options.map((o: { name: string }) => o.name)).toEqual(['Bacon', 'Ovo']);

    // A later price change or a deleted option never rewrites the order.
    await getPrisma(app).optionItem.update({
      where: { id: t.bacon.id },
      data: { priceCents: 900, name: 'Bacon duplo' },
    });
    await getPrisma(app).optionItem.delete({ where: { id: t.ovo.id } });
    const again = await request(server)
      .get(`/v1/orders/${res.body.id}`)
      .set('Authorization', `Bearer ${t.accessToken}`)
      .expect(200);
    expect(again.body.items[0]).toMatchObject({
      unitPrice: 42,
      options: [
        { name: 'Bacon', unitPrice: 4 },
        { name: 'Ovo', unitPrice: 2 },
      ],
    });
    const rows = await getPrisma(app).orderItemOption.findMany({
      where: { orderItem: { orderId: res.body.id } },
    });
    expect(rows.find((r) => r.optionNameSnapshot === 'Ovo')?.optionItemId).toBeNull();
  });

  it('refuses: missing required choice, sold-out option, an option of another product, over the limits, sold-out product', async () => {
    const t = await setup();
    const expectRefusal = async (items: unknown[], code: string) => {
      const res = await order(t.slug, items).expect(400);
      expect(res.body.code).toBe(code);
    };
    await expectRefusal([{ productId: t.combo.id, quantity: 1 }], 'OPTION_REQUIRED');
    await expectRefusal(
      [{ productId: t.burger.id, quantity: 1, options: [{ optionId: t.pao.id, quantity: 1 }] }],
      'OPTION_UNAVAILABLE',
    );
    await expectRefusal(
      [{ productId: t.burger.id, quantity: 1, options: [{ optionId: t.coca.id, quantity: 1 }] }],
      'OPTION_UNAVAILABLE',
    );
    await expectRefusal(
      [{ productId: t.burger.id, quantity: 1, options: [{ optionId: t.bacon.id, quantity: 3 }] }],
      'OPTION_LIMIT',
    );
    await expectRefusal(
      [
        {
          productId: t.burger.id,
          quantity: 1,
          options: [
            { optionId: t.bacon.id, quantity: 2 },
            { optionId: t.ovo.id, quantity: 2 },
          ],
        },
      ],
      'OPTION_LIMIT',
    );
    await expectRefusal(
      [
        {
          productId: t.combo.id,
          quantity: 1,
          options: [
            { optionId: t.coca.id, quantity: 1 },
            { optionId: t.guarana.id, quantity: 1 },
          ],
        },
      ],
      'OPTION_LIMIT',
    );
    await expectRefusal([{ productId: t.cake.id, quantity: 1 }], 'PRODUCT_UNAVAILABLE');
    // Nothing was created by any of these.
    expect(await getPrisma(app).order.count({ where: { tenantId: t.tenantId } })).toBe(0);
  });

  it("isolation: another restaurant cannot use this restaurant's add-ons, and sees none of them", async () => {
    const a = await setup();
    const b = await registerTenantE2E(server);
    const bBurger = await createActiveProductE2E(server, b.accessToken, 'Burger B', 30);
    const res = await order(b.slug, [
      { productId: bBurger.id, quantity: 1, options: [{ optionId: a.bacon.id, quantity: 1 }] },
    ]).expect(400);
    expect(res.body.code).toBe('OPTION_UNAVAILABLE');
    // Even a link planted across restaurants is ignored by the menu and refused by the order.
    await getPrisma(app).productOptionGroup.create({
      data: { tenantId: b.tenantId, productId: bBurger.id, groupId: a.turbine.id },
    });
    const menu = await request(server).get(`/v1/public/menu/${b.slug}`).expect(200);
    expect(menu.body.categories[0].products[0].optionGroups).toEqual([]);
    await order(b.slug, [
      { productId: bBurger.id, quantity: 1, options: [{ optionId: a.bacon.id, quantity: 1 }] },
    ]).expect(400);
  });

  it('the panel identity: /auth/me carries each restaurant its own logo, or none', async () => {
    const a = await setup();
    const b = await registerTenantE2E(server);
    const me = (token: string) =>
      request(server).get('/v1/auth/me').set('Authorization', `Bearer ${token}`).expect(200);
    const meA = await me(a.accessToken);
    expect(meA.body.tenant).toEqual({
      id: a.tenantId,
      name: expect.any(String),
      slug: a.slug,
      logoUrl: `/api/public/media/${a.media.id}`,
    });
    const meB = await me(b.accessToken);
    expect(meB.body.tenant.id).toBe(b.tenantId);
    expect(meB.body.tenant.logoUrl).toBeNull();
  });

  it('a retry with the same key and the same add-ons is the same order; other add-ons with that key are refused', async () => {
    const t = await setup();
    const items = [
      {
        productId: t.burger.id,
        quantity: 1,
        options: [{ optionId: t.bacon.id, quantity: 1 }],
        notes: 'bem passado',
      },
    ];
    const first = await order(t.slug, items, { idempotencyKey: 'chave-adicionais-0001' }).expect(
      201,
    );
    const retry = await order(t.slug, items, { idempotencyKey: 'chave-adicionais-0001' }).expect(
      201,
    );
    expect(retry.body.id).toBe(first.body.id);
    const other = await order(
      t.slug,
      [{ ...items[0], options: [{ optionId: t.ovo.id, quantity: 1 }] }],
      {
        idempotencyKey: 'chave-adicionais-0001',
      },
    ).expect(409);
    expect(other.body.code).toBe('IDEMPOTENCY_KEY_REUSED');
    expect(await getPrisma(app).order.count({ where: { tenantId: t.tenantId } })).toBe(1);
  });

  it('the coupon preview prices the add-ons like the order', async () => {
    const t = await setup();
    await getPrisma(app).coupon.create({
      data: { tenantId: t.tenantId, code: 'DEZ', discountType: 'PERCENTAGE', value: 10 },
    });
    const res = await request(server)
      .post('/v1/public/orders/coupon-preview')
      .send({
        restaurantSlug: t.slug,
        code: 'DEZ',
        items: [
          { productId: t.burger.id, quantity: 1, options: [{ optionId: t.bacon.id, quantity: 2 }] },
        ],
      })
      .expect(200);
    expect(res.body).toMatchObject({ subtotalCents: 4200, discountCents: 420 });
  });

  it('the PDV enforces the required group too (add-ons are sold at the counter now)', async () => {
    const t = await setup();
    const missing = await request(server)
      .post('/v1/pos/orders')
      .set('Authorization', `Bearer ${t.accessToken}`)
      .send({
        branchId: t.branchId,
        items: [{ productId: t.combo.id, quantity: 1 }],
        paymentMethod: 'PIX',
      })
      .expect(400);
    expect(missing.body.code).toBe('OPTION_REQUIRED');
    const res = await request(server)
      .post('/v1/pos/orders')
      .set('Authorization', `Bearer ${t.accessToken}`)
      .send({
        branchId: t.branchId,
        items: [{ productId: t.combo.id, quantity: 1, options: [{ optionId: t.coca.id, quantity: 1 }] }],
        paymentMethod: 'PIX',
      })
      .expect(201);
    expect(res.body.total).toBeCloseTo(14.99);
    expect(res.body.items[0].options).toEqual([
      expect.objectContaining({ group: 'Refri', name: 'Coca lata', quantity: 1 }),
    ]);
    // ...but not a sold-out one.
    await request(server)
      .post('/v1/pos/orders')
      .set('Authorization', `Bearer ${t.accessToken}`)
      .send({
        branchId: t.branchId,
        items: [{ productId: t.cake.id, quantity: 1 }],
        paymentMethod: 'PIX',
      })
      .expect(400);
  });

  it('the database refuses what the API never writes', async () => {
    const t = await setup();
    const prisma = getPrisma(app);
    await expect(
      prisma.product.update({ where: { id: t.melt.id }, data: { compareAtPriceCents: 3200 } }),
    ).rejects.toThrow();
    await expect(
      prisma.optionGroup.create({
        data: { tenantId: t.tenantId, name: 'X', minSelect: 3, maxSelect: 2 },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.optionItem.create({
        data: { tenantId: t.tenantId, groupId: t.turbine.id, name: 'X', priceCents: -1 },
      }),
    ).rejects.toThrow();
    await expect(
      prisma.tenant.update({ where: { id: t.tenantId }, data: { brandColor: 'red' } }),
    ).rejects.toThrow();
    const svg = Buffer.from('<svg/>');
    await expect(
      prisma.mediaAsset.create({
        data: {
          tenantId: t.tenantId,
          contentType: 'image/svg+xml',
          sizeBytes: svg.length,
          sha256: 'b'.repeat(64),
          data: svg,
        },
      }),
    ).rejects.toThrow();
  });
});
