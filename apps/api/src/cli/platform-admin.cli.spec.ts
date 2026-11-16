import { tmpdir } from 'os';
import { PlatformAdminCandidate } from '../modules/platform/platform-admins.service';
import {
  parsePlatformAdminArgs,
  PlatformAdminCliDeps,
  PlatformAdminContext,
  runPlatformAdminCli,
} from './platform-admin.cli';
import { Prompter, UsageError } from './provision-tenant.cli';

const URL_WITH_SECRET =
  'postgresql://saas:segredo-do-banco@db.example.com:6543/restaurant_saas_prod';

const candidate = (overrides: Partial<PlatformAdminCandidate> = {}): PlatformAdminCandidate => ({
  id: 'u1',
  name: 'Ana Plataforma',
  email: 'ana@example.com',
  status: 'ACTIVE',
  roles: ['OWNER'],
  tenant: { name: 'Equipe Plataforma', slug: 'equipe-plataforma', status: 'ACTIVE' },
  isPlatformAdmin: false,
  ...overrides,
});

async function run(options: {
  argv: string[];
  lines?: (string | null)[];
  user?: PlatformAdminCandidate | null;
  env?: NodeJS.ProcessEnv;
}) {
  const calls = { granted: [] as string[], revoked: [] as string[], opened: 0, closed: 0 };
  const lines = [...(options.lines ?? [])];
  const asked: string[] = [];
  const ask = async (question: string) => {
    asked.push(question);
    return lines.length ? (lines.shift() as string | null) : null;
  };
  const prompter: Prompter = { ask, askHidden: ask, close: () => undefined };
  const context: PlatformAdminContext = {
    describeServer: async () => ({ database: 'restaurant_saas_prod', version: '16.4' }),
    findByEmail: async () => (options.user === undefined ? candidate() : options.user),
    countAdmins: async () => 1,
    grant: async (userId) => {
      calls.granted.push(userId);
      return true;
    },
    revoke: async (userId) => {
      calls.revoked.push(userId);
      return true;
    },
    close: async () => {
      calls.closed++;
    },
  };
  const out: string[] = [];
  const err: string[] = [];
  const deps: PlatformAdminCliDeps = {
    argv: options.argv,
    env: options.env ?? { DATABASE_URL: URL_WITH_SECRET, NODE_ENV: 'production' },
    cwd: tmpdir(),
    prompter,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    openContext: async () => {
      calls.opened++;
      return context;
    },
    actor: 'operador@maquina',
  };
  const code = await runPlatformAdminCli(deps);
  return { code, out: out.join('\n'), err: err.join('\n'), asked, calls };
}

