'use strict';

// Run with:  pnpm test:deploy   (node --test deploy/)
// No database and no Docker: the Prisma CLI and the seed are replaced by recorders.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { describeTarget, main } = require('./migrate');

const URL_WITH_SECRETS =
  'postgresql://app_user:s3cr3t-pass@db.internal:6543/restaurant?schema=public&sslmode=require';

function harness({
  migrateCode = 0,
  seedCode = 0,
  statusCode = 0,
  cli = '5.22.0',
  client = '5.22.0',
  seedExists = true,
} = {}) {
  const calls = [];
  const lines = [];
  const deps = {
    log: (line) => lines.push(line),
    prismaVersions: () => ({ cli, client }),
    prisma: (args) => {
      calls.push(`prisma ${args.join(' ')}`);
      return args[1] === 'status' ? statusCode : migrateCode;
    },
    seedExists: () => seedExists,
    seed: () => {
      calls.push('seed');
      return seedCode;
    },
  };
  return { calls, lines, deps, output: () => lines.join('\n') };
}

test('describeTarget shows server, port and database, and nothing else', () => {
  assert.equal(describeTarget(URL_WITH_SECRETS), 'db.internal:6543/restaurant');
  assert.equal(describeTarget('postgres://u:p@localhost/app'), 'localhost:5432/app');
});

test('describeTarget refuses what is not a PostgreSQL URL', () => {
  for (const value of [
    '',
    'not a url',
    'mysql://u:p@host/db',
    'postgresql://u:p@host/',
    'redis://host:6379',
  ]) {
    assert.equal(describeTarget(value), null, value);
  }
});

test('nothing printed ever contains the user, the password or the query string', () => {
  for (const command of ['status', 'migrate', 'seed', 'release']) {
    const h = harness({ migrateCode: 1 });
    main([command], { DATABASE_URL: URL_WITH_SECRETS }, h.deps);
    assert.doesNotMatch(h.output(), /app_user|s3cr3t|sslmode|schema=/, command);
    assert.match(h.output(), /database: db\.internal:6543\/restaurant/, command);
  }
});

test('an unreadable DATABASE_URL is not echoed back and nothing runs', () => {
  for (const value of [
    undefined,
    '',
    'postgresql//user:hunter2@host/db',
    'mysql://user:hunter2@host/db',
  ]) {
    const h = harness();
    assert.equal(main(['release'], { DATABASE_URL: value }, h.deps), 2);
    assert.deepEqual(h.calls, []);
    assert.doesNotMatch(h.output(), /hunter2/);
  }
});

test('an unknown command or extra arguments do nothing', () => {
  for (const argv of [['deploy'], ['reset'], ['migrate', '--force'], ['release', 'seed']]) {
    const h = harness();
    assert.equal(main(argv, { DATABASE_URL: URL_WITH_SECRETS }, h.deps), 2, argv.join(' '));
    assert.deepEqual(h.calls, []);
  }
});

test('release is the default: migrations first, then the seed', () => {
  const h = harness();
  assert.equal(main([], { DATABASE_URL: URL_WITH_SECRETS }, h.deps), 0);
  assert.deepEqual(h.calls, ['prisma migrate deploy', 'seed']);
});

test('release does not run the seed when a migration fails, and returns its exit code', () => {
  const h = harness({ migrateCode: 1 });
  assert.equal(main(['release'], { DATABASE_URL: URL_WITH_SECRETS }, h.deps), 1);
  assert.deepEqual(h.calls, ['prisma migrate deploy']);
  assert.match(h.output(), /seed was not run/);
});

test('a failing seed fails the release', () => {
  const h = harness({ seedCode: 3 });
  assert.equal(main(['release'], { DATABASE_URL: URL_WITH_SECRETS }, h.deps), 3);
  assert.deepEqual(h.calls, ['prisma migrate deploy', 'seed']);
});

test('migrate, seed and status do one thing each', () => {
  const migrate = harness();
  assert.equal(main(['migrate'], { DATABASE_URL: URL_WITH_SECRETS }, migrate.deps), 0);
  assert.deepEqual(migrate.calls, ['prisma migrate deploy']);

  const seed = harness();
  assert.equal(main(['seed'], { DATABASE_URL: URL_WITH_SECRETS }, seed.deps), 0);
  assert.deepEqual(seed.calls, ['seed']);

  const status = harness({ statusCode: 1 });
  assert.equal(main(['status'], { DATABASE_URL: URL_WITH_SECRETS }, status.deps), 1);
  assert.deepEqual(status.calls, ['prisma migrate status']);
});

test('a Prisma CLI that is not the version of the client stops everything', () => {
  const h = harness({ cli: '5.22.0', client: '5.20.0' });
  assert.equal(main(['release'], { DATABASE_URL: URL_WITH_SECRETS }, h.deps), 2);
  assert.deepEqual(h.calls, []);
});

test('the seed is not attempted without its compiled file, and migrations are not either', () => {
  const h = harness({ seedExists: false });
  assert.equal(main(['release'], { DATABASE_URL: URL_WITH_SECRETS }, h.deps), 2);
  assert.deepEqual(h.calls, []);
  const migrateOnly = harness({ seedExists: false });
  assert.equal(main(['migrate'], { DATABASE_URL: URL_WITH_SECRETS }, migrateOnly.deps), 0);
  assert.deepEqual(migrateOnly.calls, ['prisma migrate deploy']);
});
