import { randomInt } from 'crypto';
import request from 'supertest';
import * as argon2 from 'argon2';
import { RoleName } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { ProvisionTenantDto } from '../src/modules/tenants/dto/provision-tenant.dto';
import { TenantProvisioningService } from '../src/modules/tenants/tenant-provisioning.service';

// Boots a real Nest application against DATABASE_URL/REDIS_URL from the
// environment. Intended for a disposable test database — see
// docs/architecture.md "Testes" for how to point this at one.
// The app of the running spec, for helpers that only get the HTTP server (registerTenantE2E).
let currentApp: INestApplication | null = null;

export async function createTestApp(): Promise<INestApplication> {
  // Every spec registers and signs in far more often than a person would. The value is SET, not
  // defaulted: AppModule is imported at the top of this file and its ConfigModule has already
  // loaded apps/api/.env by now, so a `??=` would keep the 10 per minute of .env.example and
  // the suites would fail with 429. The limit is read per request, and the specs that test it
  // (security-hardening, trust-proxy) lower it themselves after the app is up.
  process.env.AUTH_RATE_LIMIT_PER_MINUTE = '10000';
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.use(cookieParser());
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  // Validation is provided by AppModule itself (StrictValidationPipe via
  // APP_PIPE) — adding another ValidationPipe here would stack another
  // global pipe in front of it and defeat @AllowExtraFields().
  await app.init();
  currentApp = app;
  return app;
}

export function getPrisma(app: INestApplication): PrismaService {
  return app.get(PrismaService);
}

// An in-memory counter is only unique within one process, but Jest runs each
// e2e spec file in its own worker process — every worker starts its counter
// back at 0, so two specs happily hand out the same suffix/document at the
// same time. crypto's randomInt has no such shared state, so it stays unique
// across parallel workers too.
export function uniqueSuffix(): string {
  return `${Date.now()}-${randomInt(0, 1_000_000_000)}`;
}

// Deterministic-shaped, always-14-digit numeric string — Tenant.document is
// unique, so every restaurant a test provisions needs a fresh one. See
// uniqueSuffix() above for why this can't be a simple counter.
export function uniqueDocument(): string {
  return String(randomInt(0, 100_000_000_000_000)).padStart(14, '0');
}

// ---------------------------------------------------------------------------
// Shared e2e helpers (fatia 08). Older specs keep their own local copies;
// new specs use these.
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HttpServer = any;

// There is no public sign-up (removed 2026-10-28), so the suites create their restaurants the way
// the system does: TenantProvisioningService, called on the app under test. It is reached through
// the Nest container of the spec, never over HTTP, so nothing here exists in a running API.
export function tenantPayloadE2E(): ProvisionTenantDto {
  const suffix = uniqueSuffix();
  return {
    tenantName: `Restaurante ${suffix}`,
    legalName: `Restaurante LTDA ${suffix}`,
    document: uniqueDocument(),
    slug: `tenant-${suffix}`,
    branchName: 'Matriz',
    userName: `Owner ${suffix}`,
    email: `owner-${suffix}@example.com`,
    password: 'Sup3rSecret!',
  };
}

export function provisionTenantE2E(app: INestApplication, payload: ProvisionTenantDto = tenantPayloadE2E()) {
  return app.get(TenantProvisioningService).provision(payload);
}

// Provisions the restaurant and signs its owner in for real (POST /auth/login). Returns the login
// response: `body.accessToken`, `body.user` and the refresh cookie in `set-cookie`, as the old
// sign-up response had. `forwardedFor` goes on the login request (trust-proxy.e2e-spec.ts).
export async function provisionAndSignInE2E(
  app: INestApplication,
  payload: ProvisionTenantDto = tenantPayloadE2E(),
  { forwardedFor }: { forwardedFor?: string } = {},
): Promise<request.Response> {
  await provisionTenantE2E(app, payload);
  const login = request(app.getHttpServer()).post('/v1/auth/login');
  if (forwardedFor) login.set('X-Forwarded-For', forwardedFor);
  return login.send({ email: payload.email, password: payload.password }).expect(200);
}

// B11: a new restaurant starts with delivery OFF. The suites here test orders, not onboarding, so
// by default the tenant gets delivery turned on (fee 0, no minimum) straight in the database, with
// no request and no audit entry that a suite could count. `{ delivery: false }` keeps the
// provisioning default (restaurant-onboarding.e2e-spec.ts checks it). The name is older than the
// end of the public sign-up; it provisions through the service like everything else here.
export async function registerTenantE2E(server: HttpServer, { delivery = true }: { delivery?: boolean } = {}) {
  if (!currentApp) throw new Error('createTestApp() must run before registerTenantE2E()');
  const payload = tenantPayloadE2E();
  const { tenantId, branchId } = await provisionTenantE2E(currentApp, payload);
  const login = await request(server)
    .post('/v1/auth/login')
    .send({ email: payload.email, password: payload.password })
    .expect(200);
  if (delivery) await enableDeliveryE2E(branchId);
  return {
    accessToken: login.body.accessToken as string,
    slug: payload.slug,
    tenantId,
    branchId,
  };
}

