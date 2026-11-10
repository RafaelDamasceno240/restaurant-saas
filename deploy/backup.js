'use strict';

// Backup of the database of deploy/compose.yml, and a proof that the backup restores.
//
//   node deploy/backup.js backup [--out <dir>]   pg_dump of this stack's database to a file OUTSIDE
//                                                 the repository (default ../restaurant-saas-backups/homolog)
//   node deploy/backup.js verify <file>           restores <file> into a THROWAWAY PostgreSQL container
//                                                 and compares it with this stack's database
//
// What it touches:
//   - backup: reads this stack's database (pg_dump runs in one snapshot, so the file is consistent
//     even while the system is in use) and writes one new file plus its .sha256. Nothing is deleted.
//   - verify: starts a separate container (postgres:16-alpine, no network, no published port, removed
//     with its data at the end), restores the file there and compares migrations, schema, row counts
//     and row contents of every table with this stack's database, which it only reads. It never
//     restores into this stack. Writes made to the stack after the backup show up as differences.
//
// It works on this stack only (deploy/compose.yml, the database named in deploy/.env): never on the
// development database of the root docker-compose.yml. No user, password or row is printed.
// Exit code: 0 done / identical, 1 failed / different, 2 wrong usage (nothing attempted).
const { spawnSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const COMPOSE = ['compose', '-f', path.join(__dirname, 'compose.yml')];
const DEFAULT_OUT = path.resolve(REPO_ROOT, '..', 'restaurant-saas-backups', 'homolog');
const RESTORE_IMAGE = 'postgres:16-alpine';
const RESTORE_DB = 'restore_check';

function docker(args, { input, allowFail = false } = {}) {
  const result = spawnSync('docker', args, { input, encoding: 'utf8', maxBuffer: 512 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0 && !allowFail) {
    throw new Error(`docker ${args[0]} ${args[1] || ''} failed (code ${result.status}): ${(result.stderr || '').trim().slice(0, 500)}`);
  }
  return result;
}

// SQL (stdin) against this stack's database, in read-only transactions; the credentials stay
// inside the container (its own POSTGRES_USER/POSTGRES_DB).
function stackSql(sql) {
  return docker(
    [...COMPOSE, 'exec', '-T', '-e', 'PGOPTIONS=-c default_transaction_read_only=on', 'postgres',
      'sh', '-c', 'psql -X -q -At -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'],
    { input: sql },
  ).stdout;
}
function stackShell(command) {
  return docker([...COMPOSE, 'exec', '-T', 'postgres', 'sh', '-c', command]).stdout;
}
function restoreSql(container, sql) {
  return docker(['exec', '-i', container, 'psql', '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', RESTORE_DB], { input: sql }).stdout;
}

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}
function timestamp() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}
function isInside(child, parent) {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}
function requireStackRunning() {
  const running = docker([...COMPOSE, 'ps', '--status', 'running', '-q', 'postgres']).stdout.trim();
  if (!running) throw new Error('the postgres service of deploy/compose.yml is not running');
}

function backup(outDir) {
  const dir = path.resolve(outDir || DEFAULT_OUT);
  if (isInside(dir, REPO_ROOT)) throw new UsageError(`refusing to write a backup inside the repository: ${dir}`);
  requireStackRunning();
  fs.mkdirSync(dir, { recursive: true });

  const database = stackShell('printf %s "$POSTGRES_DB"').trim();
  const file = path.join(dir, `${database}_${timestamp()}.dump`);
  if (fs.existsSync(file)) throw new Error(`already exists: ${file}`);
  const inContainer = `/tmp/backup-${process.pid}-${Date.now()}.dump`;

  console.log(`[backup] source: service postgres of deploy/compose.yml, database ${database}`);
  try {
    stackShell(`pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --format=custom --file=${inContainer}`);
    const entries = stackShell(`pg_restore --list ${inContainer} | grep -vc '^;'`).trim();
    const remoteSha = stackShell(`sha256sum ${inContainer}`).split(/\s+/)[0];
    docker([...COMPOSE, 'cp', `postgres:${inContainer}`, file]);
    const size = fs.statSync(file).size;
    const localSha = sha256(file);
    if (size === 0) throw new Error('the backup file is empty');
    if (localSha !== remoteSha) throw new Error('the copied file differs from the one pg_dump wrote');
    fs.writeFileSync(`${file}.sha256`, `${localSha}  ${path.basename(file)}\n`);
    console.log(`[backup] file: ${file}`);
    console.log(`[backup] size: ${size} bytes; archive entries: ${entries}; sha256: ${localSha}`);
  } finally {
    docker([...COMPOSE, 'exec', '-T', 'postgres', 'rm', '-f', inContainer], { allowFail: true });
  }
  return 0;
}

// Same queries on both sides. Row contents are compared through an md5 of every row's text form,
// in a fixed order, so no value is ever printed.
const MIGRATIONS_SQL = `select migration_name || ' ' || coalesce(to_char(finished_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), 'NOT-FINISHED') || ' ' || coalesce(rolled_back_at::text, '-')
  from _prisma_migrations order by migration_name;`;
const TABLES_SQL = `select table_name from information_schema.tables
  where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name;`;
