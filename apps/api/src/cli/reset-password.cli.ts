import { DynamicModule, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { existsSync, readFileSync } from 'fs';
import Redis from 'ioredis';
import { join } from 'path';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { REDIS_CLIENT } from '../redis/redis.module';
import { AuditModule } from '../modules/audit/audit.module';
import {
  AdminPasswordResetResult,
  AdminPasswordResetService,
} from '../modules/auth/admin-password-reset.service';
import { SessionRevocationService } from '../modules/auth/session-revocation.service';
import {
  PlatformAdminCandidate,
  PlatformAdminsService,
} from '../modules/platform/platform-admins.service';
import { ResetUserPasswordDto } from '../modules/users/dto/users.dto';
import {
  describeDatabaseUrl,
  parseEnvFile,
  Prompter,
  question,
  UsageError,
} from './provision-tenant.cli';

// Sets a new password on an account that ALREADY exists, without knowing the current one
// (docs/authentication.md). Local only: no route does this for an OWNER. Same rules as the other
// administrative commands: the target database is shown and confirmed before anything is written,
// and the password is never an argument; it is asked without echo, twice.
//
// Exit code: 0 done; 1 refused (cancelled, no such account, passwords differ or invalid) or the
// cut-off of the access tokens could not be confirmed; 2 the command or the environment is wrong
// and nothing was attempted.

const WORD = 'REDEFINIR';

const PASSWORD_QUESTION = question(
  'Nova senha',
  'Não aparece enquanto é digitada.',
  'use uma senha forte com letras, números e símbolos (mínimo 8 caracteres)',
);
const CONFIRM_PASSWORD_QUESTION = question('Confirmar nova senha', 'Digite a mesma senha de novo.');

export const RESET_PASSWORD_USAGE = [
  'Uso: user:reset-password --email <e-mail>',
  '',
  'Redefine a senha de uma conta que já existe (este comando não cria contas).',
  'A nova senha é perguntada sem eco; ela nunca é aceita como opção de linha de comando.',
  '  --email <e-mail>'.padEnd(32) + 'E-mail (login) da conta',
  '  --debug'.padEnd(32) + 'Mostra o detalhe técnico de um erro inesperado',
  '  --help'.padEnd(32) + 'Mostra esta ajuda',
].join('\n');

export interface ResetPasswordArgs {
  email?: string;
  debug: boolean;
  help: boolean;
}

export function parseResetPasswordArgs(argv: string[]): ResetPasswordArgs {
  const args: ResetPasswordArgs = { debug: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (raw === '--') continue; // npm/pnpm may pass the separator through
    if (!raw.startsWith('--')) throw new UsageError(`Argumento não reconhecido: "${raw}".`);
    const eq = raw.indexOf('=');
    const name = (eq === -1 ? raw.slice(2) : raw.slice(2, eq)).toLowerCase();
    if (name === 'debug' || name === 'help') {
      if (eq !== -1) throw new UsageError(`--${name} não recebe valor.`);
      args[name] = true;
      continue;
    }
    if (/^(password|senha|new-password|nova-senha)$/.test(name)) {
      throw new UsageError(
        'A senha não é aceita como opção de linha de comando: o comando pergunta, sem eco.',
      );
    }
    if (name !== 'email') throw new UsageError(`Opção desconhecida: --${name}.`);
    let value: string | undefined;
    if (eq !== -1) {
      value = raw.slice(eq + 1);
    } else {
      value = argv[i + 1];
      if (value === undefined || value.startsWith('--'))
        throw new UsageError(`--${name} precisa de um valor.`);
      i++;
    }
    args.email = value.trim();
  }
  return args;
}

export interface ResetPasswordServerInfo {
  database: string;
  version: string;
  // null when the database user may not read pg_control_system().
  systemIdentifier: string | null;
}

export interface ResetPasswordContext {
  describeServer(): Promise<ResetPasswordServerInfo>;
  findByEmail(email: string): Promise<PlatformAdminCandidate | null>;
  activeSessions(userId: string): Promise<number>;
  redisReachable(): Promise<boolean>;
  reset(userId: string, password: string, actor: string): Promise<AdminPasswordResetResult>;
  close(): Promise<void>;
}

@Module({})
export class ResetPasswordCliModule {
  static forTarget(redisUrl: string, accessExpiresIn: string): DynamicModule {
    return {
      module: ResetPasswordCliModule,
      imports: [PrismaModule, AuditModule],
      providers: [
        PlatformAdminsService,
        SessionRevocationService,
        AdminPasswordResetService,
        {
          provide: REDIS_CLIENT,
          useFactory: () => {
            const client = new Redis(redisUrl, {
              maxRetriesPerRequest: 1,
              connectTimeout: 2000,
              commandTimeout: 1000,
            });
            // Unreachable Redis is reported by redisReachable(), not as an unhandled event.
            client.on('error', () => undefined);
            return client;
          },
        },
        // SessionRevocationService only reads how long an access token lives.
        { provide: ConfigService, useValue: new ConfigService({ jwt: { accessExpiresIn } }) },
      ],
    };
  }
}

export async function openResetPasswordContext(
  databaseUrl: string,
  redisUrl: string,
  accessExpiresIn: string,
): Promise<ResetPasswordContext> {
  // PrismaService reads DATABASE_URL when it is built: the URL that was shown and confirmed.
  process.env.DATABASE_URL = databaseUrl;
  const app = await NestFactory.createApplicationContext(
    ResetPasswordCliModule.forTarget(redisUrl, accessExpiresIn),
    { logger: false, abortOnError: false },
  );
  const prisma = app.get(PrismaService);
  const redis = app.get<Redis>(REDIS_CLIENT);
  const accounts = app.get(PlatformAdminsService);
  const resets = app.get(AdminPasswordResetService);
  return {
    async describeServer() {
      const [row] = await prisma.$queryRaw<{ database: string; version: string }[]>`
        SELECT current_database() AS database, current_setting('server_version') AS version`;
      let systemIdentifier: string | null = null;
      try {
        const [control] = await prisma.$queryRaw<{ id: string }[]>`
          SELECT system_identifier::text AS id FROM pg_control_system()`;
        systemIdentifier = control?.id ?? null;
      } catch {
        // Not readable by this database user: shown as unavailable.
      }
      return { ...row, systemIdentifier };
    },
    findByEmail: (email) => accounts.findByEmail(email),
    activeSessions: (userId) => resets.activeSessions(userId),
    async redisReachable() {
      try {
        return (await redis.ping()) === 'PONG';
      } catch {
        return false;
      }
    },
    reset: (userId, password, actor) =>
      resets.reset(userId, password, actor, 'cli user:reset-password'),
    async close() {
      redis.disconnect();
      await app.close();
    },
  };
}

export interface ResetPasswordCliDeps {
  argv: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  prompter: Prompter;
  out: (line: string) => void;
  err: (line: string) => void;
  openContext: (
    databaseUrl: string,
    redisUrl: string,
    accessExpiresIn: string,
  ) => Promise<ResetPasswordContext>;
  actor: string;
}

const row = (label: string, value: string) => `  ${`${label}:`.padEnd(30)}${value}`;

function describeRedisUrl(redisUrl: string | undefined): string | null {
  try {
    const url = new URL(redisUrl ?? '');
    if (url.protocol !== 'redis:' && url.protocol !== 'rediss:') return null;
    return `${url.hostname}:${url.port || '6379'}${url.pathname.length > 1 ? url.pathname : ''}`;
  } catch {
    return null;
  }
}

export async function runResetPasswordCli(deps: ResetPasswordCliDeps): Promise<number> {
  const { out, err, prompter } = deps;

  let args: ResetPasswordArgs;
  try {
    args = parseResetPasswordArgs(deps.argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    err(error.message);
    err('Use --help para ver as opções. Nada foi feito.');
    return 2;
  }
  if (args.help) {
    out(RESET_PASSWORD_USAGE);
    return 0;
  }

  // Same database resolution as tenant:provision: DATABASE_URL, or else the .env of the folder.
  // Every other setting comes from the same place, so a database and a Redis of two different
  // environments are never mixed.
  const envFile = join(deps.cwd, '.env');
  const fromEnv = Boolean(deps.env.DATABASE_URL);
  const fileVars =
    !fromEnv && existsSync(envFile) ? parseEnvFile(readFileSync(envFile, 'utf8')) : {};
  const setting = (name: string): string | undefined =>
    (fromEnv ? deps.env[name] : fileVars[name]) || undefined;
  const databaseUrl = setting('DATABASE_URL');
  const redisUrl = setting('REDIS_URL');
  const source = fromEnv ? 'variáveis de ambiente' : `arquivo ${envFile}`;
  const target = describeDatabaseUrl(databaseUrl);
  const redisTarget = describeRedisUrl(redisUrl);
  if (!databaseUrl || !target) {
    err('DATABASE_URL não está definido ou não é uma URL PostgreSQL. Nada foi feito.');
    return 2;
  }
  if (!redisUrl || !redisTarget) {
    err(
      `REDIS_URL não está definido (${source}) ou não é uma URL Redis: sem ele as sessões já abertas não seriam encerradas. Nada foi feito.`,
    );
    return 2;
  }

  out('Redefinir a senha de uma conta existente. Nada muda antes da confirmação.');
  out(`Banco alvo: ${target.database} em ${target.host}:${target.port} (lido de: ${source})`);
  out('');

  const email =
    args.email ??
    (
      await prompter.ask(
        'E-mail da conta\nA conta precisa já existir; este comando não cria contas.\n> ',
      )
    )?.trim();
  if (!email) {
    err('Faltou o e-mail da conta (--email). Nada foi feito.');
    return 2;
  }

  let context: ResetPasswordContext;
  try {
    context = await deps.openContext(
      databaseUrl,
      redisUrl,
      setting('JWT_ACCESS_EXPIRES_IN') ?? '15m',
    );
  } catch (error) {
    err(
      `Não foi possível conectar ao banco ${target.database} em ${target.host}:${target.port}. Nada foi feito.`,
    );
    if (args.debug) err(String((error as Error)?.stack ?? error));
    return 2;
  }

  // Nothing typed as the password reaches the output, not even through --debug.
  let password: string | null = null;
  const redact = (text: string) =>
    (password ? text.split(password).join('***') : text).replace(/\$argon2[^\s"'`]*/g, '***');

  try {
    const server = await context.describeServer();
    const user = await context.findByEmail(email);
    if (!user) {
      err(`Nenhuma conta com o e-mail "${email}" em ${server.database}. Nada foi feito.`);
      return 1;
    }
    if (!(await context.redisReachable())) {
      err(
        `Não foi possível falar com o Redis em ${redisTarget}: sem ele os tokens de acesso já emitidos não seriam cortados. Nada foi feito.`,
      );
      return 2;
    }

    out('');
    out('Confira antes de redefinir:');
    out(row('Banco', `PostgreSQL ${server.version}`));
    out(row('Host', `${target.host}:${target.port}`));
    out(row('Database', server.database));
    out(row('Identificador do cluster', server.systemIdentifier ?? 'indisponível'));
    out(row('Ambiente', `${setting('NODE_ENV') ?? 'não definido'} (NODE_ENV)`));
    out(row('Redis das sessões', redisTarget));
    out(row('Usuário', user.name));
    out(row('E-mail', user.email));
    out(row('Situação da conta', user.status));
    out(
      row(
        'Restaurante da conta',
        `${user.tenant.name} (${user.tenant.slug}, ${user.tenant.status})`,
      ),
    );
    out(row('Papéis no restaurante', user.roles.join(', ') || 'nenhum'));
    out(row('Administrador da plataforma', user.isPlatformAdmin ? 'sim' : 'não'));
    out(row('Sessões ativas', String(await context.activeSessions(user.id))));
    out('');

    password = await prompter.askHidden(PASSWORD_QUESTION);
    const confirmation =
      password === null ? null : await prompter.askHidden(`\n${CONFIRM_PASSWORD_QUESTION}`);
    if (password === null || confirmation === null) {
      err('Faltou a nova senha: digite-a quando perguntada. Nada foi alterado.');
      return 2;
    }
    if (password !== confirmation) {
      err('As senhas não conferem. Nada foi alterado.');
      return 1;
    }
    // The same rule as the reset in the panel.
    const problems = await validate(plainToInstance(ResetUserPasswordDto, { password }));
    if (problems.length > 0) {
      err('A senha precisa ter entre 8 e 128 caracteres. Nada foi alterado.');
      return 1;
    }

    const answer = await prompter.ask(
      `\nBanco alvo: ${server.database} em ${target.host}:${target.port}. Conta: ${user.email}.\nDigite ${WORD} para continuar: `,
    );
    if (answer?.trim() !== WORD) {
      out('Cancelado. Nada foi alterado.');
      return 1;
    }

    const result = await context.reset(user.id, password, deps.actor);
    out(`Senha de ${user.email} redefinida.`);
    out(
      `Sessões encerradas: ${result.sessionsEnded}. Papéis, restaurante e administração da plataforma não mudaram.`,
    );
    if (!result.accessTokensCut) {
      err(
        `Atenção: o corte dos tokens de acesso já emitidos não foi confirmado no Redis (${redisTarget}); eles podem valer até expirar (${setting('JWT_ACCESS_EXPIRES_IN') ?? '15m'}).`,
      );
      return 1;
    }
    out('Tokens de acesso já emitidos deixaram de valer. Entre de novo com a nova senha.');
    return 0;
  } catch (error) {
    err('Erro inesperado. A troca é uma transação só: se ela não terminou, nada mudou.');
    err(
      args.debug
        ? redact(String((error as Error)?.stack ?? error))
        : 'Rode de novo com --debug para ver o detalhe técnico.',
    );
    return 1;
  } finally {
    password = null;
    await context.close();
  }
}
