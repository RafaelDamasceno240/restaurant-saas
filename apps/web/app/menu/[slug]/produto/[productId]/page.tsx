import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ApiError } from '@/lib/api-client';
import { loadPublicMenu } from '@/lib/public-menu-server';
import type { PublicMenuResponse } from '@/lib/public-menu-api';
import { ProductDetail } from '@/components/menu/ProductDetail';

interface PageProps {
  params: { slug: string; productId: string };
}

function findProduct(menu: PublicMenuResponse, productId: string) {
  for (const category of menu.categories) {
    const product = category.products.find((p) => p.id === productId);
    if (product) return product;
  }
  return null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  try {
    const menu = await loadPublicMenu(params.slug);
    const product = findProduct(menu, params.productId);
    return product
      ? {
          title: `${product.name} — ${menu.restaurant.name}`,
          description: product.description ?? undefined,
        }
      : {};
  } catch {
    return {};
  }
}

// One product of the public menu, with its own address (shareable, and the back button returns
// to the menu). Read from the same menu payload as the menu page: a product the menu does not
// list (inactive, another restaurant's, unknown id) is a 404.
export default async function PublicProductPage({ params }: PageProps) {
  let menu: PublicMenuResponse;
  try {
    menu = await loadPublicMenu(params.slug);
  } catch (err) {
    if (err instanceof ApiError && err.statusCode === 404) notFound();
    return (
      <main className="flex min-h-screen items-center justify-center p-8 text-center">
        <p className="max-w-sm text-sm text-muted-foreground">
          Não foi possível carregar o produto agora. Tente novamente em instantes.
        </p>
      </main>
    );
  }
  const product = findProduct(menu, params.productId);
  if (!product) notFound();
  return <ProductDetail product={product} restaurant={menu.restaurant} slug={params.slug} />;
}
