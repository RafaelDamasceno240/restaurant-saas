import { HttpException, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { createInterface } from 'readline';
import { Readable, Writable } from 'stream';
import { translateValidationErrors } from '../common/validation/validation-messages';
import { findAccountsByLoginEmail } from '../common/util/login-email.util';
import { AuditModule } from '../modules/audit/audit.module';
import { ProvisionTenantDto } from '../modules/tenants/dto/provision-tenant.dto';
import {
  ProvisionedTenant,
  ProvisionMeta,
  TenantProvisioningService,
} from '../modules/tenants/tenant-provisioning.service';
import { PrismaModule } from '../prisma/prisma.module';
import { PrismaService } from '../prisma/prisma.service';

// Administrative provisioning of a restaurant, from a terminal (docs/PROVISIONING.md). There is
// no HTTP route: whoever runs this already holds DATABASE_URL. It boots only what
// TenantProvisioningService needs (Prisma and the audit writer): no HTTP server, no Redis, no JWT
// secrets. Nothing is written before the operator has seen the target database and confirmed.
//
// Exit code: 0 created; 1 refused (cancelled, invalid data, duplicate, error while creating);
// 2 the command or the environment is wrong and nothing was attempted (as deploy/migrate.js).

// hint and example are shown only when the field is asked in the terminal, never with options.
export const FIELDS = [
  {
    key: 'tenantName',
    flag: 'tenant-name',
    label: 'Nome do restaurante',
    hint: 'Nome comercial que aparecerá no sistema.',
    example: 'Restaurante Central',
  },
  {
    key: 'legalName',
    flag: 'legal-name',
    label: 'Razão social',
    hint: 'Nome jurídico da empresa.',
    example: 'Empresa Central LTDA',
  },
  {
    key: 'document',
    flag: 'document',
    label: 'CNPJ/CPF',
    hint: 'Documento do responsável ou da empresa, somente números (CNPJ 14 dígitos, CPF 11).',
    example: '12345678000199',
  },
  {
    key: 'slug',
    flag: 'slug',
    label: 'Slug',
    hint: 'Identificador usado na URL. Sem espaços, acentos ou caracteres especiais: só letras minúsculas, números e hífen.',
    example: 'restaurante-central',
  },
  {
    key: 'branchName',
    flag: 'branch-name',
    label: 'Unidade principal',
    hint: 'Nome da primeira loja/unidade.',
    example: 'Matriz Centro',
  },
  {
    key: 'userName',
    flag: 'owner-name',
    label: 'Nome do proprietário',
    hint: 'Nome do usuário OWNER que receberá acesso.',
    example: 'João da Silva',
  },
  {
    key: 'email',
    flag: 'email',
    label: 'E-mail do proprietário',
    hint: 'Será usado para entrar no sistema.',
    example: 'contato@empresa.com.br',
  },
] as const;

type FieldKey = (typeof FIELDS)[number]['key'];

// One question: what it is, a short explanation, an example, and the answer on its own "> " line.
export const question = (label: string, hint: string, example?: string) =>
  [label, hint, ...(example ? [`Exemplo: ${example}`] : []), '> '].join('\n');

// Never a real password as the example: only what a good one looks like.
const PASSWORD_QUESTION = question(
  'Senha inicial',
  'Senha temporária/inicial do OWNER. Não aparece enquanto é digitada.',
  'use uma senha forte com letras, números e símbolos (mínimo 8 caracteres)',
);
const CONFIRM_PASSWORD_QUESTION = question('Confirmar senha', 'Digite a mesma senha de novo.');

export const USAGE = [
  'Uso: tenant:provision [opções]',
  '',
  'Sem opções, pergunta cada dado no terminal. Qualquer dado pode vir por opção:',
  ...FIELDS.map((f) => `  --${f.flag} <valor>`.padEnd(32) + f.label),
  '  --confirm-database <nome>'.padEnd(32) +
    'Confirma o banco pelo nome, sem a pergunta CRIAR (automação)',
  '  --debug'.padEnd(32) + 'Mostra o detalhe técnico de um erro inesperado',
  '  --help'.padEnd(32) + 'Mostra esta ajuda',
  '',
  'A senha inicial NUNCA vai por opção (ficaria no histórico e na lista de processos):',
  'ela é perguntada sem eco ou lida da variável de ambiente OWNER_PASSWORD.',
].join('\n');

export class UsageError extends Error {}

export interface CliArgs {
  values: Partial<Record<FieldKey, string>>;
  confirmDatabase?: string;
  debug: boolean;
  help: boolean;
}

export function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { values: {}, debug: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i];
    if (raw === '--') continue; // npm/pnpm may pass the separator through
    if (!raw.startsWith('--')) throw new UsageError(`Argumento não reconhecido: "${raw}".`);
    const eq = raw.indexOf('=');
    const name = (eq === -1 ? raw.slice(2) : raw.slice(2, eq)).toLowerCase();
    if (/pass|senha|secret/.test(name)) {
      // The value is never read, not even to report it.
      throw new UsageError(
        'A senha não é aceita como opção de linha de comando. Use a variável OWNER_PASSWORD ou deixe o comando perguntar.',
      );
    }
    if (name === 'debug' || name === 'help') {
      if (eq !== -1) throw new UsageError(`--${name} não recebe valor.`);
      args[name] = true;
      continue;
    }
    const field = FIELDS.find((f) => f.flag === name);
    if (!field && name !== 'confirm-database')
      throw new UsageError(`Opção desconhecida: --${name}.`);
    let value: string | undefined;
    if (eq !== -1) {
      value = raw.slice(eq + 1);
    } else {
      value = argv[i + 1];
      if (value === undefined || value.startsWith('--'))
        throw new UsageError(`--${name} precisa de um valor.`);
      i++;
    }
    if (field) args.values[field.key] = value;
    else args.confirmDatabase = value;
  }
  return args;
}

