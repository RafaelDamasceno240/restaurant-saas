import { mkdtempSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { AdminPasswordResetResult } from '../modules/auth/admin-password-reset.service';
import { PlatformAdminCandidate } from '../modules/platform/platform-admins.service';
import { Prompter, UsageError } from './provision-tenant.cli';
import {
  parseResetPasswordArgs,
  ResetPasswordCliDeps,
  ResetPasswordContext,
  runResetPasswordCli,
} from './reset-password.cli';

const URL_WITH_SECRET =
  'postgresql://saas:segredo-do-banco@db.example.com:6543/restaurant_saas_prod';
const REDIS_WITH_SECRET = 'redis://:segredo-do-redis@cache.example.com:6380/2';
const NEW_PASSWORD = 'Nova#Senha-2026';

const candidate = (overrides: Partial<PlatformAdminCandidate> = {}): PlatformAdminCandidate => ({
  id: 'u1',
  name: 'Ana Dona',
  email: 'ana@example.com',
  status: 'ACTIVE',
  roles: ['OWNER'],
  tenant: { name: 'Restaurante Central', slug: 'restaurante-central', status: 'ACTIVE' },
  isPlatformAdmin: true,
  ...overrides,
});

async function run(options: {
  argv: string[];
  lines?: (string | null)[];
  user?: PlatformAdminCandidate | null;
  env?: NodeJS.ProcessEnv;
  cwd?: string;
  redis?: boolean;
  result?: AdminPasswordResetResult;
  resetError?: Error;
}) {
  const calls = {
    resets: [] as { userId: string; password: string; actor: string }[],
    opened: [] as string[][],
    closed: 0,
  };
  const lines = [...(options.lines ?? [])];
  const asked: { question: string; hidden: boolean }[] = [];
  const answer = (hidden: boolean) => async (question: string) => {
    asked.push({ question, hidden });
    return lines.length ? (lines.shift() as string | null) : null;
  };
  const prompter: Prompter = {
    ask: answer(false),
    askHidden: answer(true),
    close: () => undefined,
  };
  const context: ResetPasswordContext = {
    describeServer: async () => ({
      database: 'restaurant_saas_prod',
      version: '16.4',
      systemIdentifier: '7690370053421789218',
    }),
    findByEmail: async () => (options.user === undefined ? candidate() : options.user),
    activeSessions: async () => 3,
    redisReachable: async () => options.redis ?? true,
    reset: async (userId, password, actor) => {
      if (options.resetError) throw options.resetError;
      calls.resets.push({ userId, password, actor });
      return options.result ?? { sessionsEnded: 3, accessTokensCut: true };
    },
    close: async () => {
      calls.closed++;
    },
  };
  const out: string[] = [];
  const err: string[] = [];
  const deps: ResetPasswordCliDeps = {
    argv: options.argv,
    env: options.env ?? {
      DATABASE_URL: URL_WITH_SECRET,
      REDIS_URL: REDIS_WITH_SECRET,
      NODE_ENV: 'production',
    },
    cwd: options.cwd ?? tmpdir(),
    prompter,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    openContext: async (...target) => {
      calls.opened.push(target);
      return context;
    },
    actor: 'operador@maquina',
  };
  const code = await runResetPasswordCli(deps);
  return { code, out: out.join('\n'), err: err.join('\n'), asked, calls };
}

const RESET = ['--email', 'ana@example.com'];
const CONFIRMED = [NEW_PASSWORD, NEW_PASSWORD, 'REDEFINIR'];

describe('user:reset-password CLI', () => {
  it('reads --email (also after "--"), and never a password', () => {
    expect(parseResetPasswordArgs(['--', '--email', ' ana@example.com '])).toEqual({
      email: 'ana@example.com',
      debug: false,
      help: false,
    });
    expect(parseResetPasswordArgs(['--email=a@b.com', '--debug']).email).toBe('a@b.com');
    for (const flag of ['--password', '--senha', '--new-password=x', '--nova-senha']) {
      expect(() => parseResetPasswordArgs(['--email', 'a@b.com', flag, 'x'])).toThrow(
        /não é aceita como opção/,
      );
    }
    expect(() => parseResetPasswordArgs(['ana@example.com'])).toThrow(UsageError);
    expect(() => parseResetPasswordArgs(['--role', 'OWNER'])).toThrow(UsageError);
  });

  it('a password on the command line stops it before connecting', async () => {
    const r = await run({ argv: [...RESET, '--password', NEW_PASSWORD] });
    expect(r.code).toBe(2);
    expect(r.calls.opened).toEqual([]);
    expect(r.out + r.err).not.toContain(NEW_PASSWORD);
  });

  it('shows the target and the account, asks the password twice without echo, and resets only after REDEFINIR', async () => {
    const r = await run({ argv: RESET, lines: CONFIRMED });

    expect(r.code).toBe(0);
    expect(r.calls.resets).toEqual([
      { userId: 'u1', password: NEW_PASSWORD, actor: 'operador@maquina' },
    ]);
    expect(r.calls.opened).toEqual([[URL_WITH_SECRET, REDIS_WITH_SECRET, '15m']]);
    expect(r.out).toContain('Banco alvo: restaurant_saas_prod em db.example.com:6543');
    for (const [label, value] of [
      ['Database', 'restaurant_saas_prod'],
      ['Host', 'db.example.com:6543'],
      ['Identificador do cluster', '7690370053421789218'],
      ['Ambiente', 'production'],
      ['Redis das sessões', 'cache.example.com:6380/2'],
      ['Usuário', 'Ana Dona'],
      ['E-mail', 'ana@example.com'],
      ['Restaurante da conta', 'Restaurante Central (restaurante-central, ACTIVE)'],
      ['Papéis no restaurante', 'OWNER'],
      ['Administrador da plataforma', 'sim'],
      ['Sessões ativas', '3'],
    ]) {
      expect(r.out).toMatch(new RegExp(`^  ${label}:\\s+${value.replace(/[()]/g, '\\$&')}`, 'm'));
    }
    expect(r.asked.map((a) => a.hidden)).toEqual([true, true, false]);
    expect(r.asked[0].question).toContain('Nova senha');
    expect(r.asked[2].question).toContain(
      'Banco alvo: restaurant_saas_prod em db.example.com:6543. Conta: ana@example.com.\nDigite REDEFINIR para continuar: ',
    );
    expect(r.out).toContain('Senha de ana@example.com redefinida.');
    expect(r.out).toContain('Sessões encerradas: 3.');
    expect(r.out).toContain('Tokens de acesso já emitidos deixaram de valer.');
    expect(r.out + r.err).not.toContain(NEW_PASSWORD);
    expect(r.out + r.err).not.toMatch(/segredo-do-(banco|redis)/);
    expect(r.calls.closed).toBe(1);
  });

  it.each(['redefinir', 'sim', '', null])(
    'cancels on anything but REDEFINIR (%p)',
    async (word) => {
      const r = await run({ argv: RESET, lines: [NEW_PASSWORD, NEW_PASSWORD, word] });
      expect(r.code).toBe(1);
      expect(r.out).toContain('Cancelado. Nada foi alterado.');
      expect(r.calls.resets).toEqual([]);
    },
  );

  it('refuses passwords that differ, are short or are missing, before the confirmation', async () => {
    const differ = await run({
      argv: RESET,
      lines: [NEW_PASSWORD, `${NEW_PASSWORD}x`, 'REDEFINIR'],
    });
    expect(differ.code).toBe(1);
    expect(differ.err).toContain('As senhas não conferem. Nada foi alterado.');
    const short = await run({ argv: RESET, lines: ['curta', 'curta', 'REDEFINIR'] });
    expect(short.code).toBe(1);
    expect(short.err).toContain('entre 8 e 128 caracteres');
    const missing = await run({ argv: RESET, lines: [] });
    expect(missing.code).toBe(2);
    for (const r of [differ, short, missing]) {
      expect(r.calls.resets).toEqual([]);
      expect(r.asked.some((a) => a.question.includes('REDEFINIR'))).toBe(false);
    }
  });

  it('a friendly error for an unknown e-mail, before any password is asked', async () => {
    const r = await run({ argv: ['--email', 'ninguem@example.com'], user: null, lines: CONFIRMED });
    expect(r.code).toBe(1);
    expect(r.err).toContain(
      'Nenhuma conta com o e-mail "ninguem@example.com" em restaurant_saas_prod. Nada foi feito.',
    );
    expect(r.asked).toEqual([]);
    expect(r.calls.resets).toEqual([]);
  });

  it('refuses without a reachable Redis: the open access tokens could not be cut', async () => {
    const r = await run({ argv: RESET, lines: CONFIRMED, redis: false });
    expect(r.code).toBe(2);
    expect(r.err).toContain('Não foi possível falar com o Redis em cache.example.com:6380/2');
    expect(r.calls.resets).toEqual([]);
  });

  it('says so when the cut-off of the access tokens could not be confirmed', async () => {
    const r = await run({
      argv: RESET,
      lines: CONFIRMED,
      result: { sessionsEnded: 1, accessTokensCut: false },
    });
    expect(r.code).toBe(1);
    expect(r.out).toContain('Senha de ana@example.com redefinida.');
    expect(r.err).toContain('não foi confirmado no Redis');
  });

  it('--debug never shows the password nor a hash', async () => {
    const error = new Error(
      `falhou com data: { passwordHash: "$argon2id$v=19$m=65536,t=3,p=4$abc$def" } e "${NEW_PASSWORD}"`,
    );
    const r = await run({ argv: [...RESET, '--debug'], lines: CONFIRMED, resetError: error });
    expect(r.code).toBe(1);
    expect(r.err).toContain('falhou com data');
    expect(r.err).not.toContain(NEW_PASSWORD);
    expect(r.err).not.toContain('$argon2id');
    expect(r.calls.closed).toBe(1);
  });

  it('reads DATABASE_URL and REDIS_URL from the same place, never mixing environments', async () => {
    const noRedis = await run({ argv: RESET, env: { DATABASE_URL: URL_WITH_SECRET } });
    expect(noRedis.code).toBe(2);
    expect(noRedis.err).toContain('REDIS_URL não está definido');
    expect(noRedis.calls.opened).toEqual([]);

    const dir = mkdtempSync(join(tmpdir(), 'reset-password-'));
    writeFileSync(
      join(dir, '.env'),
      'DATABASE_URL=postgresql://saas:saas@localhost:5432/restaurant_saas\nREDIS_URL=redis://localhost:6379\nJWT_ACCESS_EXPIRES_IN=10m\n',
    );
    // A REDIS_URL in the shell does not pair with the .env's database.
    const fromFile = await run({
      argv: RESET,
      lines: CONFIRMED,
      cwd: dir,
      env: { REDIS_URL: REDIS_WITH_SECRET },
    });
    expect(fromFile.code).toBe(0);
    expect(fromFile.calls.opened).toEqual([
      ['postgresql://saas:saas@localhost:5432/restaurant_saas', 'redis://localhost:6379', '10m'],
    ]);
    expect(fromFile.out).toContain(`(lido de: arquivo ${join(dir, '.env')})`);
  });

  it('asks for the e-mail when it is not given', async () => {
    const r = await run({ argv: [], lines: ['ana@example.com', ...CONFIRMED] });
    expect(r.code).toBe(0);
    expect(r.asked[0]).toMatchObject({ hidden: false });
    expect(r.asked[0].question).toContain('E-mail da conta');
  });
});
