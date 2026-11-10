import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';
import { AuditModule } from '../modules/audit/audit.module';
import {
  PlatformAdminCandidate,
  PlatformAdminsService,
} from '../modules/platform/platform-admins.service';
import { describeDatabaseUrl, parseEnvFile, Prompter, UsageError } from './provision-tenant.cli';

// Grants or revokes platform administration (/super-admin) to an account that ALREADY exists
// (docs/SUPER_ADMIN.md). The only way to do it: no route writes platform_admins. Same rules as
// tenant:provision: the target database is shown and confirmed before anything is written.
//
// Exit code: 0 done (or nothing to do); 1 refused (cancelled, no such account, inactive);
// 2 the command or the environment is wrong and nothing was attempted.

export type PlatformAdminCommand = 'grant' | 'revoke';

const WORD: Record<PlatformAdminCommand, string> = { grant: 'CONCEDER', revoke: 'REVOGAR' };

export const PLATFORM_ADMIN_USAGE = [
  'Uso: platform-admin:grant --email <e-mail>    concede administração da plataforma',
  '     platform-admin:revoke --email <e-mail>   revoga',
  '',
  'A conta precisa já existir (este comando não cria contas).',
  '  --email <e-mail>'.padEnd(32) + 'E-mail (login) da conta',
  '  --confirm-database <nome>'.padEnd(32) +
    'Confirma o banco pelo nome, sem a pergunta de confirmação (automação)',
  '  --debug'.padEnd(32) + 'Mostra o detalhe técnico de um erro inesperado',
  '  --help'.padEnd(32) + 'Mostra esta ajuda',
].join('\n');

export interface PlatformAdminArgs {
  command: PlatformAdminCommand;
  email?: string;
  confirmDatabase?: string;
  debug: boolean;
  help: boolean;
}

export function parsePlatformAdminArgs(argv: string[]): PlatformAdminArgs {
  const [command, ...rest] = argv;
  if (command !== 'grant' && command !== 'revoke') {
    throw new UsageError(
      'Informe grant ou revoke (use platform-admin:grant ou platform-admin:revoke).',
    );
  }
  const args: PlatformAdminArgs = { command, debug: false, help: false };
  for (let i = 0; i < rest.length; i++) {
    const raw = rest[i];
    if (raw === '--') continue; // npm/pnpm may pass the separator through
    if (!raw.startsWith('--')) throw new UsageError(`Argumento não reconhecido: "${raw}".`);
    const eq = raw.indexOf('=');
    const name = (eq === -1 ? raw.slice(2) : raw.slice(2, eq)).toLowerCase();
    if (name === 'debug' || name === 'help') {
      if (eq !== -1) throw new UsageError(`--${name} não recebe valor.`);
      args[name] = true;
      continue;
    }
    if (name !== 'email' && name !== 'confirm-database')
      throw new UsageError(`Opção desconhecida: --${name}.`);
    let value: string | undefined;
    if (eq !== -1) {
      value = raw.slice(eq + 1);
    } else {
      value = rest[i + 1];
      if (value === undefined || value.startsWith('--'))
        throw new UsageError(`--${name} precisa de um valor.`);
      i++;
    }
    if (name === 'email') args.email = value.trim();
    else args.confirmDatabase = value;
  }
  return args;
}

export interface PlatformAdminContext {
  describeServer(): Promise<{ database: string; version: string }>;
  findByEmail(email: string): Promise<PlatformAdminCandidate | null>;
  countAdmins(): Promise<number>;
  grant(userId: string, actor: string): Promise<boolean>;
  revoke(userId: string, actor: string): Promise<boolean>;
  close(): Promise<void>;
}

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [PlatformAdminsService],
})
export class PlatformAdminCliModule {}

export async function openPlatformAdminContext(databaseUrl: string): Promise<PlatformAdminContext> {
  // PrismaService reads DATABASE_URL when it is built: the URL that was shown and confirmed.
  process.env.DATABASE_URL = databaseUrl;
  const app = await NestFactory.createApplicationContext(PlatformAdminCliModule, {
    logger: false,
    abortOnError: false,
  });
  const prisma = app.get(PrismaService);
  const admins = app.get(PlatformAdminsService);
  return {
    async describeServer() {
      const [row] = await prisma.$queryRaw<{ database: string; version: string }[]>`
        SELECT current_database() AS database, current_setting('server_version') AS version`;
      return row;
    },
    findByEmail: (email) => admins.findByEmail(email),
    countAdmins: () => admins.count(),
    grant: (userId, actor) => admins.grant(userId, actor, 'cli platform-admin:grant'),
    revoke: (userId, actor) => admins.revoke(userId, actor, 'cli platform-admin:revoke'),
    close: () => app.close(),
  };
}

export interface PlatformAdminCliDeps {
  argv: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  prompter: Prompter;
  out: (line: string) => void;
  err: (line: string) => void;
  openContext: (databaseUrl: string) => Promise<PlatformAdminContext>;
  actor: string;
}

