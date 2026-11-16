import { hostname, userInfo } from 'os';
import { createPrompter } from './provision-tenant.cli';
import { openPlatformAdminContext, runPlatformAdminCli } from './platform-admin.cli';

// Entry point of `platform-admin:grant` and `platform-admin:revoke` (docs/SUPER_ADMIN.md). The
// first argument is the subcommand; everything else is in platform-admin.cli.ts.
function operator(): string {
  try {
    return `${userInfo().username}@${hostname()}`;
  } catch {
    return `desconhecido@${hostname()}`;
  }
}

async function main(): Promise<void> {
  const prompter = createPrompter(process.stdin, process.stdout);
  try {
    process.exitCode = await runPlatformAdminCli({
      argv: process.argv.slice(2),
      env: process.env,
      cwd: process.cwd(),
      prompter,
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
      openContext: openPlatformAdminContext,
      actor: operator(),
    });
  } finally {
    prompter.close();
  }
}

main().catch(() => {
  process.stderr.write('Erro inesperado no comando. Nada foi alterado.\n');
  process.exitCode = 1;
});