function tableStatsSql(tables) {
  return tables
    .map((t) => `select '${t}' || ' ' || count(*) || ' ' || coalesce(md5(string_agg(r::text, '|' order by r::text)), '-') from public."${t}" r;`)
    .join('\n');
}
// pg_dump --schema-only, minus comments, settings and the per-run \restrict key.
function normalizeSchema(text) {
  return text
    .split('\n')
    .filter((l) => l.trim() !== '' && !l.startsWith('--') && !l.startsWith('SET ') && !l.startsWith('SELECT pg_catalog.set_config') && !/^\\(un)?restrict /.test(l))
    .join('\n');
}
function lines(text) {
  return text.split('\n').map((l) => l.trim()).filter(Boolean);
}
function compare(label, source, restored) {
  const same = JSON.stringify(source) === JSON.stringify(restored);
  console.log(`[verify] ${same ? 'SAME     ' : 'DIFFERENT'} ${label}`);
  return same;
}

function waitForRestoreServer(container) {
  for (let i = 0; i < 120; i += 1) {
    const logs = docker(['logs', container], { allowFail: true });
    const text = `${logs.stdout}${logs.stderr}`;
    // The image starts a temporary server for initdb first: wait for the real one.
    if (text.includes('PostgreSQL init process complete')) {
      const ready = docker(['exec', container, 'pg_isready', '-U', 'postgres', '-d', RESTORE_DB], { allowFail: true });
      if (ready.status === 0) return;
    }
    spawnSync(process.execPath, ['-e', 'setTimeout(()=>{},500)']);
  }
  throw new Error('the throwaway PostgreSQL did not become ready');
}

function verify(file) {
  if (!file) throw new UsageError('usage: node deploy/backup.js verify <file.dump>');
  const dump = path.resolve(file);
  if (!fs.existsSync(dump) || fs.statSync(dump).size === 0) throw new UsageError(`missing or empty file: ${dump}`);
  const shaFile = `${dump}.sha256`;
  if (fs.existsSync(shaFile)) {
    const expected = fs.readFileSync(shaFile, 'utf8').split(/\s+/)[0];
    if (expected !== sha256(dump)) throw new Error('the file does not match its .sha256: it changed after the backup');
    console.log('[verify] file matches its .sha256');
  }
  requireStackRunning();

  const container = `rs-restore-verify-${Date.now()}`;
  const password = crypto.randomBytes(24).toString('hex');
  console.log(`[verify] throwaway container: ${container} (${RESTORE_IMAGE}, no network, removed at the end)`);
  docker(['run', '-d', '--rm', '--name', container, '--network', 'none', '-e', `POSTGRES_PASSWORD=${password}`, '-e', `POSTGRES_DB=${RESTORE_DB}`, RESTORE_IMAGE]);
  try {
    waitForRestoreServer(container);
    docker(['cp', dump, `${container}:/tmp/restore.dump`]);
    const started = Date.now();
    docker(['exec', container, 'pg_restore', '-U', 'postgres', '-d', RESTORE_DB, '--no-owner', '--no-privileges', '--exit-on-error', '/tmp/restore.dump']);
    console.log(`[verify] pg_restore finished with code 0 in ${((Date.now() - started) / 1000).toFixed(1)} s`);

    const results = [];
    results.push(compare('applied migrations (name, finished_at, rolled_back_at)', lines(stackSql(MIGRATIONS_SQL)), lines(restoreSql(container, MIGRATIONS_SQL))));
    const sourceSchema = normalizeSchema(stackShell('pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" --schema-only --no-owner --no-privileges'));
    const restoredSchema = normalizeSchema(docker(['exec', container, 'pg_dump', '-U', 'postgres', '-d', RESTORE_DB, '--schema-only', '--no-owner', '--no-privileges']).stdout);
    results.push(compare(`schema (pg_dump --schema-only, ${sourceSchema.split('\n').length} lines)`, sourceSchema, restoredSchema));
    const sourceTables = lines(stackSql(TABLES_SQL));
    results.push(compare(`table list (${sourceTables.length} tables)`, sourceTables, lines(restoreSql(container, TABLES_SQL))));

    const sourceStats = lines(stackSql(tableStatsSql(sourceTables)));
    const restoredStats = lines(restoreSql(container, tableStatsSql(sourceTables)));
    const total = (stats) => stats.reduce((sum, l) => sum + Number(l.split(' ')[1]), 0);
    results.push(compare(`row count and row contents of every table (${total(sourceStats)} rows in the source)`, sourceStats, restoredStats));
    const differing = sourceStats.filter((l, i) => l !== restoredStats[i]).map((l) => l.split(' ')[0]);
    if (differing.length) console.log(`[verify] tables that differ: ${differing.join(', ')}`);
    const nonEmpty = sourceStats.filter((l) => l.split(' ')[1] !== '0').map((l) => `${l.split(' ')[0]}=${l.split(' ')[1]}`);
    console.log(`[verify] non-empty tables: ${nonEmpty.join(' ')}`);

    const ok = results.every(Boolean);
    console.log(ok ? '[verify] RESTORE VERIFIED: the backup restores to the same migrations, schema and data'
      : '[verify] DIFFERENCES FOUND (if the system was used after the backup, that alone explains them)');
    return ok ? 0 : 1;
  } finally {
    docker(['stop', container], { allowFail: true });
    console.log(`[verify] throwaway container stopped and removed: ${container}`);
  }
}

class UsageError extends Error {}

function main(argv) {
  const [command, ...rest] = argv;
  try {
    if (command === 'backup') {
      const at = rest.indexOf('--out');
      return backup(at >= 0 ? rest[at + 1] : undefined);
    }
    if (command === 'verify') return verify(rest[0]);
    throw new UsageError('usage: node deploy/backup.js backup [--out <dir>] | verify <file.dump>');
  } catch (error) {
    console.error(`[backup] ${error.message}`);
    return error instanceof UsageError ? 2 : 1;
  }
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { normalizeSchema, isInside };