export interface DatabaseTarget {
  host: string;
  port: string;
  database: string;
}

// Same reading as deploy/migrate.js describeTarget(): host, port and database only. Credentials
// and query parameters never leave this function, and a URL it cannot read is not echoed back.
export function describeDatabaseUrl(databaseUrl: string | undefined): DatabaseTarget | null {
  let url: URL;
  try {
    url = new URL(databaseUrl ?? '');
  } catch {
    return null;
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') return null;
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!url.hostname || !database) return null;
  return { host: url.hostname, port: url.port || '5432', database };
}

// KEY=value lines of an .env file (comments, blank lines and surrounding quotes handled). Used
// only when DATABASE_URL is not in the environment, the way the API itself gets it locally.
export function parseEnvFile(text: string): Record<string, string> {
  const vars: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!match) continue;
    let value = match[2].trim();
    const quoted = /^(['"])(.*)\1$/.exec(value);
    if (quoted) value = quoted[2];
    else value = value.replace(/\s+#.*$/, '');
    vars[match[1]] = value;
  }
  return vars;
}

export interface Prompter {
  ask(question: string): Promise<string | null>;
  askHidden(question: string): Promise<string | null>;
  close(): void;
}

// Reads one answer per line. On a terminal, a hidden question echoes nothing of what is typed;
// piped input (automation, tests) is read line by line and is never echoed anyway. null = the
// input ended or the operator pressed Ctrl+C.
export function createPrompter(
  input: Readable,
  output: Writable,
  terminal = Boolean((input as { isTTY?: boolean }).isTTY && (output as { isTTY?: boolean }).isTTY),
): Prompter {
  const rl = createInterface({ input, output, terminal });
  const queued: string[] = [];
  let waiting: ((line: string | null) => void) | null = null;
  let closed = false;
  let muted = false;

  // readline echoes what is typed through this method; while a hidden answer is being typed it
  // writes nothing. Not a public API, but stable for years and with no dependency to add.
  // After a backspace, readline clears the line and writes it again as prompt + answer; a hidden
  // answer then gets only the prompt back.
  let prompt = '';
  const echo = rl as unknown as { _writeToOutput?: (text: string) => void };
  const write = echo._writeToOutput?.bind(rl);
  if (write) {
    echo._writeToOutput = (text: string) => {
      if (!muted) write(text);
      else if (prompt && text.startsWith(prompt)) write(prompt);
    };
  }

  // A question can span lines; readline redraws only the last one (its prompt), so the lines
  // above it are written once.
  const show = (question: string) => {
    prompt = question.slice(question.lastIndexOf('\n') + 1);
    rl.setPrompt(prompt);
    output.write(question);
  };

  const deliver = (line: string | null) => {
    const resolve = waiting;
    waiting = null;
    resolve?.(line);
  };
  rl.on('line', (line) => (waiting ? deliver(line) : queued.push(line)));
  rl.on('close', () => {
    closed = true;
    deliver(null);
  });
  rl.on('SIGINT', () => rl.close());

  const read = (): Promise<string | null> => {
    if (queued.length > 0) return Promise.resolve(queued.shift() as string);
    if (closed) return Promise.resolve(null);
    return new Promise((resolve) => (waiting = resolve));
  };
  // A terminal ends the line itself when Enter is pressed; with piped input nothing does, and the
  // next question would follow on the same line of the log.
  const next = async (): Promise<string | null> => {
    const answer = await read();
    if (!terminal) output.write('\n');
    return answer;
  };

  return {
    ask(question) {
      show(question);
      return next();
    },
    async askHidden(question) {
      show(question);
      muted = terminal;
      const answer = await next();
      if (muted) output.write('\n');
      muted = false;
      return answer;
    },
    close() {
      rl.close();
    },
  };
}

export interface ServerInfo {
  database: string;
  version: string;
  existingTenants: number;
}

export interface ProvisionedSummary {
  tenantName: string;
  slug: string;
  status: string;
  timezone: string;
  branchName: string;
  deliveryEnabled: boolean;
  ownerEmail: string;
  ownerRoles: string[];
}

// What the CLI needs from the database, behind one seam so the flow can be tested without one.
export interface ProvisioningContext {
  describeServer(): Promise<ServerInfo>;
  findConflicts(input: ProvisionTenantDto): Promise<string[]>;
  provision(input: ProvisionTenantDto, meta: ProvisionMeta): Promise<ProvisionedTenant>;
  readBack(created: ProvisionedTenant): Promise<ProvisionedSummary>;
  close(): Promise<void>;
}

@Module({
  imports: [PrismaModule, AuditModule],
  providers: [TenantProvisioningService],
})
export class ProvisioningCliModule {}

export async function openNestContext(databaseUrl: string): Promise<ProvisioningContext> {
  // PrismaService reads DATABASE_URL when it is built: this is the URL that was shown and
  // confirmed, whatever an .env file elsewhere says.
  process.env.DATABASE_URL = databaseUrl;
  const app = await NestFactory.createApplicationContext(ProvisioningCliModule, {
    logger: false,
    abortOnError: false,
  });
  const prisma = app.get(PrismaService);
  const service = app.get(TenantProvisioningService);
  return {
    async describeServer() {
      const [row] = await prisma.$queryRaw<{ database: string; version: string }[]>`
        SELECT current_database() AS database, current_setting('server_version') AS version`;
      return { ...row, existingTenants: await prisma.tenant.count() };
    },
    async findConflicts(input) {
      const [bySlug, byDocument, byEmail] = await Promise.all([
        prisma.tenant.count({ where: { slug: input.slug } }),
        prisma.tenant.count({ where: { document: input.document } }),
        findAccountsByLoginEmail(prisma, input.email).then((accounts) => accounts.length),
      ]);
      return [
        ...(bySlug ? [`Já existe um restaurante com o slug "${input.slug}".`] : []),
        ...(byDocument ? ['Já existe um restaurante com este CNPJ/CPF.'] : []),
        ...(byEmail ? [`Já existe uma conta com o e-mail "${input.email}".`] : []),
      ];
    },
    provision: (input, meta) => service.provision(input, meta),
    async readBack({ tenantId, branchId, ownerUserId }) {
      const [tenant, branch, owner] = await Promise.all([
        prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
        prisma.branch.findUniqueOrThrow({ where: { id: branchId } }),
        prisma.user.findUniqueOrThrow({
          where: { id: ownerUserId },
          include: { userRoles: { include: { role: true } } },
        }),
      ]);
      return {
        tenantName: tenant.name,
        slug: tenant.slug,
        status: tenant.status,
        timezone: tenant.timezone,
        branchName: branch.name,
        deliveryEnabled: branch.deliveryEnabled,
        ownerEmail: owner.email,
        ownerRoles: owner.userRoles.map((ur) => ur.role.name),
      };
    },
    close: () => app.close(),
  };
}

export interface CliDeps {
  argv: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
  prompter: Prompter;
  out: (line: string) => void;
  err: (line: string) => void;
  openContext: (databaseUrl: string) => Promise<ProvisioningContext>;
  // Who ran it (OS user and machine), recorded in the audit entry.
  actor: string;
}

const row = (label: string, value: string) => `  ${`${label}:`.padEnd(24)}${value}`;

export async function runProvisionCli(deps: CliDeps): Promise<number> {
  const { out, err, prompter } = deps;

  let args: CliArgs;
  try {
    args = parseArgs(deps.argv);
  } catch (error) {
    if (!(error instanceof UsageError)) throw error;
    err(error.message);
    err('Use --help para ver as opções. Nada foi feito.');
    return 2;
  }
  if (args.help) {
    out(USAGE);
    return 0;
  }

  // The database: DATABASE_URL from the environment, or else the .env of the folder the command
  // runs in (apps/api), as the API reads it locally.
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
  const environment = setting('NODE_ENV') ?? 'não definido';
  const webUrl = (setting('CORS_ORIGIN') ?? 'http://localhost:3000')
    .split(',')[0]
    .trim()
    .replace(/\/+$/, '');

  out('Provisionamento de restaurante (CLI administrativo). Nada é criado antes da confirmação.');
  out(
    `Banco alvo: ${target.database} em ${target.host}:${target.port} (DATABASE_URL lido de: ${source})`,
  );
  out('');

  // A blank line between questions, not before the first.
  let asked = 0;
  const ask = (text: string, hidden = false) => {
    const spaced = `${asked++ ? '\n' : ''}${text}`;
    return hidden ? prompter.askHidden(spaced) : prompter.ask(spaced);
  };

  const input: Record<string, string> = {};
  for (const field of FIELDS) {
    const answer =
      args.values[field.key] ?? (await ask(question(field.label, field.hint, field.example)));
    if (answer === null) {
      err(`Faltou: ${field.label} (--${field.flag}). Nada foi criado.`);
      return 2;
    }
    input[field.key] = answer.trim();
  }
  // Typed with dots, slash or dash is the same document.
  input.document = input.document.replace(/[.\-/\s]/g, '');

  if (deps.env.OWNER_PASSWORD) {
    input.password = deps.env.OWNER_PASSWORD;
  } else {
    const password = await ask(PASSWORD_QUESTION, true);
    const confirmation = password === null ? null : await ask(CONFIRM_PASSWORD_QUESTION, true);
    if (password === null || confirmation === null) {
      err(
        'Faltou a senha inicial: digite-a quando perguntada ou use OWNER_PASSWORD. Nada foi criado.',
      );
      return 2;
    }
    if (password !== confirmation) {
      err('As senhas não conferem. Nada foi criado.');
      return 1;
    }
    input.password = password;
  }

  // The same rules the service applies, before touching the database.
  const dto = plainToInstance(ProvisionTenantDto, input);
  const problems = translateValidationErrors(
    await validate(dto, { whitelist: true, forbidNonWhitelisted: true }),
  );
  if (problems.length > 0) {
    err('Dados inválidos. Nada foi criado:');
    for (const problem of problems) err(`  - ${problem.message}`);
    return 1;
  }

  let context: ProvisioningContext;
  try {
    context = await deps.openContext(databaseUrl);
  } catch (error) {
    err(
      `Não foi possível conectar ao banco ${target.database} em ${target.host}:${target.port}. Nada foi criado.`,
    );
    if (args.debug) err(String((error as Error)?.stack ?? error));
    return 2;
  }

  try {
    const server = await context.describeServer();
    out('');
    out('Confira antes de criar:');
    out(row('Banco', `PostgreSQL ${server.version}`));
    out(row('Host', `${target.host}:${target.port}`));
    out(row('Database', server.database));
    out(row('Ambiente', `${environment} (NODE_ENV)`));
    out(row('Restaurantes no banco', String(server.existingTenants)));
    out(row('Restaurante', dto.tenantName));
    out(row('Razão social', dto.legalName));
    out(row('CNPJ/CPF', dto.document));
    out(row('Slug', dto.slug));
    out(row('Unidade principal', dto.branchName));
    out(row('Proprietário', dto.userName));
    out(row('E-mail OWNER', dto.email));
    out(row('Senha inicial', '(informada, não exibida)'));
    out('');

    const conflicts = await context.findConflicts(dto);
    if (conflicts.length > 0) {
      for (const conflict of conflicts) err(conflict);
      err('Nada foi criado.');
      return 1;
    }

    if (args.confirmDatabase !== undefined) {
      if (args.confirmDatabase !== server.database) {
        err(
          `--confirm-database "${args.confirmDatabase}" não confere com o banco alvo "${server.database}". Nada foi criado.`,
        );
        return 2;
      }
      out(`Banco confirmado por --confirm-database ${server.database}.`);
    } else {
      const answer = await prompter.ask(
        `Banco alvo: ${server.database} em ${target.host}:${target.port}. Digite CRIAR para continuar: `,
      );
      if (answer?.trim() !== 'CRIAR') {
        out('Cancelado. Nada foi criado.');
        return 1;
      }
    }

    let created: ProvisionedTenant;
    try {
      created = await context.provision(dto, {
        userAgent: 'cli tenant:provision',
        actor: deps.actor,
      });
    } catch (error) {
      if (error instanceof HttpException) {
        const body = error.getResponse() as { message?: string; details?: { message: string }[] };
        err(body.message ?? error.message);
        for (const detail of body.details ?? []) err(`  - ${detail.message}`);
        err('Nada foi criado.');
        return 1;
      }
      err('Erro inesperado ao criar o restaurante. Nada foi criado: a criação é uma transação só.');
      err(
        args.debug
          ? String((error as Error)?.stack ?? error)
          : 'Rode de novo com --debug para ver o detalhe técnico.',
      );
      return 1;
    }

    const summary = await context.readBack(created);
    out('Restaurante criado com sucesso.');
    out('');
    out(`Restaurante: ${summary.tenantName}`);
    out(`Slug: ${summary.slug}`);
    out(`Unidade: ${summary.branchName}`);
    out(`OWNER: ${summary.ownerEmail}`);
    out(`Status: ${summary.status}`);
    out(`Fuso horário: ${summary.timezone}`);
    out(`Delivery: ${summary.deliveryEnabled ? 'ligado' : 'desligado'}`);
    out('');
    out('Acesso:');
    out(`${webUrl}/login`);
    return 0;
  } catch (error) {
    err('Erro inesperado. Confira o banco antes de repetir.');
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
