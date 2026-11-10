import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import * as argon2 from 'argon2';
import {
  createTestApp,
  getPrisma,
  provisionTenantE2E,
  tenantPayloadE2E,
  uniqueDocument,
  uniqueSuffix,
} from './test-app.util';
import { PlatformAdminsService } from '../src/modules/platform/platform-admins.service';
import { AuditService } from '../src/modules/audit/audit.service';

// The e-mail is the login and is compared without case (common/util/login-email.util.ts):
// stored trimmed and lower-cased from 2026-11-10 on, found in any case, including accounts
// stored with capitals before that day, which are never rewritten.
describe('Login e-mail without case (e2e)', () => {
  let app: INestApplication;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let server: any;

  const PASSWORD = 'Sup3rSecret!';
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const prisma = () => getPrisma(app);
  const tryLogin = (email: string, password = PASSWORD) =>
    request(server).post('/v1/auth/login').send({ email, password });

  let owner: { email: string; tenantId: string; userId: string; token: string };

  beforeAll(async () => {
    app = await createTestApp();
    server = app.getHttpServer();
    const payload = tenantPayloadE2E();
    const created = await provisionTenantE2E(app, payload);
    const login = await tryLogin(payload.email).expect(200);
    owner = {
      email: payload.email,
      tenantId: created.tenantId,
      userId: created.ownerUserId,
      token: login.body.accessToken,
    };
  });
  afterAll(async () => {
    await app.close();
  });

  // An account as it could exist before 2026-11-10: e-mail stored with capitals.
  async function legacyAccount(email: string) {
    const role = await prisma().role.findUniqueOrThrow({ where: { name: 'CASHIER' } });
    const user = await prisma().user.create({
      data: {
        tenantId: owner.tenantId,
        name: 'Conta antiga',
        email,
        passwordHash: await argon2.hash(PASSWORD),
        status: 'ACTIVE',
      },
    });
    await prisma().userRole.create({ data: { userId: user.id, roleId: role.id, tenantId: owner.tenantId } });
    return user;
  }

  describe('login', () => {
    it('accepts the e-mail in any case and with spaces around it', async () => {
      for (const typed of [owner.email.toUpperCase(), `  ${owner.email}  `, owner.email.replace(/^o/, 'O')]) {
        const res = await tryLogin(typed).expect(200);
        expect(res.body.user.email).toBe(owner.email);
      }
    });

    it('a wrong password in another case is still a failed login on that account', async () => {
      const before = await prisma().auditLog.count({ where: { userId: owner.userId, action: 'LOGIN_FAILED' } });
      const res = await tryLogin(owner.email.toUpperCase(), 'Errada#123').expect(401);
      expect(res.body.code).toBe('INVALID_CREDENTIALS');
      const after = await prisma().auditLog.count({ where: { userId: owner.userId, action: 'LOGIN_FAILED' } });
      expect(after).toBe(before + 1);
    });

    it('finds an account stored with capitals, and leaves its e-mail as it was', async () => {
      const stored = `Conta.Antiga-${uniqueSuffix()}@Example.COM`;
      const user = await legacyAccount(stored);
      await tryLogin(stored.toLowerCase()).expect(200);
      await tryLogin(stored).expect(200);
      const after = await prisma().user.findUniqueOrThrow({ where: { id: user.id } });
      expect(after.email).toBe(stored);
    });

    it('with two legacy accounts that differ only by case, only the exact spelling signs in', async () => {
      const suffix = uniqueSuffix();
      const upper = await legacyAccount(`Dupla-${suffix}@example.com`);
      const lower = await legacyAccount(`dupla-${suffix}@example.com`);
      const a = await tryLogin(`Dupla-${suffix}@example.com`).expect(200);
      expect(a.body.user.id).toBe(upper.id);
      const b = await tryLogin(`dupla-${suffix}@example.com`).expect(200);
      expect(b.body.user.id).toBe(lower.id);
      // Neither spelling: no guess about whose password to check.
      await tryLogin(`DUPLA-${suffix}@example.com`).expect(401);
    });

    it('an underscore is a letter, not a wildcard', async () => {
      const suffix = uniqueSuffix();
      await legacyAccount(`ana_caixa-${suffix}@example.com`);
      await tryLogin(`anaxcaixa-${suffix}@example.com`).expect(401);
      await tryLogin(`ANA_CAIXA-${suffix}@example.com`).expect(200);
    });
  });

  describe('staff accounts (POST /users)', () => {
    it('stores the e-mail lower-cased, and the person signs in typing it any way', async () => {
      const typed = ` Ana.Caixa-${uniqueSuffix()}@Example.COM `;
      const res = await request(server)
        .post('/v1/users')
        .set(auth(owner.token))
        .send({ name: 'Ana Caixa', email: typed, password: PASSWORD, role: 'CASHIER' })
        .expect(201);
      expect(res.body.email).toBe(typed.trim().toLowerCase());
      await tryLogin(typed.trim()).expect(200);
      await tryLogin(typed.trim().toLowerCase()).expect(200);
    });

    it('refuses an e-mail that already exists in another case, also a legacy one', async () => {
      const legacy = `Legado-${uniqueSuffix()}@Example.com`;
      await legacyAccount(legacy);
      for (const email of [legacy.toLowerCase(), owner.email.toUpperCase()]) {
        const res = await request(server)
          .post('/v1/users')
          .set(auth(owner.token))
          .send({ name: 'Repetida', email, password: PASSWORD, role: 'WAITER' })
          .expect(409);
        expect(res.body.code).toBe('EMAIL_ALREADY_EXISTS');
      }
    });
  });

  describe('provisioning', () => {
    it('stores the owner e-mail lower-cased and refuses it again in another case', async () => {
      const payload = tenantPayloadE2E();
      const mixed = payload.email.replace(/^owner/, 'Owner').toUpperCase();
      const created = await provisionTenantE2E(app, { ...payload, email: ` ${mixed} ` });
      const stored = await prisma().user.findUniqueOrThrow({ where: { id: created.ownerUserId } });
      expect(stored.email).toBe(payload.email);

      const again = { ...tenantPayloadE2E(), email: payload.email.toUpperCase() };
      await expect(provisionTenantE2E(app, again)).rejects.toMatchObject({
        response: { code: 'EMAIL_ALREADY_EXISTS' },
      });
    });

    it('the platform panel refuses an existing e-mail in another case', async () => {
      await prisma().platformAdmin.create({ data: { userId: owner.userId, grantedBy: 'e2e' } });
      try {
        const suffix = uniqueSuffix();
        const res = await request(server)
          .post('/v1/platform/tenants')
          .set(auth(owner.token))
          .send({
            tenantName: `Restaurante Caixa ${suffix}`,
            legalName: `Empresa Caixa ${suffix} LTDA`,
            document: uniqueDocument(),
            slug: `caixa-${suffix}`,
            branchName: 'Matriz',
            userName: 'Dona',
            email: owner.email.toUpperCase(),
            password: 'Senha#Painel-2026',
          })
          .expect(409);
        expect(res.body.code).toBe('EMAIL_ALREADY_EXISTS');
      } finally {
        await prisma().platformAdmin.delete({ where: { userId: owner.userId } });
      }
    });
  });

  // platform-admin:grant/revoke and user:reset-password look the account up through this. Only
  // the commands provide it (it is in no module of the API), so it is built here by hand.
  it('the administrative commands find the account in any case', async () => {
    const admins = new PlatformAdminsService(prisma(), app.get(AuditService));
    const found = await admins.findByEmail(` ${owner.email.toUpperCase()} `);
    expect(found?.id).toBe(owner.userId);
    expect(found?.email).toBe(owner.email);
  });
});
