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

// No user-invite endpoint exists yet, so limited-role staff are inserted via
// Prisma (optionally linked to branches via UserBranch) and logged in for real.
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
