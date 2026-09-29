import { notFound } from 'next/navigation';
import { getPublicMenu } from '@/lib/public-menu-api';
import { ApiError } from '@/lib/api-client';
import { ProductCard } from '@/components/menu/ProductCard';
import { CartFloatingButton } from '@/components/menu/CartFloatingButton';

interface PageProps {
  params: { slug: string };
}

// Server Component: the fetch happens on the server before any HTML is
// sent, so there is no client-side loading flash for the initial data —
// Next's loading.tsx (in this same route segment) covers the round trip
// itself. No auth/session concerns here at all: this route is fully public.
export default async function PublicMenuPage({ params }: PageProps) {
  let menu;
  try {
    menu = await getPublicMenu(params.slug);
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) {
      notFound();
    }
    return (
      <main className="flex min-h-screen items-center justify-center p-8 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">
          Não foi possível carregar o cardápio agora. Tente novamente em instantes.
        </p>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background pb-16">
      <header className="sticky top-0 z-10 border-b border-line bg-surface/90 px-4 py-4 backdrop-blur">
        <h1 className="truncate text-lg font-semibold">{menu.restaurant.name}</h1>
      </header>

      {menu.categories.length === 0 ? (
        <p className="p-8 text-center text-sm text-muted-foreground">
          Este restaurante ainda não publicou itens no cardápio.
        </p>
      ) : (
        <>
          <nav className="sticky top-[57px] z-10 flex gap-2 overflow-x-auto border-b border-line bg-surface px-4 py-2">
            {menu.categories.map((category) => (
              <a
                key={category.id}
                href={`#categoria-${category.id}`}
                className="whitespace-nowrap rounded-full bg-surface-hover px-3 py-1 text-sm text-muted-foreground"
              >
                {category.name}
              </a>
            ))}
          </nav>

          <div className="space-y-8 px-4 py-6">
            {menu.categories.map((category) => (
              <section key={category.id} id={`categoria-${category.id}`}>
                <h2 className="mb-1 text-base font-semibold">{category.name}</h2>
                {category.description && (
                  <p className="mb-3 text-sm text-muted-foreground">{category.description}</p>
                )}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {category.products.map((product) => (
                    <ProductCard
                      key={product.id}
                      product={product}
                      restaurant={{ slug: params.slug, name: menu.restaurant.name }}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        </>
      )}

      <CartFloatingButton restaurantSlug={params.slug} />
    </main>
  );
}
