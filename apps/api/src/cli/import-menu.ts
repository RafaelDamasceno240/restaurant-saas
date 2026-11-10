import { hostname, userInfo } from 'os';
import { PrismaClient } from '@prisma/client';
import { runImportCli } from './import-menu.cli';

// Entry point of `menu:import` (docs/IMPORTACAO_CARDAPIO.md). Everything it does is in
// import-menu.cli.ts; this file only wires the real terminal, process and database to it.
function operator(): string {
  try {
    return `${userInfo().username}@${hostname()}`;
  } catch {
    return `desconhecido@${hostname()}`;
  }
}

runImportCli({
  argv: process.argv.slice(2),
  env: process.env,
  cwd: process.cwd(),
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
  newClient: (url) => new PrismaClient({ datasources: { db: { url } } }),
  now: () => new Date(),
  actor: operator(),
})
  .then((code) => {
    process.exitCode = code;
  })
  .catch(() => {
    process.stderr.write('Erro inesperado no comando. Nada foi gravado.\n');
    process.exitCode = 1;
  });
