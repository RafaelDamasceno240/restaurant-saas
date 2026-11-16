import Link from 'next/link';

// The old sign-up address (2026-10-28). The service is not self-service: a restaurant is created
// by the team when it is sold, and the API has no sign-up route any more. The address stays so
// old links land on an explanation instead of a 404, with no form of any kind.
export default function RegisterPage() {
  return (
    <main className="flex min-h-screen items-center justify-center p-8">
      <div className="w-full max-w-sm space-y-4 text-center">
        <h1 className="text-xl font-semibold">Acesso controlado</h1>
        <p className="text-sm text-muted-foreground">
          Novos acessos são liberados diretamente pela equipe responsável.
        </p>
        <Link
          href="/login"
          className="inline-block rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover"
        >
          Voltar para o login
        </Link>
      </div>
    </main>
  );
}
