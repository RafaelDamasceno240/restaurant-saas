import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createStaffAndLoginE2E,
  createTestApp,
  getPrisma,
  injectAuditFailure,
  registerTenantE2E,
  removeAuditFailure,
} from './test-app.util';

type Json = Record<string, unknown>;

// Restaurant profile: the owner edits the brand (tenant) and the contact, address and hours of
// the branch that receives online orders; the public menu shows the public part of it.
describe('Restaurant profile (e2e)', () => {
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
  const getProfile = (token: string) =>
    request(server).get('/v1/tenants/current/profile').set(auth(token));
  const patchProfile = (token: string, body: Json) =>
    request(server).patch('/v1/tenants/current/profile').set(auth(token)).send(body);
  const publicMenu = (slug: string) => request(server).get(`/v1/public/menu/${slug}`).expect(200);
  const prisma = () => getPrisma(app);
  const audits = (tenantId: string) =>
    prisma().auditLog.findMany({
      where: { tenantId, action: 'RESTAURANT_PROFILE_UPDATED' },
      orderBy: { createdAt: 'asc' },
    });

  const FULL = {
    name: '  Casa do Burger  ',
    legalName: 'Casa do Burger Alimentos LTDA',
    description: 'Hambúrgueres artesanais e sobremesas.',
    instagram: '@casa.do_burger',
    phone: '(31) 3456-7890',
    whatsapp: '+55 (31) 98765-4321',
    email: 'Contato@CasaDoBurger.com.br',
    address: 'Rua das Flores',
    number: '120',
    complement: 'Loja 2',
    neighborhood: 'Centro',
    city: 'Belo Horizonte',
    state: 'mg',
    zipCode: '30110-012',
    openingHours: [
      { weekday: 5, opens: '18:00', closes: '02:00' },
      { weekday: 1, opens: '18:00', closes: '23:00' },
      { weekday: 1, opens: '11:00', closes: '15:00' },
    ],
  };

  // Every minute of the week is covered (12:00 to 00:00 runs into the next day), so "open now"
  // does not depend on when the test runs.
  const ALWAYS_OPEN = [0, 1, 2, 3, 4, 5, 6].flatMap((weekday) => [
    { weekday, opens: '00:00', closes: '12:00' },
    { weekday, opens: '12:00', closes: '00:00' },
  ]);

  it('starts empty: only what was typed at registration, and the default branch', async () => {
    const ctx = await registerTenantE2E(server);
    const res = await getProfile(ctx.accessToken).expect(200);
    expect(res.body).toMatchObject({
      slug: ctx.slug,
      timezone: 'America/Sao_Paulo',
      description: null,
      instagram: null,
      openNow: null,
      branch: {
        id: ctx.branchId,
        name: 'Matriz',
        phone: null,
        whatsapp: null,
        email: null,
        address: null,
        openingHours: null,
      },
    });
    expect(res.body.name).toMatch(/^Restaurante /);
    expect(res.body.document).toMatch(/^\d{14}$/);
  });

  it('saves every field normalized, and the public menu shows only the public ones', async () => {
    const ctx = await registerTenantE2E(server);
    const saved = await patchProfile(ctx.accessToken, FULL).expect(200);

    expect(saved.body).toMatchObject({
      name: 'Casa do Burger',
      legalName: 'Casa do Burger Alimentos LTDA',
      description: 'Hambúrgueres artesanais e sobremesas.',
      instagram: 'casa.do_burger',
      branch: {
        id: ctx.branchId,
        phone: '3134567890',
        whatsapp: '31987654321',
        email: 'contato@casadoburger.com.br',
        address: 'Rua das Flores',
        number: '120',
        complement: 'Loja 2',
        neighborhood: 'Centro',
        city: 'Belo Horizonte',
        state: 'MG',
        zipCode: '30110012',
        openingHours: [
          { weekday: 1, opens: '11:00', closes: '15:00' },
          { weekday: 1, opens: '18:00', closes: '23:00' },
          { weekday: 5, opens: '18:00', closes: '02:00' },
        ],
      },
    });
    expect(typeof saved.body.openNow).toBe('boolean');
    expect((await getProfile(ctx.accessToken).expect(200)).body).toEqual(saved.body);

    const menu = await publicMenu(ctx.slug);
    expect(menu.body.restaurant).toEqual({
      name: 'Casa do Burger',
      slug: ctx.slug,
      description: 'Hambúrgueres artesanais e sobremesas.',
      phone: '3134567890',
      whatsapp: '31987654321',
      instagram: 'casa.do_burger',
      address: {
        street: 'Rua das Flores',
        number: '120',
        complement: 'Loja 2',
        neighborhood: 'Centro',
        city: 'Belo Horizonte',
        state: 'MG',
        zipCode: '30110012',
      },
      openingHours: saved.body.branch.openingHours,
      openNow: saved.body.openNow,
      // Look of the menu: not configured by the profile screen.
      timeZone: 'America/Sao_Paulo',
      logoUrl: null,
      coverUrl: null,
      brandColor: null,
    });
    const raw = JSON.stringify(menu.body);
    expect(raw).not.toContain('casadoburger.com.br');
    expect(raw).not.toContain('Alimentos LTDA');
    expect(raw).not.toContain(saved.body.document);
    expect(raw).not.toContain(ctx.branchId);
  });

  it('changes only the keys sent, clears with null or blank, and audits exactly what changed', async () => {
    const ctx = await registerTenantE2E(server);
    await patchProfile(ctx.accessToken, FULL).expect(200);

    const res = await patchProfile(ctx.accessToken, {
      phone: null,
      complement: '  ',
      city: 'Contagem',
    }).expect(200);
    expect(res.body.branch).toMatchObject({
      phone: null,
      complement: null,
      city: 'Contagem',
      whatsapp: '31987654321',
    });
    expect(res.body.name).toBe('Casa do Burger');
    expect(res.body.branch.openingHours).toHaveLength(3);

    // Sending what is already stored writes nothing.
    await patchProfile(ctx.accessToken, {
      city: 'Contagem',
      state: 'MG',
      whatsapp: '(31) 98765-4321',
    }).expect(200);
    await patchProfile(ctx.accessToken, {}).expect(200);

    const entries = await audits(ctx.tenantId);
    expect(entries).toHaveLength(2);
    expect(entries[1].afterData).toEqual({
      phone: null,
      complement: null,
      city: 'Contagem',
      branchId: ctx.branchId,
    });
    expect(entries[1].beforeData).toEqual({
      phone: '3134567890',
      complement: 'Loja 2',
      city: 'Belo Horizonte',
      branchId: ctx.branchId,
    });
  });

  it('computes "open now" in the restaurant time zone: [] is closed, null is "not informed"', async () => {
    const ctx = await registerTenantE2E(server);
    expect(
      (await patchProfile(ctx.accessToken, { openingHours: ALWAYS_OPEN }).expect(200)).body.openNow,
    ).toBe(true);
    expect((await publicMenu(ctx.slug)).body.restaurant.openNow).toBe(true);

    expect(
      (await patchProfile(ctx.accessToken, { openingHours: [] }).expect(200)).body.openNow,
    ).toBe(false);
    expect((await publicMenu(ctx.slug)).body.restaurant).toMatchObject({
      openingHours: [],
      openNow: false,
    });

    const cleared = await patchProfile(ctx.accessToken, { openingHours: null }).expect(200);
    expect(cleared.body).toMatchObject({ openNow: null, branch: { openingHours: null } });
    const row = await prisma().branch.findUniqueOrThrow({ where: { id: ctx.branchId } });
    expect(row.openingHours).toBeNull();
  });

  it('refuses invalid values, identity fields and clearing the name, changing nothing', async () => {
    const ctx = await registerTenantE2E(server);
    await patchProfile(ctx.accessToken, FULL).expect(200);
    const before = (await getProfile(ctx.accessToken).expect(200)).body;

    const invalid: Json[] = [
      { name: null },
      { name: ' ' },
      { legalName: '' },
      { name: 'x'.repeat(121) },
      { description: 'x'.repeat(501) },
      { instagram: 'https://instagram.com/casa' },
      { phone: '123' },
      { whatsapp: 'abc12345678' },
      { email: 'sem-arroba' },
      { state: 'XX' },
      { zipCode: '3011-012' },
      { openingHours: 'seg a sex 18h' },
      { openingHours: [{ weekday: 7, opens: '18:00', closes: '23:00' }] },
      { openingHours: [{ weekday: 1, opens: '18:00', closes: '18:00' }] },
      { openingHours: [{ weekday: 1, opens: '18:00', closes: '23:00', note: 'x' }] },
      { document: '12345678000199' },
      { slug: 'outro-slug' },
      { tenantId: '00000000-0000-0000-0000-000000000000' },
      { timezone: 'UTC' },
    ];
    for (const body of invalid) {
      const res = await patchProfile(ctx.accessToken, body);
      expect({ body, status: res.status }).toEqual({ body, status: 400 });
    }

    const overlap = await patchProfile(ctx.accessToken, {
      openingHours: [
        { weekday: 5, opens: '18:00', closes: '02:00' },
        { weekday: 6, opens: '01:00', closes: '04:00' },
      ],
    }).expect(400);
    expect(JSON.stringify(overlap.body)).toContain('sobrepostos');

    expect((await getProfile(ctx.accessToken).expect(200)).body).toEqual(before);
    expect(await audits(ctx.tenantId)).toHaveLength(1);
  });

  it('reads with restaurant.read and writes only with restaurant.update', async () => {
    const ctx = await registerTenantE2E(server);
    const manager = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'MANAGER', [
      ctx.branchId,
    ]);
    const viewer = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'VIEWER', [
      ctx.branchId,
    ]);
    const cashier = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'CASHIER', [
      ctx.branchId,
    ]);
    const admin = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'ADMIN');

    await getProfile(manager).expect(200);
    await getProfile(viewer).expect(200);
    await getProfile(cashier).expect(403);
    await patchProfile(manager, { city: 'Betim' }).expect(403);
    await patchProfile(viewer, { city: 'Betim' }).expect(403);
    await patchProfile(cashier, { city: 'Betim' }).expect(403);
    await request(server).get('/v1/tenants/current/profile').expect(401);
    await request(server).patch('/v1/tenants/current/profile').send({ city: 'Betim' }).expect(401);

    const res = await patchProfile(admin, { city: 'Betim' }).expect(200);
    expect(res.body.branch.city).toBe('Betim');
  });

  it('never touches another restaurant', async () => {
    const a = await registerTenantE2E(server);
    const b = await registerTenantE2E(server);
    await patchProfile(a.accessToken, { ...FULL, name: 'Restaurante A' }).expect(200);
    await patchProfile(b.accessToken, {
      name: 'Restaurante B',
      city: 'Uberlândia',
      phone: '(34) 3333-4444',
    }).expect(200);

    const profileA = (await getProfile(a.accessToken).expect(200)).body;
    expect(profileA).toMatchObject({
      name: 'Restaurante A',
      branch: { id: a.branchId, city: 'Belo Horizonte' },
    });
    const profileB = (await getProfile(b.accessToken).expect(200)).body;
    expect(profileB).toMatchObject({
      name: 'Restaurante B',
      branch: { id: b.branchId, city: 'Uberlândia', address: null },
    });
    expect((await publicMenu(a.slug)).body.restaurant).toMatchObject({
      name: 'Restaurante A',
      phone: '3134567890',
    });
    expect((await publicMenu(b.slug)).body.restaurant).toMatchObject({
      name: 'Restaurante B',
      phone: '3433334444',
    });
    expect(await audits(b.tenantId)).toHaveLength(1);
  });

  it('the change and its audit entry commit together', async () => {
    const ctx = await registerTenantE2E(server);
    await injectAuditFailure(app, 'fail_profile_audit', ctx.tenantId, 'RESTAURANT_PROFILE_UPDATED');
    try {
      await patchProfile(ctx.accessToken, { name: 'Nome Novo', city: 'Ouro Preto' }).expect(500);
    } finally {
      await removeAuditFailure(app, 'fail_profile_audit');
    }
    const res = await getProfile(ctx.accessToken).expect(200);
    expect(res.body.name).not.toBe('Nome Novo');
    expect(res.body.branch.city).toBeNull();
  });

  it('two editors at the same time: both changes land and each audit entry is exact', async () => {
    const ctx = await registerTenantE2E(server);
    const admin = await createStaffAndLoginE2E(app, server, ctx.tenantId, 'ADMIN');
    await Promise.all([
      patchProfile(ctx.accessToken, { city: 'Sabará' }).expect(200),
      patchProfile(admin, { description: 'Desde 2010.' }).expect(200),
    ]);
    const res = await getProfile(ctx.accessToken).expect(200);
    expect(res.body).toMatchObject({ description: 'Desde 2010.', branch: { city: 'Sabará' } });
    const entries = await audits(ctx.tenantId);
    expect(
      entries.map((e) =>
        Object.keys(e.afterData as Json)
          .sort()
          .join(','),
      ),
    ).toEqual(expect.arrayContaining(['branchId,city', 'branchId,description']));
  });

  it('a renamed restaurant shows the new name on /auth/me', async () => {
    const ctx = await registerTenantE2E(server);
    await patchProfile(ctx.accessToken, { name: 'Nome Atualizado' }).expect(200);
    const me = await request(server).get('/v1/auth/me').set(auth(ctx.accessToken)).expect(200);
    expect(me.body.tenant.name).toBe('Nome Atualizado');
  });
});
