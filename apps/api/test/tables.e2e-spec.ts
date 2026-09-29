import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createActiveProductE2E, createTestApp, getPrisma, registerTenantE2E } from './test-app.util';

describe('Tables (mesas) (e2e)', () => {
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

  function create(token: string, body: Record<string, unknown>) {
    return request(server).post('/v1/tables').set('Authorization', `Bearer ${token}`).send(body);
  }
  function list(token: string, branchId: string) {
    return request(server)
      .get('/v1/tables')
      .query({ branchId })
      .set('Authorization', `Bearer ${token}`);
  }

  it('creates a table', async () => {
    const { accessToken, branchId } = await registerTenantE2E(server);
    const res = await create(accessToken, { branchId, number: 1, name: 'Varanda' }).expect(201);
    expect(res.body.number).toBe(1);
    expect(res.body.name).toBe('Varanda');
    expect(res.body.status).toBe('AVAILABLE');
    expect(res.body.openTabId).toBeNull();
  });

  it('lists tables for a branch, ordered by number', async () => {
    const { accessToken, branchId } = await registerTenantE2E(server);
    await create(accessToken, { branchId, number: 3 }).expect(201);
    await create(accessToken, { branchId, number: 1 }).expect(201);
    await create(accessToken, { branchId, number: 2 }).expect(201);

    const res = await list(accessToken, branchId).expect(200);
    expect(res.body.map((t: { number: number }) => t.number)).toEqual([1, 2, 3]);
  });

  it('updates a table', async () => {
    const { accessToken, branchId } = await registerTenantE2E(server);
    const table = (await create(accessToken, { branchId, number: 5 }).expect(201)).body;

    const res = await request(server)
      .patch(`/v1/tables/${table.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ name: 'Deck', active: false })
      .expect(200);
    expect(res.body.name).toBe('Deck');
    expect(res.body.active).toBe(false);
  });

  it('rejects a duplicate table number within the same branch', async () => {
    const { accessToken, branchId } = await registerTenantE2E(server);
    await create(accessToken, { branchId, number: 7 }).expect(201);
    const res = await create(accessToken, { branchId, number: 7 }).expect(409);
    expect(res.body.code).toBe('TABLE_NUMBER_TAKEN');
  });

  it('allows the same table number in two different branches of the same tenant', async () => {
    const { accessToken, branchId, tenantId } = await registerTenantE2E(server);
    const otherBranch = await getPrisma(app).branch.create({
      data: { tenantId, name: 'Filial', code: 'FILIAL' },
    });
    await create(accessToken, { branchId, number: 9 }).expect(201);
    await create(accessToken, { branchId: otherBranch.id, number: 9 }).expect(201);
  });

  it('isolates tables between tenants (404 on cross-tenant read)', async () => {
    const a = await registerTenantE2E(server);
    const b = await registerTenantE2E(server);
    const table = (await create(a.accessToken, { branchId: a.branchId, number: 1 }).expect(201)).body;

    await request(server)
      .get(`/v1/tables/${table.id}`)
      .set('Authorization', `Bearer ${b.accessToken}`)
      .expect(404);
    await create(b.accessToken, { branchId: a.branchId, number: 1 }).expect(404);
  });

  it('blocks deleting a table that has an OPEN tab', async () => {
    const { accessToken, branchId } = await registerTenantE2E(server);
    const table = (await create(accessToken, { branchId, number: 4 }).expect(201)).body;

    await request(server)
      .post('/v1/tabs')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ branchId, tableId: table.id })
      .expect(201);

    const blocked = await request(server)
      .delete(`/v1/tables/${table.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(409);
    expect(blocked.body.code).toBe('TABLE_HAS_OPEN_TAB');
  });

  it('deletes a table with no tab history, but keeps blocking it (409, not a 500) once it has any — even closed', async () => {
    const { accessToken, branchId } = await registerTenantE2E(server);
    const untouched = (await create(accessToken, { branchId, number: 6 }).expect(201)).body;
    await request(server)
      .delete(`/v1/tables/${untouched.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(204);

    const table = (await create(accessToken, { branchId, number: 8 }).expect(201)).body;
    const product = await createActiveProductE2E(server, accessToken, 'Prod', 10);
    const tab = (
      await request(server)
        .post('/v1/tabs')
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ branchId, tableId: table.id })
        .expect(201)
    ).body;
    await request(server)
      .post(`/v1/tabs/${tab.id}/items`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ productId: product.id, quantity: 1 })
      .expect(201);
    await request(server)
      .post(`/v1/tabs/${tab.id}/checkout`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ paymentMethod: 'PIX', idempotencyKey: `key-${tab.id}` })
      .expect(200);

    // Tab is CLOSED now (no longer OPEN), but the table's history must
    // still survive — deleting it would orphan that closed tab's FK.
    const blocked = await request(server)
      .delete(`/v1/tables/${table.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(409);
    expect(blocked.body.code).toBe('TABLE_HAS_TAB_HISTORY');
  });
});
