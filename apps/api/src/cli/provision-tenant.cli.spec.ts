import { ConflictException } from '@nestjs/common';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PassThrough } from 'stream';
import {
  CliDeps,
  createPrompter,
  describeDatabaseUrl,
  parseArgs,
  parseEnvFile,
  Prompter,
  ProvisioningContext,
  runProvisionCli,
  UsageError,
} from './provision-tenant.cli';

const PASSWORD = 'Senha#Inicial-2026';
const URL_WITH_SECRET =
  'postgresql://saas:segredo-do-banco@db.example.com:6543/restaurant_saas_prod?schema=public';

const answers = (lines: (string | null)[]): Prompter & { asked: string[] } => {
  const asked: string[] = [];
  const next = async (question: string) => {
    asked.push(question);
    return lines.length ? (lines.shift() as string | null) : null;
  };
  return { asked, ask: next, askHidden: next, close: () => undefined };
};

const FIELD_ANSWERS = [
  'Do’cê Hamburgueria',
  'Do’cê Alimentos LTDA',
  '12.345.678/0001-99',
  'doce-hamburgueria',
  'Matriz',
  'Maria Dona',
  'dona@example.com',
];

function fakeContext(overrides: Partial<ProvisioningContext> = {}) {
  const calls = { opened: 0, provisioned: [] as unknown[], closed: 0 };
  const context: ProvisioningContext = {
    describeServer: async () => ({
      database: 'restaurant_saas_prod',
      version: '16.4',
      existingTenants: 7,
    }),
    findConflicts: async () => [],
    provision: async (input, meta) => {
      calls.provisioned.push({ input, meta });
      return { tenantId: 't1', branchId: 'b1', ownerUserId: 'u1' };
    },
    readBack: async () => ({
      tenantName: 'Do’cê Hamburgueria',
      slug: 'doce-hamburgueria',
      status: 'TRIAL',
      timezone: 'America/Sao_Paulo',
      branchName: 'Matriz',
      deliveryEnabled: false,
      ownerEmail: 'dona@example.com',
      ownerRoles: ['OWNER'],
    }),
    close: async () => {
      calls.closed++;
    },
    ...overrides,
  };
  return { context, calls };
}

async function run(options: {
  argv?: string[];
  env?: NodeJS.ProcessEnv;
  lines?: (string | null)[];
  context?: Partial<ProvisioningContext>;
  cwd?: string;
}) {
  const { context, calls } = fakeContext(options.context);
  const prompter = answers([...(options.lines ?? [])]);
  const out: string[] = [];
  const err: string[] = [];
  const deps: CliDeps = {
    argv: options.argv ?? [],
    env: options.env ?? {
      DATABASE_URL: URL_WITH_SECRET,
      NODE_ENV: 'production',
      CORS_ORIGIN: 'https://app.example.com',
    },
    cwd: options.cwd ?? tmpdir(),
    prompter,
    out: (line) => out.push(line),
    err: (line) => err.push(line),
    openContext: async () => {
      calls.opened++;
      return context;
    },
    actor: 'operador@maquina',
  };
  const code = await runProvisionCli(deps);
  const all = [...out, ...err].join('\n');
  return { code, out: out.join('\n'), err: err.join('\n'), all, calls, asked: prompter.asked };
}

