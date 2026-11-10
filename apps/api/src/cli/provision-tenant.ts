import { hostname, userInfo } from 'os';
import { createPrompter, openNestContext, runProvisionCli } from './provision-tenant.cli';

// Entry point of `tenant:provision` (docs/PROVISIONING.md). Everything it does is in
// provision-tenant.cli.ts; this file only wires the real terminal and process to it.
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
    process.exitCode = await runProvisionCli({
      argv: process.argv.slice(2),
      env: process.env,
      cwd: process.cwd(),
      prompter,
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
      openContext: openNestContext,
      actor: operator(),
    });
  } finally {
    prompter.close();
  }
}

main().catch(() => {
  process.stderr.write('Erro inesperado no comando. Nada foi criado.\n');
  process.exitCode = 1;
});
