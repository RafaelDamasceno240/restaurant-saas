'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';

// The restaurant exists (the layout checked it): only this product is gone, inactive or never
// existed. Back to this restaurant's menu, not to the start.
export default function ProductNotFound() {
  const { slug } = useParams<{ slug: string }>();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-8 text-center">
      <h1 className="text-xl font-semibold">Produto não encontrado</h1>
      <p className="max-w-sm text-sm text-muted-foreground">
        Este item não está mais no cardápio ou o link está incorreto.
      </p>
      <Link href={`/menu/${slug}`} className="inline-block py-3 text-sm text-foreground underline">
        Ver o cardápio
      </Link>
    </main>
  );
}