describe('provision-tenant CLI', () => {
  describe('arguments', () => {
    it('reads every field as --flag value or --flag=value and ignores the "--" separator', () => {
      const args = parseArgs([
        '--',
        '--tenant-name',
        'Restaurante X',
        '--slug=restaurante-x',
        '--email',
        'a@b.com',
        '--confirm-database',
        'db',
        '--debug',
      ]);
      expect(args).toEqual({
        values: { tenantName: 'Restaurante X', slug: 'restaurante-x', email: 'a@b.com' },
        confirmDatabase: 'db',
        debug: true,
        help: false,
      });
    });

    it.each([['--password', 'x'], ['--owner-password=x'], ['--senha', 'x'], ['--PASSWORD=x']])(
      'refuses a password on the command line (%s) without repeating it',
      (...argv) => {
        let error: unknown;
        try {
          parseArgs(argv);
        } catch (e) {
          error = e;
        }
        expect(error).toBeInstanceOf(UsageError);
        expect((error as Error).message).toMatch(/OWNER_PASSWORD/);
        expect((error as Error).message).not.toMatch(/=x|"x"/);
      },
    );

    it('refuses unknown options, positional words and a flag with no value', () => {
      expect(() => parseArgs(['--tenant', 'x'])).toThrow(UsageError);
      expect(() => parseArgs(['restaurante'])).toThrow(UsageError);
      expect(() => parseArgs(['--slug'])).toThrow(UsageError);
      expect(() => parseArgs(['--slug', '--email', 'a@b.com'])).toThrow(UsageError);
    });
  });

  describe('target database', () => {
    it('describes host, port and database, never the user or the password', () => {
      expect(describeDatabaseUrl(URL_WITH_SECRET)).toEqual({
        host: 'db.example.com',
        port: '6543',
        database: 'restaurant_saas_prod',
      });
      expect(describeDatabaseUrl('postgresql://u:p@localhost/restaurant_saas')).toEqual({
        host: 'localhost',
        port: '5432',
        database: 'restaurant_saas',
      });
      expect(describeDatabaseUrl('mysql://u:p@localhost/db')).toBeNull();
      expect(describeDatabaseUrl('not a url')).toBeNull();
      expect(describeDatabaseUrl(undefined)).toBeNull();
    });

    it('reads an .env file', () => {
      expect(
        parseEnvFile(
          '# c\nDATABASE_URL="postgresql://x"\nexport NODE_ENV=development # local\nEMPTY=\n',
        ),
      ).toEqual({
        DATABASE_URL: 'postgresql://x',
        NODE_ENV: 'development',
        EMPTY: '',
      });
    });
  });

  describe('flow', () => {
    it('asks every field, shows the target and the data, creates only after CRIAR, and never prints the password', async () => {
      const r = await run({ lines: [...FIELD_ANSWERS, PASSWORD, PASSWORD, 'CRIAR'] });

      expect(r.code).toBe(0);
      expect(r.calls.provisioned).toEqual([
        {
          input: expect.objectContaining({
            tenantName: 'Do’cê Hamburgueria',
            document: '12345678000199',
            slug: 'doce-hamburgueria',
            userName: 'Maria Dona',
            email: 'dona@example.com',
            password: PASSWORD,
          }),
          meta: { userAgent: 'cli tenant:provision', actor: 'operador@maquina' },
        },
      ]);
      expect(r.out).toContain('Banco alvo: restaurant_saas_prod em db.example.com:6543');
      for (const label of [
        'Banco',
        'Host',
        'Database',
        'Ambiente',
        'Restaurante',
        'Slug',
        'E-mail OWNER',
      ]) {
        expect(r.out).toMatch(new RegExp(`^  ${label}:`, 'm'));
      }
      expect(r.out).toMatch(/Ambiente:\s+production/);
      expect(r.asked[r.asked.length - 1]).toMatch(
        /restaurant_saas_prod em db\.example\.com:6543\. Digite CRIAR para continuar/,
      );
      expect(r.out).toContain('Restaurante criado com sucesso.');
      expect(r.out).toContain('Delivery: desligado');
      expect(r.out).toMatch(/Acesso:\nhttps:\/\/app\.example\.com\/login$/);
      expect(r.all).not.toContain(PASSWORD);
      expect(r.all).not.toContain('segredo-do-banco');
      expect(r.all).not.toContain('saas:');
      expect(r.calls.closed).toBe(1);
    });

    it('explains every question with a short line and an example, and the answer goes on "> "', async () => {
      const r = await run({ lines: [...FIELD_ANSWERS, PASSWORD, PASSWORD, 'CRIAR'] });

      expect(r.asked.slice(0, 9)).toEqual([
        'Nome do restaurante\nNome comercial que aparecerá no sistema.\nExemplo: Restaurante Central\n> ',
        '\nRazão social\nNome jurídico da empresa.\nExemplo: Empresa Central LTDA\n> ',
        '\nCNPJ/CPF\nDocumento do responsável ou da empresa, somente números (CNPJ 14 dígitos, CPF 11).\nExemplo: 12345678000199\n> ',
        '\nSlug\nIdentificador usado na URL. Sem espaços, acentos ou caracteres especiais: só letras minúsculas, números e hífen.\nExemplo: restaurante-central\n> ',
        '\nUnidade principal\nNome da primeira loja/unidade.\nExemplo: Matriz Centro\n> ',
        '\nNome do proprietário\nNome do usuário OWNER que receberá acesso.\nExemplo: João da Silva\n> ',
        '\nE-mail do proprietário\nSerá usado para entrar no sistema.\nExemplo: contato@empresa.com.br\n> ',
        '\nSenha inicial\nSenha temporária/inicial do OWNER. Não aparece enquanto é digitada.\nExemplo: use uma senha forte com letras, números e símbolos (mínimo 8 caracteres)\n> ',
        '\nConfirmar senha\nDigite a mesma senha de novo.\n> ',
      ]);
      // The confirmation question did not change.
      expect(r.asked[9]).toBe(
        'Banco alvo: restaurant_saas_prod em db.example.com:6543. Digite CRIAR para continuar: ',
      );
      expect(r.asked).toHaveLength(10);
      expect(r.asked.join('')).not.toContain(PASSWORD);
    });

    it('asks only what the options left out, with the same explanation', async () => {
      const r = await run({
        argv: ['--tenant-name', 'Restaurante X', '--legal-name', 'Restaurante X LTDA'],
        env: { DATABASE_URL: URL_WITH_SECRET, OWNER_PASSWORD: PASSWORD },
        lines: [...FIELD_ANSWERS.slice(2), 'CRIAR'],
      });
      expect(r.code).toBe(0);
      expect(r.asked[0]).toMatch(/^CNPJ\/CPF\n.*\nExemplo: 12345678000199\n> $/);
      expect(r.asked.join('')).not.toMatch(/Nome do restaurante|Razão social|Senha inicial/);
    });

    it.each(['criar', 'sim', '', null])(
      'cancels on any answer but CRIAR (%p) and creates nothing',
      async (answer) => {
        const r = await run({ lines: [...FIELD_ANSWERS, PASSWORD, PASSWORD, answer] });
        expect(r.code).toBe(1);
        expect(r.out).toContain('Cancelado. Nada foi criado.');
        expect(r.calls.provisioned).toEqual([]);
        expect(r.calls.closed).toBe(1);
      },
    );

    it('in automation: data by option, password from OWNER_PASSWORD, database confirmed by name, no question', async () => {
      const argv = [
        '--tenant-name',
        'Restaurante X',
        '--legal-name',
        'Restaurante X LTDA',
        '--document',
        '12345678000199',
        '--slug',
        'restaurante-x',
        '--branch-name',
        'Matriz',
        '--owner-name',
        'João',
        '--email',
        'joao@example.com',
        '--confirm-database',
        'restaurant_saas_prod',
      ];
      const r = await run({
        argv,
        env: { DATABASE_URL: URL_WITH_SECRET, OWNER_PASSWORD: PASSWORD },
        lines: [],
      });
      expect(r.code).toBe(0);
      expect(r.asked).toEqual([]);
      expect(r.calls.provisioned).toHaveLength(1);
      expect(r.all).not.toContain(PASSWORD);
      expect(r.out).toContain('http://localhost:3000/login');
    });

    it('stops when --confirm-database names another database', async () => {
      const r = await run({
        argv: ['--confirm-database', 'restaurant_saas'],
        lines: [...FIELD_ANSWERS, PASSWORD, PASSWORD],
      });
      expect(r.code).toBe(2);
      expect(r.err).toMatch(/não confere com o banco alvo "restaurant_saas_prod"/);
      expect(r.calls.provisioned).toEqual([]);
    });

    it('stops before the database when the passwords differ or the data is invalid', async () => {
      const mismatch = await run({ lines: [...FIELD_ANSWERS, PASSWORD, 'outra-senha'] });
      expect(mismatch.code).toBe(1);
      expect(mismatch.err).toContain('As senhas não conferem.');

      const invalid = await run({
        lines: [
          ...FIELD_ANSWERS.slice(0, 3),
          'Slug Com Espaço',
          ...FIELD_ANSWERS.slice(4),
          'curta',
          'curta',
        ],
      });
      expect(invalid.code).toBe(1);
      expect(invalid.err).toMatch(/Dados inválidos/);
      expect(invalid.all).not.toContain('curta');
      for (const r of [mismatch, invalid]) expect(r.calls.opened).toBe(0);
    });

    it('does nothing without a PostgreSQL DATABASE_URL, and says so without echoing it', async () => {
      const none = await run({ env: {}, cwd: mkdtempSync(join(tmpdir(), 'cli-')) });
      expect(none.code).toBe(2);
      expect(none.err).toMatch(/DATABASE_URL não está definido/);
      const wrong = await run({ env: { DATABASE_URL: 'mysql://root:segredo@x/db' } });
      expect(wrong.code).toBe(2);
      expect(wrong.all).not.toContain('segredo');
      for (const r of [none, wrong]) expect(r.calls.opened).toBe(0);
    });

    it('uses the .env of the folder it runs in when DATABASE_URL is not set, and says where it came from', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'cli-'));
      try {
        writeFileSync(
          join(dir, '.env'),
          'DATABASE_URL=postgresql://saas:segredo-local@localhost:5432/restaurant_saas\nNODE_ENV=development\n',
        );
        const r = await run({
          env: {},
          cwd: dir,
          lines: [...FIELD_ANSWERS, PASSWORD, PASSWORD, 'não'],
        });
        expect(r.out).toContain('Banco alvo: restaurant_saas em localhost:5432');
        expect(r.out).toContain(`arquivo ${join(dir, '.env')}`);
        expect(r.out).toMatch(/Ambiente:\s+development/);
        expect(r.all).not.toContain('segredo-local');
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });

    it('reports duplicates before asking for confirmation, and creates nothing', async () => {
      const r = await run({
        lines: [...FIELD_ANSWERS, PASSWORD, PASSWORD, 'CRIAR'],
        context: {
          findConflicts: async () => ['Já existe um restaurante com o slug "doce-hamburgueria".'],
        },
      });
      expect(r.code).toBe(1);
      expect(r.err).toContain('Já existe um restaurante com o slug "doce-hamburgueria".');
      expect(r.asked.some((q) => q.includes('CRIAR'))).toBe(false);
      expect(r.calls.provisioned).toEqual([]);
    });

    it('turns a refusal of the service (a duplicate created meanwhile) into a message, without a stack trace', async () => {
      const r = await run({
        lines: [...FIELD_ANSWERS, PASSWORD, PASSWORD, 'CRIAR'],
        context: {
          provision: async () => {
            throw new ConflictException({
              code: 'EMAIL_ALREADY_EXISTS',
              message: 'Já existe uma conta com este e-mail.',
            });
          },
        },
      });
      expect(r.code).toBe(1);
      expect(r.err).toContain('Já existe uma conta com este e-mail.');
      expect(r.all).not.toMatch(/\n\s+at /);
    });

    it('shows the stack trace of an unexpected error only with --debug', async () => {
      const boom = { provision: async () => Promise.reject(new Error('conexão caiu')) };
      const quiet = await run({
        lines: [...FIELD_ANSWERS, PASSWORD, PASSWORD, 'CRIAR'],
        context: boom,
      });
      expect(quiet.code).toBe(1);
      expect(quiet.err).toMatch(/Nada foi criado/);
      expect(quiet.all).not.toMatch(/\n\s+at /);
      const debug = await run({
        argv: ['--debug'],
        lines: [...FIELD_ANSWERS, PASSWORD, PASSWORD, 'CRIAR'],
        context: boom,
      });
      expect(debug.err).toMatch(/conexão caiu[\s\S]*\n\s+at /);
    });

    it('refuses a password given as an option and opens nothing', async () => {
      const r = await run({ argv: ['--password', PASSWORD] });
      expect(r.code).toBe(2);
      expect(r.all).not.toContain(PASSWORD);
      expect(r.calls.opened).toBe(0);
    });
  });

  describe('terminal', () => {
    it('echoes a normal answer but nothing of a hidden one', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      let printed = '';
      output.on('data', (chunk) => (printed += chunk.toString()));
      const prompter = createPrompter(input, output, true);

      const name = prompter.ask('Nome: ');
      input.write('Maria\r');
      expect(await name).toBe('Maria');
      const secret = prompter.askHidden('Senha: ');
      input.write('segredo123\r');
      expect(await secret).toBe('segredo123');
      prompter.close();

      expect(printed).toContain('Maria');
      expect(printed).toContain('Senha: ');
      expect(printed).not.toContain('segredo');
    });

    it('a question of several lines: a backspace redraws only its "> " line, and a hidden answer stays hidden', async () => {
      const input = new PassThrough();
      const output = new PassThrough();
      let printed = '';
      output.on('data', (chunk) => (printed += chunk.toString()));
      const prompter = createPrompter(input, output, true);

      const name = prompter.ask('Nome do restaurante\nExemplo: X\n> ');
      input.write('Marx\x7fia\r');
      expect(await name).toBe('Maria');
      expect(printed).toContain('Nome do restaurante\nExemplo: X\n> Marx');
      // The redraw after the backspace starts from "> ", never repeats the lines above it.
      expect(printed.split('Nome do restaurante')).toHaveLength(2);
      expect(printed).toContain('\x1b[0J> Mar');

      printed = '';
      const secret = prompter.askHidden('\nSenha inicial\nExemplo: use letras\n> ');
      input.write('segredx\x7fo123\r');
      expect(await secret).toBe('segredo123');
      prompter.close();
      expect(printed).toContain('Senha inicial\nExemplo: use letras\n> ');
      expect(printed).not.toMatch(/segred|o123/);
    });

    it('reads piped answers in order, even when they arrive before the questions', async () => {
      const input = new PassThrough();
      const prompter = createPrompter(input, new PassThrough(), false);
      input.end('um\ndois\n');
      expect(await prompter.ask('1: ')).toBe('um');
      expect(await prompter.askHidden('2: ')).toBe('dois');
      expect(await prompter.ask('3: ')).toBeNull();
      prompter.close();
    });
  });
});
