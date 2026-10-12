'use strict';

// Checks what the Dockerfiles of deploy/ really produce, instead of trusting their comments.
//
//   node deploy/verify-images.js            reads the files, then builds every image with NO
//                                           target and inspects what came out (needs Docker)
//   node deploy/verify-images.js --static   reads the files only (no Docker)
//   node deploy/verify-images.js --keep     keeps the restaurant-saas-verify-* images
//
// The point of building without a target: a hosting platform that cannot choose a stage builds
// the last one. Whatever that is must be the right image, with the right start command.
// Nothing here starts a database, and every container it runs has no network.
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TAG_PREFIX = 'restaurant-saas-verify-';
const DEV_ONLY_MODULES = [
  'typescript',
  '@nestjs/cli',
  'prisma',
  'jest',
  'ts-jest',
  'ts-node',
  'supertest',
  'eslint',
];
// What must never be part of how a production image is built or started.
const NOT_IN_PRODUCTION = /jest|prisma migrate|migrate\.js|seed\.js|e2e/i;

const IMAGES = [
  {
    name: 'api',
    file: 'deploy/api.Dockerfile',
    lastStage: 'runtime',
    production: true,
    cmd: ['node', 'dist/src/main.js'],
  },
  {
    name: 'web',
    file: 'deploy/web.Dockerfile',
    lastStage: 'runtime',
    production: true,
    cmd: ['node', 'server.js'],
    buildArgs: ['API_URL=http://api:4000/v1'],
  },
  {
    name: 'migrate',
    file: 'deploy/api.migrate.Dockerfile',
    lastStage: 'migrate',
    cmd: ['node', '/app/deploy/migrate.js', 'release'],
  },
  { name: 'e2e', file: 'deploy/api.e2e.Dockerfile', lastStage: 'e2e', nodeEnv: 'test' },
];

let failures = 0;
function check(ok, label, detail = '') {
  if (!ok) failures += 1;
  console.log(`${ok ? '  ok  ' : ' FAIL '} ${label}${!ok && detail ? `\n        ${detail}` : ''}`);
}

// ---- reading the files ----