const row = (label: string, value: string) => `  ${`${label}:`.padEnd(30)}${value}`;

export async function runPlatformAdminCli(deps: PlatformAdminCliDeps): Promise<number> {
  const { out, err, prompter } = deps;

  let args: PlatformAdminArgs;
  try {
    args = parsePlatformAdminArgs(deps.argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    err(error.message);
    err('Use --help para ver as opções. Nada foi feito.');
    return 2;
  }
  if (args.help) {
    out(PLATFORM_ADMIN_USAGE);
    return 0;
  }
  const granting = args.command === 'grant';

  // Same database resolution as tenant:provision: DATABASE_URL, or else the .env of the folder.
  const envFile = join(deps.cwd, '.env');
  const fileVars =
    !deps.env.DATABASE_URL && existsSync(envFile)
      ? parseEnvFile(readFileSync(envFile, 'utf8'))
      : {};
  const setting = (name: string): string | undefined =>
    deps.env[name] || fileVars[name] || undefined;
  const databaseUrl = setting('DATABASE_URL');
  const source = deps.env.DATABASE_URL ? 'variável de ambiente DATABASE_URL' : `arquivo ${envFile}`;
  const target = describeDatabaseUrl(databaseUrl);
  if (!databaseUrl || !target) {
    err('DATABASE_URL não está definido ou não é uma URL PostgreSQL. Nada foi feito.');
    return 2;
  }

  out(
    granting
      ? 'Conceder administração da plataforma (/super-admin). Nada muda antes da confirmação.'
      : 'Revogar administração da plataforma (/super-admin). Nada muda antes da confirmação.',
  );
  out(
    `Banco alvo: ${target.database} em ${target.host}:${target.port} (DATABASE_URL lido de: ${source})`,
  );
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

  let context: PlatformAdminContext;
  try {
    context = await deps.openContext(databaseUrl);
  } catch (error) {
    err(
      `Não foi possível conectar ao banco ${target.database} em ${target.host}:${target.port}. Nada foi feito.`,
    );
    if (args.debug) err(String((error as Error)?.stack ?? error));
    return 2;
  }

  try {
    const server = await context.describeServer();
    const user = await context.findByEmail(email);
    if (!user) {
      err(`Nenhuma conta com o e-mail "${email}" em ${server.database}. Nada foi feito.`);
      return 1;
    }

    out('');
    out(granting ? 'Confira antes de conceder:' : 'Confira antes de revogar:');
    out(row('Banco', `PostgreSQL ${server.version}`));
    out(row('Host', `${target.host}:${target.port}`));
    out(row('Database', server.database));
    out(row('Ambiente', `${setting('NODE_ENV') ?? 'não definido'} (NODE_ENV)`));
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
    out(row('Administradores hoje', String(await context.countAdmins())));
    out('');

    if (granting && user.isPlatformAdmin) {
      out('Esta conta já é administradora da plataforma. Nada foi alterado.');
      return 0;
    }
    if (!granting && !user.isPlatformAdmin) {
      out('Esta conta não é administradora da plataforma. Nada foi alterado.');
      return 0;
    }
    if (granting && user.status !== 'ACTIVE') {
      err('A conta não está ativa: reative-a antes de conceder. Nada foi feito.');
      return 1;
    }

    if (args.confirmDatabase !== undefined) {
      if (args.confirmDatabase !== server.database) {
        err(
          `--confirm-database "${args.confirmDatabase}" não confere com o banco alvo "${server.database}". Nada foi feito.`,
        );
        return 2;
      }
      out(`Banco confirmado por --confirm-database ${server.database}.`);
    } else {
      const answer = await prompter.ask(
        `Banco alvo: ${server.database} em ${target.host}:${target.port}. Digite ${WORD[args.command]} para continuar: `,
      );
      if (answer?.trim() !== WORD[args.command]) {
        out('Cancelado. Nada foi alterado.');
        return 1;
      }
    }

    const changed = granting
      ? await context.grant(user.id, deps.actor)
      : await context.revoke(user.id, deps.actor);
    if (!changed) {
      out('Nada foi alterado: a situação da conta mudou enquanto o comando rodava.');
      return 0;
    }
    out(
      granting
        ? `${user.email} agora é administrador(a) da plataforma. Entra pelo login normal e acessa /super-admin.`
        : `${user.email} deixou de ser administrador(a) da plataforma. Vale já na próxima requisição.`,
    );
    return 0;
  } catch (error) {
    err('Erro inesperado. Nada foi alterado: a mudança é uma transação só.');
    err(
      args.debug
        ? String((error as Error)?.stack ?? error)
        : 'Rode de novo com --debug para ver o detalhe técnico.',
    );
    return 1;
  } finally {
    await context.close();
  }
}
