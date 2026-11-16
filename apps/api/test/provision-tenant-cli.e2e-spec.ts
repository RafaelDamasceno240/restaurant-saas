import { ConflictException, INestApplication } from '@nestjs/common';
import { spawn } from 'child_process';
import { join } from 'path';
import request from 'supertest';
import {
  createTestApp,
  getPrisma,
  provisionTenantE2E,
  tenantPayloadE2E,
  uniqueDocument,
  uniqueSuffix,
} from './test-app.util';

// The administrative CLI (src/cli/provision-tenant.ts) run for real, as a separate process, the way
// docs/PROVISIONING.md tells an operator to run it, against this suite's database. Answers go in
// through stdin, as a person would type them; OWNER_PASSWORD and the options as automation would.
describe('tenant:provision CLI (e2e)', () => {
  let app: INestApplication;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let server: any;
  const API_DIR = join(__dirname, '..');
  const PASSWORD = 'Senha#Cli-2026';
  const ENTRY = 'src/cli/provision-tenant.ts';

  beforeAll(async () => {
    // The CLI falls back to apps/api/.env without DATABASE_URL: never let it reach that here.
    if (!process.env.DATABASE_URL)
      throw new Error('DATABASE_URL must point at the disposable e2e database');
    app = await createTestApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  function cli(
    args: string[],
    { input = '', env = {} }: { input?: string; env?: Record<string, string> } = {},
  ) {
    const childEnv: NodeJS.ProcessEnv = {
      ...process.env,
      NODE_ENV: 'test',
      CORS_ORIGIN: 'http://painel.example.test',
      ...env,
    };
    if (!env.OWNER_PASSWORD) delete childEnv.OWNER_PASSWORD;
    return new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          ['-r', require.resolve('ts-node/register/transpile-only'), ENTRY, ...args],
          {
            cwd: API_DIR,
            env: childEnv,
          },
        );
        let stdout = '';
        let stderr = '';
        child.stdout.on('data', (chunk) => (stdout += chunk.toString()));
        child.stderr.on('data', (chunk) => (stderr += chunk.toString()));
        child.on('error', reject);
        child.on('close', (code) => resolve({ code, stdout, stderr }));
        child.stdin.end(input);
      },
    );
  }

  const typed = (
    payload: ReturnType<typeof tenantPayloadE2E>,
    password: string,
    confirmation: string,
  ) =>
    [
      payload.tenantName,
      payload.legalName,
      payload.document,
      payload.slug,
      payload.branchName,
      payload.userName,
      payload.email,
      password,
      password,
      confirmation,
    ].join('\n') + '\n';

  const flags = (payload: ReturnType<typeof tenantPayloadE2E>) => [
    '--tenant-name',
    payload.tenantName,
    '--legal-name',
    payload.legalName,
    '--document',
    payload.document,
    '--slug',
    payload.slug,
    '--branch-name',
    payload.branchName,
    '--owner-name',
    payload.userName,
    '--email',
    payload.email,
  ];

  const databaseName = () => new URL(process.env.DATABASE_URL as string).pathname.slice(1);

  const footprint = async (payload: { slug: string; document: string; email: string }) => {
    const prisma = getPrisma(app);
    return {
      tenants: await prisma.tenant.count({
        where: { OR: [{ slug: payload.slug }, { document: payload.document }] },
      }),
      users: await prisma.user.count({ where: { email: payload.email } }),
      branches: await prisma.branch.count({ where: { tenant: { slug: payload.slug } } }),
    };
  };
  const totals = async () => {
    const prisma = getPrisma(app);
    return {
      tenants: await prisma.tenant.count(),
      branches: await prisma.branch.count(),
      users: await prisma.user.count(),
      userRoles: await prisma.userRole.count(),
      userBranches: await prisma.userBranch.count(),
      provisionedAudits: await prisma.auditLog.count({ where: { action: 'TENANT_PROVISIONED' } }),
    };
  };
  const noStack = (text: string) => expect(text).not.toMatch(/\n\s+at /);

  it('interactive: asks, shows the target, creates after CRIAR; the owner signs in and sees only their restaurant', async () => {
    const payload = {
      ...tenantPayloadE2E(),
      tenantName: 'Restaurante Teste CLI',
      branchName: 'Matriz',
    };
    const result = await cli([], { input: typed(payload, PASSWORD, 'CRIAR') });

    expect(result.stderr).toBe('');
    expect(result.code).toBe(0);
    expect(result.stdout).toContain(`Banco alvo: ${databaseName()} em `);
    // Each question explains itself and gives an example; the answer goes on its "> " line.
    for (const shown of [
      'Nome do restaurante\nNome comercial que aparecerá no sistema.\nExemplo: Restaurante Central\n> ',
      'Razão social\nNome jurídico da empresa.\nExemplo: Empresa Central LTDA\n> ',
      'CNPJ/CPF\nDocumento do responsável ou da empresa, somente números',
      'Exemplo: 12345678000199\n> ',
      'Slug\nIdentificador usado na URL.',
      'Exemplo: restaurante-central\n> ',
      'Unidade principal\nNome da primeira loja/unidade.\nExemplo: Matriz Centro\n> ',
      'Nome do proprietário\nNome do usuário OWNER que receberá acesso.\nExemplo: João da Silva\n> ',
      'E-mail do proprietário\nSerá usado para entrar no sistema.\nExemplo: contato@empresa.com.br\n> ',
      'Senha inicial\nSenha temporária/inicial do OWNER. Não aparece enquanto é digitada.',
      'Exemplo: use uma senha forte com letras, números e símbolos (mínimo 8 caracteres)\n> ',
      'Confirmar senha\nDigite a mesma senha de novo.\n> ',
    ]) {
      expect(result.stdout).toContain(shown);
    }
    expect(result.stdout).toContain('. Digite CRIAR para continuar: ');
    expect(result.stdout).toMatch(/^ {2}Ambiente:\s+test \(NODE_ENV\)$/m);
    expect(result.stdout).toContain('Restaurante criado com sucesso.');
    expect(result.stdout).toContain(
      `Restaurante: Restaurante Teste CLI\nSlug: ${payload.slug}\nUnidade: Matriz\nOWNER: ${payload.email}`,
    );
    expect(result.stdout).toContain('Delivery: desligado');
    expect(result.stdout).toContain('Acesso:\nhttp://painel.example.test/login');
    expect(result.stdout + result.stderr).not.toContain(PASSWORD);
    expect(result.stdout + result.stderr).not.toMatch(/\$argon2/);

    const prisma = getPrisma(app);
    const tenant = await prisma.tenant.findUniqueOrThrow({
      where: { slug: payload.slug },
      include: { branches: true },
    });
    expect(tenant).toMatchObject({
      name: 'Restaurante Teste CLI',
      document: payload.document,
      status: 'TRIAL',
      timezone: 'America/Sao_Paulo',
    });
    expect(tenant.branches).toEqual([
      expect.objectContaining({
        name: 'Matriz',
        code: 'MATRIZ',
        deliveryEnabled: false,
        status: 'ACTIVE',
      }),
    ]);
    const owner = await prisma.user.findUniqueOrThrow({
      where: { email: payload.email },
      include: { userRoles: { include: { role: true } }, userBranches: true },
    });
    expect(owner).toMatchObject({ tenantId: tenant.id, status: 'ACTIVE' });
    expect(owner.passwordHash).not.toContain(PASSWORD);
    expect(owner.userRoles.map((ur) => [ur.role.name, ur.tenantId])).toEqual([
      ['OWNER', tenant.id],
    ]);
    expect(owner.userBranches.map((ub) => ub.branchId)).toEqual([tenant.branches[0].id]);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'TENANT_PROVISIONED', entityId: tenant.id },
    });
    expect(audit).toMatchObject({
      tenantId: tenant.id,
      userId: owner.id,
      userAgent: 'cli tenant:provision',
    });
    expect(audit.afterData).toMatchObject({
      slug: payload.slug,
      ownerEmail: payload.email,
      provisionedBy: expect.stringContaining('@'),
    });
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);

    const login = await request(server)
      .post('/v1/auth/login')
      .send({ email: payload.email, password: PASSWORD })
      .expect(200);
    expect(login.body.user).toMatchObject({ tenantId: tenant.id, roles: ['OWNER'] });
    const token = login.body.accessToken as string;
    const branches = await request(server)
      .get('/v1/branches/accessible')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(branches.body.map((b: { id: string }) => b.id)).toEqual([tenant.branches[0].id]);
    const other = await provisionTenantE2E(app);
    await request(server)
      .get(`/v1/users/${other.ownerUserId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
  }, 90_000);

  it('automation: options, OWNER_PASSWORD and --confirm-database, no question asked', async () => {
    const payload = tenantPayloadE2E();
    const result = await cli([...flags(payload), '--confirm-database', databaseName()], {
      env: { OWNER_PASSWORD: PASSWORD },
    });

    expect(result.code).toBe(0);
    expect(result.stdout).not.toMatch(/Digite CRIAR|Exemplo:|Senha inicial\n|\n> /);
    expect(result.stdout + result.stderr).not.toContain(PASSWORD);
    await request(server)
      .post('/v1/auth/login')
      .send({ email: payload.email, password: PASSWORD })
      .expect(200);
  }, 90_000);

  it.each(['criar', 'não', ''])(
    'anything but CRIAR (%p) cancels and creates nothing',
    async (answer) => {
      const payload = tenantPayloadE2E();
      const before = await totals();
      const result = await cli([], { input: typed(payload, PASSWORD, answer) });

      expect(result.code).toBe(1);
      expect(result.stdout).toContain('Cancelado. Nada foi criado.');
      expect(await footprint(payload)).toEqual({ tenants: 0, users: 0, branches: 0 });
      expect(await totals()).toEqual(before);
    },
    90_000,
  );

  it('a slug, a document or an e-mail already in use: a plain message, exit 1, nothing created', async () => {
    const existing = tenantPayloadE2E();
    await provisionTenantE2E(app, existing);
    const before = await totals();

    for (const [clash, message] of [
      [{ slug: existing.slug }, `Já existe um restaurante com o slug "${existing.slug}".`],
      [{ document: existing.document }, 'Já existe um restaurante com este CNPJ/CPF.'],
      [{ email: existing.email }, `Já existe uma conta com o e-mail "${existing.email}".`],
    ] as const) {
      const payload = { ...tenantPayloadE2E(), ...clash };
      const result = await cli([], { input: typed(payload, PASSWORD, 'CRIAR') });
      expect(result.code).toBe(1);
      expect(result.stderr).toContain(message);
      expect(result.stderr).toContain('Nada foi criado.');
      expect(result.stdout).not.toContain('Digite CRIAR');
      noStack(result.stdout + result.stderr);
    }
    expect(await totals()).toEqual(before);
  }, 120_000);

  it('invalid data, a wrong --confirm-database or a password option: refused, nothing created', async () => {
    const before = await totals();

    const invalid = await cli([], {
      input: typed({ ...tenantPayloadE2E(), slug: 'Slug Inválido' }, PASSWORD, 'CRIAR'),
    });
    expect(invalid.code).toBe(1);
    expect(invalid.stderr).toContain('Dados inválidos. Nada foi criado:');

    const payload = tenantPayloadE2E();
    const wrongDb = await cli([...flags(payload), '--confirm-database', 'restaurant_saas'], {
      env: { OWNER_PASSWORD: PASSWORD },
    });
    expect(wrongDb.code).toBe(2);
    expect(wrongDb.stderr).toContain(`não confere com o banco alvo "${databaseName()}"`);

    const passwordOption = await cli([...flags(payload), '--password', PASSWORD]);
    expect(passwordOption.code).toBe(2);
    expect(passwordOption.stdout + passwordOption.stderr).not.toContain(PASSWORD);

    for (const r of [invalid, wrongDb, passwordOption]) noStack(r.stdout + r.stderr);
    expect(await footprint(payload)).toEqual({ tenants: 0, users: 0, branches: 0 });
    expect(await totals()).toEqual(before);
  }, 120_000);

  describe('the service underneath (source of truth)', () => {
    it('a failure in the middle of the creation leaves nothing behind', async () => {
      const prisma = getPrisma(app);
      const payload = tenantPayloadE2E();
      const before = await totals();
      // The last insert of the transaction (owner -> branch link) fails: tenant, branch, user and
      // role were already written inside it.
      await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION e2e_fail_provisioning() RETURNS trigger LANGUAGE plpgsql AS $fn$
        BEGIN RAISE EXCEPTION 'provisioning failure injected by test'; END $fn$`);
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS e2e_fail_provisioning ON user_branches',
      );
      await prisma.$executeRawUnsafe(
        'CREATE TRIGGER e2e_fail_provisioning BEFORE INSERT ON user_branches FOR EACH ROW EXECUTE FUNCTION e2e_fail_provisioning()',
      );
      try {
        await expect(provisionTenantE2E(app, payload)).rejects.toThrow(
          /provisioning failure injected/,
        );
      } finally {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER IF EXISTS e2e_fail_provisioning ON user_branches',
        );
        await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS e2e_fail_provisioning()');
      }
      expect(await footprint(payload)).toEqual({ tenants: 0, users: 0, branches: 0 });
      expect(await totals()).toEqual(before);
    });

    it('the audit entry is part of the transaction: if it cannot be written, nothing is created', async () => {
      const prisma = getPrisma(app);
      const payload = tenantPayloadE2E();
      const before = await totals();
      await prisma.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION e2e_fail_provision_audit() RETURNS trigger LANGUAGE plpgsql AS $fn$
        BEGIN IF NEW."action" = 'TENANT_PROVISIONED' THEN RAISE EXCEPTION 'audit failure injected by test'; END IF; RETURN NEW; END $fn$`);
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS e2e_fail_provision_audit ON audit_logs',
      );
      await prisma.$executeRawUnsafe(
        'CREATE TRIGGER e2e_fail_provision_audit BEFORE INSERT ON audit_logs FOR EACH ROW EXECUTE FUNCTION e2e_fail_provision_audit()',
      );
      try {
        await expect(provisionTenantE2E(app, payload)).rejects.toThrow(/audit failure injected/);
      } finally {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER IF EXISTS e2e_fail_provision_audit ON audit_logs',
        );
        await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS e2e_fail_provision_audit()');
      }
      expect(await footprint(payload)).toEqual({ tenants: 0, users: 0, branches: 0 });
      expect(await totals()).toEqual(before);
    });

    it('two provisionings of the same restaurant at once: one is created, the other is a 409', async () => {
      const payload = {
        ...tenantPayloadE2E(),
        document: uniqueDocument(),
        slug: `corrida-${uniqueSuffix()}`,
      };
      const results = await Promise.allSettled([
        provisionTenantE2E(app, payload),
        provisionTenantE2E(app, { ...payload }),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual(['fulfilled', 'rejected']);
      const refused = results.find((r) => r.status === 'rejected') as PromiseRejectedResult;
      expect(refused.reason).toBeInstanceOf(ConflictException);
      expect(await footprint(payload)).toEqual({ tenants: 1, users: 1, branches: 1 });
    });
  });

  it('the CLI is not a route: the API has nothing that provisions over HTTP', async () => {
    const payload = tenantPayloadE2E();
    for (const path of [
      '/v1/auth/register',
      '/v1/tenants',
      '/v1/tenants/provision',
      '/v1/admin/tenants',
      '/v1/provision',
    ]) {
      await request(server).post(path).send(payload).expect(404);
    }
    expect(await footprint(payload)).toEqual({ tenants: 0, users: 0, branches: 0 });
  });
});