describe('platform-admin CLI', () => {
  it('reads grant/revoke, --email (also after "--") and --confirm-database', () => {
    expect(parsePlatformAdminArgs(['grant', '--', '--email', ' ana@example.com '])).toEqual({
      command: 'grant',
      email: 'ana@example.com',
      debug: false,
      help: false,
    });
    expect(
      parsePlatformAdminArgs(['revoke', '--email=a@b.com', '--confirm-database', 'db']),
    ).toMatchObject({
      command: 'revoke',
      email: 'a@b.com',
      confirmDatabase: 'db',
    });
    expect(() => parsePlatformAdminArgs(['--email', 'a@b.com'])).toThrow(UsageError);
    expect(() => parsePlatformAdminArgs(['grant', '--password', 'x'])).toThrow(UsageError);
    expect(() => parsePlatformAdminArgs(['grant', 'ana@example.com'])).toThrow(UsageError);
  });

  it('grant: shows the target database and the account, and grants only after CONCEDER', async () => {
    const r = await run({ argv: ['grant', '--email', 'ana@example.com'], lines: ['CONCEDER'] });

    expect(r.code).toBe(0);
    expect(r.calls.granted).toEqual(['u1']);
    expect(r.out).toContain('Banco alvo: restaurant_saas_prod em db.example.com:6543');
    for (const label of [
      'Banco',
      'Host',
      'Database',
      'Ambiente',
      'Usuário',
      'E-mail',
      'Restaurante da conta',
    ]) {
      expect(r.out).toMatch(new RegExp(`^  ${label}:`, 'm'));
    }
    expect(r.out).toContain('Ana Plataforma');
    expect(r.asked[r.asked.length - 1]).toBe(
      'Banco alvo: restaurant_saas_prod em db.example.com:6543. Digite CONCEDER para continuar: ',
    );
    expect(r.out).toContain('ana@example.com agora é administrador(a) da plataforma.');
    expect(r.out + r.err).not.toContain('segredo-do-banco');
    expect(r.calls.closed).toBe(1);
  });

  it.each(['conceder', 'sim', '', null])(
    'grant cancels on anything but CONCEDER (%p)',
    async (answer) => {
      const r = await run({ argv: ['grant', '--email', 'ana@example.com'], lines: [answer] });
      expect(r.code).toBe(1);
      expect(r.out).toContain('Cancelado. Nada foi alterado.');
      expect(r.calls.granted).toEqual([]);
    },
  );

  it('revoke: asks for REVOGAR and revokes', async () => {
    const r = await run({
      argv: ['revoke', '--email', 'ana@example.com'],
      lines: ['REVOGAR'],
      user: candidate({ isPlatformAdmin: true }),
    });
    expect(r.code).toBe(0);
    expect(r.calls.revoked).toEqual(['u1']);
    expect(r.asked[r.asked.length - 1]).toContain('Digite REVOGAR para continuar');
  });

  it('never creates an account: an unknown e-mail is refused', async () => {
    const r = await run({ argv: ['grant', '--email', 'ninguem@example.com'], user: null });
    expect(r.code).toBe(1);
    expect(r.err).toContain('Nenhuma conta com o e-mail "ninguem@example.com"');
    expect(r.calls.granted).toEqual([]);
  });

  it('refuses an inactive account, and does nothing twice', async () => {
    const inactive = await run({
      argv: ['grant', '--email', 'ana@example.com'],
      lines: ['CONCEDER'],
      user: candidate({ status: 'INACTIVE' }),
    });
    expect(inactive.code).toBe(1);
    expect(inactive.calls.granted).toEqual([]);

    const already = await run({
      argv: ['grant', '--email', 'ana@example.com'],
      user: candidate({ isPlatformAdmin: true }),
    });
    expect(already.code).toBe(0);
    expect(already.out).toContain('já é administradora da plataforma. Nada foi alterado.');
    expect(already.asked).toEqual([]);

    const notAdmin = await run({ argv: ['revoke', '--email', 'ana@example.com'] });
    expect(notAdmin.code).toBe(0);
    expect(notAdmin.out).toContain('não é administradora da plataforma. Nada foi alterado.');
    expect(notAdmin.calls.revoked).toEqual([]);
  });

  it('automation: --confirm-database must name the connected database', async () => {
    const ok = await run({
      argv: ['grant', '--email', 'ana@example.com', '--confirm-database', 'restaurant_saas_prod'],
    });
    expect(ok.code).toBe(0);
    expect(ok.asked).toEqual([]);
    expect(ok.calls.granted).toEqual(['u1']);

    const wrong = await run({
      argv: ['grant', '--email', 'ana@example.com', '--confirm-database', 'restaurant_saas'],
    });
    expect(wrong.code).toBe(2);
    expect(wrong.calls.granted).toEqual([]);
  });

  it('asks for the e-mail when it is not given, and stops without DATABASE_URL', async () => {
    const asked = await run({ argv: ['grant'], lines: ['ana@example.com', 'CONCEDER'] });
    expect(asked.asked[0]).toContain('E-mail da conta');
    expect(asked.calls.granted).toEqual(['u1']);

    const noUrl = await run({ argv: ['grant', '--email', 'ana@example.com'], env: {} });
    expect(noUrl.code).toBe(2);
    expect(noUrl.calls.opened).toBe(0);
  });
});
