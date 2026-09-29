import Link from 'next/link';

export default function OrderNotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-xl font-semibold">Pedido não encontrado</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Verifique se o link do pedido está correto.
      </p>
      <Link href="/" className="text-sm text-foreground underline">
        Voltar para o início
      </Link>
    </main>
  );
}
