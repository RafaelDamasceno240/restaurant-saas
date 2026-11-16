import { INestApplication } from '@nestjs/common';
import { spawn } from 'child_process';
import { join } from 'path';
import request from 'supertest';
import { createTestApp, getPrisma, provisionTenantE2E, tenantPayloadE2E } from './test-app.util';

// `user:reset-password` runs for real, as a separate process, against this suite's database and
// Redis (docs/authentication.md): the API under test must see the new password and the cut-off.
describe('user:reset-password CLI (e2e)', () => {
  let app: INestApplication;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let server: any;
  const API_DIR = join(__dirname, '..');
  const NEW_PASSWORD = 'Nova#Senha-E2E-2026';

  beforeAll(async () => {
    // Without DATABASE_URL the CLI would read apps/api/.env: never let it reach that here.
    if (!process.env.DATABASE_URL || !process.env.REDIS_URL)
      throw new Error('DATABASE_URL and REDIS_URL must point at the disposable e2e services');
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
            'src/cli/reset-password.ts',
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

  const login = (email: string, password: string) =>
    request(server).post('/v1/auth/login').send({ email, password });
  const cookieOf = (res: request.Response) =>
    (res.headers['set-cookie'] as unknown as string[])[0].split(';')[0];
  const me = (token: string) =>
    request(server).get('/v1/auth/me').set('Authorization', `Bearer ${token}`);

  it('cancelling changes nothing; REDEFINIR sets the password, ends every session and keeps OWNER, tenant and platform admin', async () => {
    const prisma = getPrisma(app);
    const payload = tenantPayloadE2E();
    const { ownerUserId, tenantId } = await provisionTenantE2E(app, payload);
    await prisma.platformAdmin.create({ data: { userId: ownerUserId, grantedBy: 'e2e' } });
    const other = tenantPayloadE2E();
    const { ownerUserId: otherId } = await provisionTenantE2E(app, other);
    const otherBefore = await prisma.user.findUniqueOrThrow({ where: { id: otherId } });
    const before = await prisma.user.findUniqueOrThrow({ where: { id: ownerUserId } });

    const session = await login(payload.email, payload.password).expect(200);
    const token = session.body.accessToken as string;
    const cookie = cookieOf(session);
    const otherSession = await login(other.email, other.password).expect(200);

    // Cancelled: nothing changes, the session goes on.
    const cancelled = await cli(
      ['--email', payload.email],
      `${NEW_PASSWORD}\n${NEW_PASSWORD}\nredefinir\n`,
    );
    expect(cancelled.code).toBe(1);
    expect(cancelled.stdout).toContain('Cancelado. Nada foi alterado.');
    expect((await prisma.user.findUniqueOrThrow({ where: { id: ownerUserId } })).passwordHash).toBe(
      before.passwordHash,
    );
    await me(token).expect(200);
    expect(
      await prisma.auditLog.count({
        where: { action: 'ADMIN_PASSWORD_RESET', entityId: ownerUserId },
      }),
    ).toBe(0);

    const done = await cli(
      ['--', '--email', payload.email],
      `${NEW_PASSWORD}\n${NEW_PASSWORD}\nREDEFINIR\n`,
    );
    expect(done.stderr).toBe('');
    expect(done.code).toBe(0);
    expect(done.stdout).toMatch(/^ {2}Papéis no restaurante:\s+OWNER$/m);
    expect(done.stdout).toMatch(/^ {2}Administrador da plataforma:\s+sim$/m);
    expect(done.stdout).toMatch(/^ {2}Sessões ativas:\s+1$/m);
    expect(done.stdout).toContain(`Senha de ${payload.email} redefinida.`);
    expect(done.stdout).toContain('Sessões encerradas: 1.');
    for (const output of [cancelled, done]) {
      expect(output.stdout + output.stderr).not.toContain(NEW_PASSWORD);
      expect(output.stdout + output.stderr).not.toContain('$argon2');
    }

    // The old access token and the old refresh cookie are dead at once.
    await me(token).expect(401);
    await request(server).post('/v1/auth/refresh').set('Cookie', cookie).expect(401);
    // The old password is refused; the new one works.
    await login(payload.email, payload.password).expect(401);
    const fresh = await login(payload.email, NEW_PASSWORD).expect(200);
    const profile = await me(fresh.body.accessToken).expect(200);
    expect(profile.body).toMatchObject({
      id: ownerUserId,
      tenantId,
      email: payload.email,
      roles: ['OWNER'],
      isPlatformAdmin: true,
    });
    await request(server)
      .get('/v1/platform/overview')
      .set('Authorization', `Bearer ${fresh.body.accessToken}`)
      .expect(200);

    // Nobody else changed.
    const otherAfter = await prisma.user.findUniqueOrThrow({ where: { id: otherId } });
    expect(otherAfter.passwordHash).toBe(otherBefore.passwordHash);
    await me(otherSession.body.accessToken).expect(200);
    await request(server)
      .post('/v1/auth/refresh')
      .set('Cookie', cookieOf(otherSession))
      .expect(200);

    // Audited, with no password nor hash.
    const audits = await prisma.auditLog.findMany({
      where: { action: 'ADMIN_PASSWORD_RESET', entityId: ownerUserId },
    });
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      tenantId,
      userId: ownerUserId,
      entity: 'User',
      userAgent: 'cli user:reset-password',
    });
    expect(audits[0].afterData).toMatchObject({
      email: payload.email,
      resetBy: expect.stringContaining('@'),
      sessionsEnded: 1,
    });
    const stored = JSON.stringify(audits[0]);
    expect(stored).not.toContain(NEW_PASSWORD);
    expect(stored).not.toContain(payload.password);
    expect(stored).not.toContain('$argon2');
  }, 120_000);

  it('a friendly error for an unknown e-mail, and a password on the command line is refused', async () => {
    const before = await getPrisma(app).user.count();
    const unknown = await cli(
      ['--email', 'ninguem-reset@example.com'],
      `${NEW_PASSWORD}\n${NEW_PASSWORD}\nREDEFINIR\n`,
    );
    expect(unknown.code).toBe(1);
    expect(unknown.stderr).toContain('Nenhuma conta com o e-mail "ninguem-reset@example.com"');
    expect(await getPrisma(app).user.count()).toBe(before);

    const inline = await cli(['--email', 'a@example.com', `--password=${NEW_PASSWORD}`]);
    expect(inline.code).toBe(2);
    expect(inline.stderr).toContain('não é aceita como opção de linha de comando');
    expect(inline.stdout + inline.stderr).not.toContain(NEW_PASSWORD);
  }, 120_000);
});