function instructions(file) {
  // Dockerfile instructions with their continuation lines joined, comments dropped.
  const lines = fs.readFileSync(path.join(ROOT, file), 'utf8').split(/\r?\n/);
  const result = [];
  let current = '';
  for (const line of lines) {
    if (/^\s*#/.test(line) || (!current && !line.trim())) continue;
    current += line.replace(/\\\s*$/, ' ');
    if (!/\\\s*$/.test(line)) {
      result.push(current.trim());
      current = '';
    }
  }
  return result;
}

function describeFile(file) {
  const all = instructions(file);
  const lastFrom = all.map((line) => /^FROM\s/i.test(line)).lastIndexOf(true);
  const stageName = (line) => (/\sAS\s+(\S+)\s*$/i.exec(line) ?? [])[1];
  return {
    all,
    pins: all
      .filter((line) => /^ARG\s+(NODE|PNPM)_VERSION=/.test(line))
      .sort()
      .join(' '),
    lastStage: stageName(all[lastFrom]),
    lastStageLines: all.slice(lastFrom + 1),
  };
}

function staticChecks() {
  console.log('Dockerfiles, as written');
  const described = IMAGES.map((image) => ({ image, ...describeFile(image.file) }));
  for (const { image, all, lastStage, lastStageLines } of described) {
    check(
      lastStage === image.lastStage,
      `${image.file}: the last stage is "${image.lastStage}"`,
      `found "${lastStage}"`,
    );
    const users = lastStageLines.filter((line) => /^USER\s/i.test(line));
    check(
      users.at(-1) === 'USER node',
      `${image.file}: the last stage ends as USER node`,
      users.join(' | '),
    );
    if (!image.production) continue;
    const offending = all.filter((line) => NOT_IN_PRODUCTION.test(line));
    check(
      offending.length === 0,
      `${image.file}: no stage runs tests, migrations or the seed`,
      offending.join(' | '),
    );
    const starts = lastStageLines.filter((line) => /^(CMD|ENTRYPOINT)\s/i.test(line));
    check(
      starts.length === 1 && starts[0] === `CMD ${JSON.stringify(image.cmd).replace(/,/g, ', ')}`,
      `${image.file}: one start command, ${image.cmd.join(' ')}`,
      starts.join(' | '),
    );
  }
  const pins = new Set(described.map((entry) => entry.pins));
  check(
    pins.size === 1 && [...pins][0] !== '',
    'all Dockerfiles pin the same Node and pnpm versions',
    [...pins].join(' <> '),
  );
}

// ---- building and inspecting ----

function docker(args, options = {}) {
  const result = spawnSync('docker', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
  if (result.error) throw result.error;
  return { code: result.status, out: `${result.stdout ?? ''}${result.stderr ?? ''}`.trim() };
}

// Runs a script inside the image, with no network, and returns what it printed as JSON.
function inside(tag, script) {
  const result = docker(['run', '--rm', '--network', 'none', tag, 'node', '-e', script]);
  try {
    return JSON.parse(result.out.split('\n').at(-1));
  } catch {
    return { error: result.out.slice(-400) };
  }
}

function buildChecks() {
  const localMigrations = fs
    .readdirSync(path.join(ROOT, 'apps/api/prisma/migrations'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory()).length;

  for (const image of IMAGES) {
    const tag = `${TAG_PREFIX}${image.name}`;
    console.log(`\n${image.file}, built with no target`);
    const buildArgs = (image.buildArgs ?? []).flatMap((arg) => ['--build-arg', arg]);
    const build = docker(['build', '--quiet', '-f', image.file, ...buildArgs, '-t', tag, '.']);
    check(build.code === 0, 'docker build succeeds', build.out.slice(-600));
    if (build.code !== 0) continue;

    const config = JSON.parse(
      docker(['image', 'inspect', '--format', '{{json .Config}}', tag]).out,
    );
    const entrypoint = config.Entrypoint ?? [];
    const start = [...entrypoint, ...(config.Cmd ?? [])];
    const env = Object.fromEntries(
      (config.Env ?? []).map((entry) => entry.split(/=(.*)/s).slice(0, 2)),
    );
    check(config.User === 'node', 'runs as the unprivileged user "node"', `User=${config.User}`);
    check(
      env.NODE_ENV === (image.nodeEnv ?? 'production'),
      `NODE_ENV=${image.nodeEnv ?? 'production'}`,
      `NODE_ENV=${env.NODE_ENV}`,
    );
    // The official Node image brings its own entrypoint, a script that only hands over to the
    // command it receives. No Dockerfile here adds one: anything else in this place is a change.
    check(
      entrypoint.length === 0 || entrypoint.join(' ') === 'docker-entrypoint.sh',
      'entrypoint is the pass-through of the Node base image, or none',
      entrypoint.join(' '),
    );
    if (image.cmd) {
      const cmd = config.Cmd ?? [];
      check(
        JSON.stringify(cmd) === JSON.stringify(image.cmd),
        `start command is exactly: ${image.cmd.join(' ')}`,
        cmd.join(' '),
      );
    }
    if (image.production) {
      check(
        !NOT_IN_PRODUCTION.test(start.join(' ')),
        'start command runs no tests, migrations or seed',
        start.join(' '),
      );
    }

    if (image.name === 'api') {
      const probe = inside(
        tag,
        `const fs = require('fs'); const present = ${JSON.stringify(DEV_ONLY_MODULES)}.filter((name) => { try { require.resolve(name + '/package.json'); return true; } catch { return false; } });` +
          `const client = require('@prisma/client');` +
          `console.log(JSON.stringify({ present, uid: process.getuid(), models: Object.keys(client.Prisma.ModelName).length,` +
          ` sources: ['src', 'test', 'prisma'].filter((dir) => fs.existsSync(dir)), main: fs.existsSync('dist/src/main.js') }));`,
      );
      check(!probe.error, 'the image answers a probe', probe.error);
      if (!probe.error) {
        check(
          probe.present.length === 0,
          'no development tools inside (compiler, Prisma CLI, test runner)',
          probe.present.join(', '),
        );
        check(probe.uid !== 0, 'processes do not run as root', `uid=${probe.uid}`);
        check(probe.models > 0, `the generated Prisma Client is inside (${probe.models} models)`);
        check(
          probe.main && probe.sources.length === 0,
          'compiled API inside; no sources, tests or migrations',
          probe.sources.join(', '),
        );
      }
      // Started with nothing configured, the image must behave like the API: refuse to boot
      // because its own required variables are missing. Tests or migrations would say otherwise.
      const boot = docker(['run', '--rm', '--network', 'none', tag]);
      check(
        boot.code !== 0 &&
          /Invalid environment configuration/.test(boot.out) &&
          /DATABASE_URL/.test(boot.out),
        'started bare, it is the API that boots (and stops for lack of its variables)',
        boot.out.slice(-300),
      );
    }

    if (image.name === 'migrate') {
      const probe = inside(
        tag,
        `const fs = require('fs'); const version = (name) => require(name + '/package.json').version;` +
          `console.log(JSON.stringify({ cli: version('prisma'), client: version('@prisma/client'), uid: process.getuid(),` +
          ` migrations: fs.readdirSync('prisma/migrations', { withFileTypes: true }).filter((entry) => entry.isDirectory()).length,` +
          ` seed: fs.existsSync('dist/prisma/seed.js') }));`,
      );
      check(!probe.error, 'the image answers a probe', probe.error);
      if (!probe.error) {
        check(
          probe.cli === probe.client,
          `Prisma CLI ${probe.cli} is the version of @prisma/client ${probe.client}`,
        );
        check(
          probe.migrations === localMigrations,
          `carries the ${localMigrations} migrations of this checkout`,
          `found ${probe.migrations}`,
        );
        check(probe.seed && probe.uid !== 0, 'compiled seed inside; does not run as root');
      }
      const bare = docker(['run', '--rm', '--network', 'none', tag]);
      check(
        bare.code === 2 && /Nothing was done/.test(bare.out),
        'started without DATABASE_URL, it does nothing and exits 2',
        bare.out.slice(-300),
      );
    }
  }
}

const args = process.argv.slice(2);
staticChecks();
if (!args.includes('--static')) {
  buildChecks();
  if (!args.includes('--keep'))
    docker(['image', 'rm', ...IMAGES.map((image) => `${TAG_PREFIX}${image.name}`)]);
}
console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