export async function enableDeliveryE2E(branchId: string) {
  if (!currentApp) throw new Error('createTestApp() must run before enableDeliveryE2E()');
  await getPrisma(currentApp).branch.update({ where: { id: branchId }, data: { deliveryEnabled: true } });
}

export async function createActiveProductE2E(
  server: HttpServer,
  token: string,
  name: string,
  price: number,
  active = true,
) {
  const category = await request(server)
    .post('/v1/categories')
    .set('Authorization', `Bearer ${token}`)
    .send({ name: `Categoria ${name} ${uniqueSuffix()}` })
    .expect(201);
  const product = await request(server)
    .post('/v1/products')
    .set('Authorization', `Bearer ${token}`)
    .send({ categoryId: category.body.id, name, price, active })
    .expect(201);
  return product.body as { id: string };
}

// Limited-role staff are inserted via Prisma (optionally linked to branches via UserBranch,
// including "no branch at all", which POST /users refuses) and logged in for real. The
// users API itself is covered by users-management.e2e-spec.ts.
export async function createStaffAndLoginE2E(
  app: INestApplication,
  server: HttpServer,
  tenantId: string,
  roleName: RoleName,
  branchIds: string[] = [],
) {
  const prisma = getPrisma(app);
  const email = `staff-${uniqueSuffix()}@example.com`;
  const password = 'Sup3rSecret!';
  const role = await prisma.role.findUniqueOrThrow({ where: { name: roleName } });
  const user = await prisma.user.create({
    data: {
      tenantId,
      name: `Staff ${roleName}`,
      email,
      passwordHash: await argon2.hash(password),
      status: 'ACTIVE',
    },
  });
  await prisma.userRole.create({ data: { userId: user.id, roleId: role.id, tenantId } });
  for (const branchId of branchIds) {
    await prisma.userBranch.create({ data: { userId: user.id, branchId } });
  }
  const login = await request(server).post('/v1/auth/login').send({ email, password }).expect(200);
  return login.body.accessToken as string;
}

// ---------------------------------------------------------------------------
// Proving that an audit entry is part of the business transaction: a trigger makes ONE
// tenant's inserts of ONE action fail, so the test can assert the operation rolled back
// with it. `name` keeps triggers of different spec files (run in parallel workers against
// the same database) from colliding. Always pair with removeAuditFailure() in afterEach.
// ---------------------------------------------------------------------------
export async function injectAuditFailure(app: INestApplication, name: string, tenantId: string, action: string) {
  const prisma = getPrisma(app);
  if (!/^[a-z_]+$/.test(name) || !/^[0-9a-f-]{36}$/.test(tenantId) || !/^[A-Z_]+$/.test(action)) {
    throw new Error('injectAuditFailure: unexpected identifier');
  }
  await prisma.$executeRawUnsafe(
    `CREATE OR REPLACE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $fn$
     BEGIN
       IF NEW."tenantId" = '${tenantId}' AND NEW."action" = '${action}' THEN
         RAISE EXCEPTION 'audit failure injected by test';
       END IF;
       RETURN NEW;
     END $fn$`,
  );
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON audit_logs`);
  await prisma.$executeRawUnsafe(
    `CREATE TRIGGER ${name} BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION ${name}()`,
  );
}

export async function removeAuditFailure(app: INestApplication, name: string) {
  const prisma = getPrisma(app);
  await prisma.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${name} ON audit_logs`);
  await prisma.$executeRawUnsafe(`DROP FUNCTION IF EXISTS ${name}()`);
}

// Body of PATCH /orders/:id/status. Since B5 (piloto 2026-10-23) a cancellation must say why, so
// specs that cancel only to exercise something else send a fixed reason through here.
export const E2E_CANCEL_REASON = 'Cancelado pelo teste e2e';
export function statusBody(status: string): { status: string; reason?: string } {
  return status === 'CANCELLED' ? { status, reason: E2E_CANCEL_REASON } : { status };
}

// B9: items reach a tab only in rounds sent to the kitchen (POST /v1/tabs/:id/rounds). Body of one
// round with a fresh idempotency key, for specs that only need items on the tab.
export function roundBody(items: { productId: string; quantity: number; notes?: string }[]) {
  return { idempotencyKey: `round-${uniqueSuffix()}`, items };
}
