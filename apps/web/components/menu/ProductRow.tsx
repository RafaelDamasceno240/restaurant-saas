import Link from 'next/link';
import clsx from 'clsx';
import type { ProductBadge, PublicMenuProduct } from '@/lib/public-menu-api';
import { ProductImage } from './ProductImage';
import { ProductPrice } from './ProductPrice';

export const BADGE_LABEL: Record<ProductBadge, string> = {
  NEW: 'Novidade',
  VEGETARIAN: 'Vegetariano',
};

// One product of a category: text on the left, photo on the right; the whole row opens the
// product page (add-ons, note, quantity). A sold-out product stays visible, dimmed.
export function ProductRow({ product, slug }: { product: PublicMenuProduct; slug: string }) {
  const soldOut = !!product.soldOut;
  return (
    <li>
      <Link
        href={`/menu/${slug}/produto/${product.id}`}
        scroll={true}
        className={clsx(
          'flex min-h-[7.5rem] gap-3 px-4 py-4 transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none',
          soldOut && 'opacity-60',
        )}
        aria-label={`${product.name}${soldOut ? ' (esgotado)' : ''}`}
      >
        <div className="flex min-w-0 flex-1 flex-col">
          {(product.badges?.length ?? 0) > 0 && (
            <div className="mb-1 flex flex-wrap gap-1">
              {product.badges!.map((b) => (
                <span
                  key={b}
                  className="rounded-full bg-success/10 px-2 py-0.5 text-2xs font-medium text-success"
                >
                  {BADGE_LABEL[b]}
                </span>
              ))}
            </div>
          )}
          <h3 className="text-[0.95rem] font-semibold leading-snug text-foreground">
            {product.name}
          </h3>
          {product.description && (
            <p className="mt-1 line-clamp-2 text-[0.8rem] leading-relaxed text-muted-foreground">
              {product.description}
            </p>
          )}
          <div className="mt-auto pt-2">
            <ProductPrice product={product} />
          </div>
        </div>
        <div className="relative shrink-0">
          <ProductImage
            src={product.imageUrl}
            alt=""
            className="h-24 w-24 rounded-xl sm:h-28 sm:w-28"
          />
          {soldOut && (
            <span className="absolute inset-x-1 top-1/2 -translate-y-1/2 rounded-full bg-foreground/85 px-2 py-0.5 text-center text-2xs font-semibold uppercase tracking-wide text-surface">
              Esgotado
            </span>
          )}
        </div>
      </Link>
    </li>
  );
}
