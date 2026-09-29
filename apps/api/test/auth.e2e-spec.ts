import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp, uniqueSuffix, uniqueDocument } from './test-app.util';

describe('Auth flow (e2e)', () => {
  let app: INestApplication;
  // supertest's typings want a `Server`, and Nest's getHttpServer() return
  // type varies by version — letting it infer avoids fighting either one.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let server: any;

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  function registerPayload() {
    const suffix = uniqueSuffix();
    return {
      tenantName: `Restaurante Teste ${suffix}`,
      legalName: `Restaurante Teste LTDA ${suffix}`,
      document: uniqueDocument(),
      slug: `restaurante-teste-${suffix}`,
      branchName: 'Matriz',
      userName: 'Owner Teste',
      email: `owner-${suffix}@example.com`,
      password: 'Sup3rSecret!',
    };
  }

  it('registers a tenant + owner and returns tokens', async () => {
    const payload = registerPayload();
    const response = await request(server).post('/v1/auth/register').send(payload).expect(201);

    expect(response.body.accessToken).toBeDefined();
    expect(response.body.user.email).toBe(payload.email);
    expect(response.body.user.roles).toContain('OWNER');
    expect(response.headers['set-cookie']?.[0]).toMatch(/refresh_token=/);
  });

  // Regression test for the Path mismatch bug: a refresh_token cookie
  // scoped to '/auth' (or '/v1/auth') is never sent back by a real browser
  // to the versioned '/v1/auth/refresh' endpoint, nor is it ever visible to
  // apps/web's middleware.ts (a different origin checking a request to
  // '/dashboard'). This test inspects the raw Set-Cookie attributes —
  // something `.set('Cookie', cookie)` in the other tests can never catch,
  // since supertest injects the header directly and bypasses the browser's
  // path-matching logic entirely. See docs/authentication.md "Escopo do
  // cookie de refresh".
  it('sets the refresh_token cookie with Path=/ so it survives URI versioning and the frontend origin', async () => {
    const payload = registerPayload();
    const response = await request(server).post('/v1/auth/register').send(payload).expect(201);

    const setCookie: string = response.headers['set-cookie'][0];
    expect(setCookie).toMatch(/refresh_token=/);
    expect(setCookie).toMatch(/Path=\//);
    expect(setCookie).not.toMatch(/Path=\/auth/);
    expect(setCookie).not.toMatch(/Path=\/v1\/auth/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });

  it('rejects duplicate slug/document on register', async () => {
    const payload = registerPayload();
    await request(server).post('/v1/auth/register').send(payload).expect(201);
    await request(server).post('/v1/auth/register').send(payload).expect(409);
  });

  it('logs in with correct credentials and rejects wrong password', async () => {
    const payload = registerPayload();
    await request(server).post('/v1/auth/register').send(payload).expect(201);

    await request(server)
      .post('/v1/auth/login')
      .send({ email: payload.email, password: 'wrong-password' })
      .expect(401);

    const ok = await request(server)
      .post('/v1/auth/login')
      .send({ email: payload.email, password: payload.password })
      .expect(200);

    expect(ok.body.accessToken).toBeDefined();
  });

  it('returns the authenticated user on /auth/me', async () => {
    const payload = registerPayload();
    const registerRes = await request(server).post('/v1/auth/register').send(payload).expect(201);
    const accessToken = registerRes.body.accessToken;

    const me = await request(server)
      .get('/v1/auth/me')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(me.body.email).toBe(payload.email);
  });

  it('rejects /auth/me without a token', async () => {
    await request(server).get('/v1/auth/me').expect(401);
  });

  it('rotates tokens on /auth/refresh using the httpOnly cookie', async () => {
    const payload = registerPayload();
    const registerRes = await request(server).post('/v1/auth/register').send(payload).expect(201);
    const cookie = registerRes.headers['set-cookie'][0];

    const refreshed = await request(server)
      .post('/v1/auth/refresh')
      .set('Cookie', cookie)
      .expect(200);

    expect(refreshed.body.accessToken).toBeDefined();
    expect(refreshed.body.accessToken).not.toBe(registerRes.body.accessToken);

    // The rotated (old) refresh token must no longer be usable.
    await request(server).post('/v1/auth/refresh').set('Cookie', cookie).expect(401);
  });

  it('logs out and revokes the refresh token', async () => {
    const payload = registerPayload();
    const registerRes = await request(server).post('/v1/auth/register').send(payload).expect(201);
    const cookie = registerRes.headers['set-cookie'][0];
    const accessToken = registerRes.body.accessToken;

    const logoutRes = await request(server)
      .post('/v1/auth/logout')
      .set('Authorization', `Bearer ${accessToken}`)
      .set('Cookie', cookie)
      .expect(204);

    // clearCookie must be issued with the SAME Path used to set the cookie
    // (Path=/) — a mismatched Path means the browser never actually deletes
    // it, silently leaving a revoked-but-still-present cookie behind.
    const clearedCookie: string | undefined = logoutRes.headers['set-cookie']?.[0];
    expect(clearedCookie).toBeDefined();
    expect(clearedCookie).toMatch(/Path=\//);

    await request(server).post('/v1/auth/refresh').set('Cookie', cookie).expect(401);
  });
});
