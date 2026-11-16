import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ApiError } from '@/lib/api-client';
import { loadPublicMenu } from '@/lib/public-menu-server';
import { Storefront } from '@/components/menu/Storefront';

interface PageProps {
  params: { slug: string };
}

// Shares the lookup with the segment layout (which is what answers 404 for an unknown slug).
export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  try {
    const menu = await loadPublicMenu(params.slug);
    return {
      title: menu.restaurant.name + ' — Cardápio',
      description: menu.restaurant.description ?? `Cardápio de ${menu.restaurant.name}: peça online.`,
    };
  } catch {
    return {};
  }
}

// Server Component: the fetch happens on the server before any HTML is
// sent, so there is no client-side loading flash for the initial data —
// Next's loading.tsx (in this same route segment) covers the round trip
// itself. No auth/session concerns here at all: this route is fully public.
// The storefront itself (search, tabs that follow the scroll) is a client component.
export default async function PublicMenuPage({ params }: PageProps) {
  let menu;
  try {
    menu = await loadPublicMenu(params.slug);
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

  return <Storefront menu={menu} slug={params.slug} />;
}
