import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="theme-app flex min-h-screen flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold">Restaurant SaaS</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Fundação, cardápio administrativo e público, carrinho, checkout,
        painel de pedidos, cozinha (KDS), PDV de balcão e caixa disponíveis.
      </p>
      <div className="flex gap-3">
        <Link href="/login" className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary-hover">
          Entrar
        </Link>
        <Link
          href="/register"
          className="rounded-lg border border-line-strong px-4 py-2 text-sm text-foreground"
        >
          Criar restaurante
        </Link>
      </div>
    </main>
  );
}
