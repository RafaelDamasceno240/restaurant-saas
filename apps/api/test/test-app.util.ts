import { randomInt } from 'crypto';
import request from 'supertest';
import * as argon2 from 'argon2';
import { RoleName } from '@prisma/client';
import { Test } from '@nestjs/testing';
import { INestApplication, VersioningType } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

// Boots a real Nest application against DATABASE_URL/REDIS_URL from the
// environment. Intended for a disposable test database — see
// docs/architecture.md "Testes" for how to point this at one.
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
// unique, so every register() call in a test needs a fresh one. See
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

export async function registerTenantE2E(server: HttpServer) {
  const suffix = uniqueSuffix();
  const payload = {
    tenantName: `Restaurante ${suffix}`,
    legalName: `Restaurante LTDA ${suffix}`,
    document: uniqueDocument(),
    slug: `tenant-${suffix}`,
    branchName: 'Matriz',
    userName: `Owner ${suffix}`,
    email: `owner-${suffix}@example.com`,
    password: 'Sup3rSecret!',
  };
  const res = await request(server).post('/v1/auth/register').send(payload).expect(201);
  const accessToken = res.body.accessToken as string;
  const branches = await request(server)
    .get('/v1/branches/accessible')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(200);
  return {
    accessToken,
    slug: payload.slug,
    tenantId: res.body.user.tenantId as string,
    branchId: branches.body[0].id as string,
  };
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
