'use strict';

// The database step of a release, as one explicit command. It is what the migration image
// (deploy/api.migrate.Dockerfile) runs, and it also works from a checkout that has the API's
// dependencies installed and built.
//
//   node deploy/migrate.js status    read-only: which migrations are applied, pending or failed
//   node deploy/migrate.js migrate   apply the pending migrations (prisma migrate deploy)
//   node deploy/migrate.js seed      upsert roles, permissions and their links; nothing else
//   node deploy/migrate.js release   migrate, then seed (the default); the seed does NOT run
//                                    if a migration failed
//
// It acts on DATABASE_URL and on nothing else, and prints which server and database that is
// before doing anything (never the user or the password). It is never called by the API: the
// order is database -> this job -> API -> health checks (deploy/README.md).
//
// Exit code: 0 when everything asked for was done; the failing step's code otherwise; 2 when
// the command or the environment is wrong and nothing was attempted.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const API_DIR = path.resolve(__dirname, '..', 'apps', 'api');
const SEED_FILE = path.join('dist', 'prisma', 'seed.js');
const COMMANDS = ['status', 'migrate', 'seed', 'release'];

// "host:port/database" of a PostgreSQL URL. Credentials and query parameters never leave this
// function, and a URL that cannot be read is not echoed back: it may contain a password.
function describeTarget(databaseUrl) {
  let url;
  try {
    url = new URL(databaseUrl);
  } catch {
    return null;
  }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') return null;
  const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
  if (!url.hostname || !database) return null;
  return `${url.hostname}:${url.port || '5432'}/${database}`;
}

function installedVersion(packageName) {
  const manifest = require.resolve(`${packageName}/package.json`, { paths: [API_DIR] });
  return JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
}

// The CLI that writes the schema and the client the API reads it with must be the same
// release: both come from the lockfile, and this refuses to continue if they ever drift.
function prismaVersions() {
  return { cli: installedVersion('prisma'), client: installedVersion('@prisma/client') };
}

function runNode(args, env) {
  const result = spawnSync(process.execPath, args, { cwd: API_DIR, env, stdio: 'inherit' });
  if (result.error) throw result.error;
  // Killed by a signal (the platform stopped the job): not a success.
  return result.status === null ? 1 : result.status;
}

const defaultDeps = {
  log: (line) => console.log(`[migrate] ${line}`),
  prismaVersions,
  prisma: (args, env) =>
    runNode([require.resolve('prisma/build/index.js', { paths: [API_DIR] }), ...args], env),
  seedExists: () => fs.existsSync(path.join(API_DIR, SEED_FILE)),
  seed: (env) => runNode([SEED_FILE], env),
};

function main(argv, env, deps = defaultDeps) {
  const { log } = deps;
  const command = argv[0] ?? 'release';
  if (argv.length > 1 || !COMMANDS.includes(command)) {
    log(`usage: node deploy/migrate.js [${COMMANDS.join('|')}]`);
    return 2;
  }

  const target = describeTarget(env.DATABASE_URL ?? '');
  if (!target) {
    log('DATABASE_URL is missing or is not a PostgreSQL URL. Nothing was done.');
    return 2;
  }

  const versions = deps.prismaVersions();
  if (versions.cli !== versions.client) {
    log(
      `Prisma CLI ${versions.cli} does not match @prisma/client ${versions.client}. Nothing was done.`,
    );
    return 2;
  }
  if ((command === 'seed' || command === 'release') && !deps.seedExists()) {
    log(`${SEED_FILE} not found: build the API first (pnpm --filter api build). Nothing was done.`);
    return 2;
  }

  log(`command: ${command}`);
  log(`database: ${target}`);
  log(`prisma: ${versions.cli}`);

  if (command === 'status') return deps.prisma(['migrate', 'status'], env);

  if (command === 'migrate' || command === 'release') {
    const code = deps.prisma(['migrate', 'deploy'], env);
    if (code !== 0) {
      log(
        `migrations FAILED (exit code ${code}). The seed was not run and the API must not start.`,
      );
      log(
        'If a migration stopped halfway, no other is applied until it is resolved: deploy/README.md.',
      );
      return code;
    }
    log('migrations: applied or already up to date');
    if (command === 'migrate') return 0;
  }

  const code = deps.seed(env);
  if (code !== 0) {
    log(`seed FAILED (exit code ${code}). It is safe to run again: node deploy/migrate.js seed`);
    return code;
  }
  log('seed: roles and permissions are in place');
  return 0;
}

module.exports = { describeTarget, main, COMMANDS };

if (require.main === module) {
  process.exit(main(process.argv.slice(2), process.env));
}
