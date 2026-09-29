import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, uniqueSuffix, uniqueDocument } from './test-app.util';

// MANDATORY test per PROMPT 01, section 27: a user from tenant A must never
// be able to read or modify tenant B's data, regardless of the id they try.
describe('Tenant isolation (e2e)', () => {
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
    const res = await request(server).post('/v1/auth/register').send(payload).expect(201);
    return { accessToken: res.body.accessToken as string, user: res.body.user, payload };
  }

  it('tenant A cannot read a specific user belonging to tenant B', async () => {
    const tenantA = await registerTenant();
    const tenantB = await registerTenant();

    await request(server)
      .get(`/v1/users/${tenantB.user.id}`)
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .expect(404); // not 200, not 403-with-details — existence is not revealed either
  });

  it("tenant A's user list never contains tenant B's users", async () => {
    const tenantA = await registerTenant();
    const tenantB = await registerTenant();

    const listA = await request(server)
      .get('/v1/users')
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .expect(200);

    const ids: string[] = listA.body.map((u: { id: string }) => u.id);
    expect(ids).toContain(tenantA.user.id);
    expect(ids).not.toContain(tenantB.user.id);
  });

  it('tenant A cannot read tenant B\'s branch', async () => {
    const tenantA = await registerTenant();
    const tenantB = await registerTenant();

    const branchesB = await request(server)
      .get('/v1/branches')
      .set('Authorization', `Bearer ${tenantB.accessToken}`)
      .expect(200);
    const branchBId = branchesB.body[0].id;

    await request(server)
      .get(`/v1/branches/${branchBId}`)
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .expect(404);
  });

  it("/tenants/current always resolves to the caller's own tenant, never an id from the body", async () => {
    const tenantA = await registerTenant();
    const tenantB = await registerTenant();

    const res = await request(server)
      .get('/v1/tenants/current')
      // Even if a client tried to smuggle another tenant id in, the
      // controller never reads tenantId from anywhere but the JWT.
      .send({ tenantId: tenantB.user.tenantId })
      .set('Authorization', `Bearer ${tenantA.accessToken}`)
      .expect(200);

    expect(res.body.id).toBe(tenantA.user.tenantId);
    expect(res.body.id).not.toBe(tenantB.user.tenantId);
  });
});
