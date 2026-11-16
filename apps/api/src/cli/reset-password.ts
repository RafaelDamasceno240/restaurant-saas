import { hostname, userInfo } from 'os';

// Entry point of `user:reset-password` (docs/authentication.md). Everything else is in
// reset-password.cli.ts.

// Taken before anything loads the Prisma client, which copies apps/api/.env into process.env on
// import: the command must tell the settings that came from the shell apart from the file's.
const env = { ...process.env };

function operator(): string {
  try {
    return `${userInfo().username}@${hostname()}`;
  } catch {
    return `desconhecido@${hostname()}`;
  }
}

async function main(): Promise<void> {
  const { createPrompter } = await import('./provision-tenant.cli');
  const { openResetPasswordContext, runResetPasswordCli } = await import('./reset-password.cli');
  const prompter = createPrompter(process.stdin, process.stdout);
  try {
    process.exitCode = await runResetPasswordCli({
      argv: process.argv.slice(2),
      env,
      cwd: process.cwd(),
      prompter,
      out: (line) => process.stdout.write(`${line}\n`),
      err: (line) => process.stderr.write(`${line}\n`),
      openContext: openResetPasswordContext,
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
