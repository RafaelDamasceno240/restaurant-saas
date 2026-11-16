import { INestApplication } from '@nestjs/common';
import { spawn } from 'child_process';
import { join } from 'path';
import request from 'supertest';
import { createTestApp, getPrisma, provisionTenantE2E, tenantPayloadE2E } from './test-app.util';

// The bootstrap of the first platform administrator: `platform-admin:grant` / `:revoke` run for
// real, as a separate process, against this suite's database (docs/SUPER_ADMIN.md).
describe('platform-admin CLI (e2e)', () => {
  let app: INestApplication;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let server: any;
  const API_DIR = join(__dirname, '..');

  beforeAll(async () => {
    // Without DATABASE_URL the CLI would read apps/api/.env: never let it reach that here.
    if (!process.env.DATABASE_URL)
      throw new Error('DATABASE_URL must point at the disposable e2e database');
    app = await createTestApp();
    server = app.getHttpServer();
  });

  afterAll(async () => {
    await app.close();
  });

  function cli(args: string[], input = '') {
    return new Promise<{ code: number | null; stdout: string; stderr: string }>(
      (resolve, reject) => {
        const child = spawn(
          process.execPath,
          [
            '-r',
            require.resolve('ts-node/register/transpile-only'),
            'src/cli/platform-admin.ts',
            ...args,
          ],
          { cwd: API_DIR, env: { ...process.env, NODE_ENV: 'test' } },
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

  const databaseName = () => new URL(process.env.DATABASE_URL as string).pathname.slice(1);

  it('grants to an existing account after CONCEDER, the account gets into /platform, and revoke takes it away', async () => {
    const payload = tenantPayloadE2E();
    const { ownerUserId } = await provisionTenantE2E(app, payload);
    const login = await request(server)
      .post('/v1/auth/login')
      .send({ email: payload.email, password: payload.password })
      .expect(200);
    const token = login.body.accessToken as string;
    await request(server)
      .get('/v1/platform/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);

    const cancelled = await cli(['grant', '--email', payload.email], 'conceder\n');
    expect(cancelled.code).toBe(1);
    expect(cancelled.stdout).toContain('Cancelado. Nada foi alterado.');
    expect(await getPrisma(app).platformAdmin.count({ where: { userId: ownerUserId } })).toBe(0);

    const granted = await cli(['grant', '--', '--email', payload.email], 'CONCEDER\n');
    expect(granted.stderr).toBe('');
    expect(granted.code).toBe(0);
    expect(granted.stdout).toContain(`Banco alvo: ${databaseName()} em `);
    expect(granted.stdout).toMatch(/^ {2}Usuário:\s+Owner /m);
    expect(granted.stdout).toContain(`${payload.email} agora é administrador(a) da plataforma.`);
    // The same token: the guard reads the table on every request.
    await request(server)
      .get('/v1/platform/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(200);

    const audit = await getPrisma(app).auditLog.findFirstOrThrow({
      where: { action: 'PLATFORM_ADMIN_GRANTED', entityId: ownerUserId },
    });
    expect(audit).toMatchObject({ userAgent: 'cli platform-admin:grant' });
    expect(audit.afterData).toMatchObject({
      email: payload.email,
      grantedBy: expect.stringContaining('@'),
    });

    const revoked = await cli([
      'revoke',
      '--email',
      payload.email,
      '--confirm-database',
      databaseName(),
    ]);
    expect(revoked.code).toBe(0);
    expect(revoked.stdout).toContain('deixou de ser administrador(a) da plataforma');
    await request(server)
      .get('/v1/platform/overview')
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  }, 120_000);

  it('never creates an account, and a wrong --confirm-database changes nothing', async () => {
    const before = await getPrisma(app).user.count();
    const unknown = await cli([
      'grant',
      '--email',
      'ninguem-plataforma@example.com',
      '--confirm-database',
      databaseName(),
    ]);
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('Nenhuma conta com o e-mail');
    expect(await getPrisma(app).user.count()).toBe(before);

    const payload = tenantPayloadE2E();
    const { ownerUserId } = await provisionTenantE2E(app, payload);
    const wrong = await cli([
      'grant',
      '--email',
      payload.email,
      '--confirm-database',
      'restaurant_saas',
    ]);
    expect(wrong.code).toBe(2);
    expect(await getPrisma(app).platformAdmin.count({ where: { userId: ownerUserId } })).toBe(0);
  }, 120_000);
});
