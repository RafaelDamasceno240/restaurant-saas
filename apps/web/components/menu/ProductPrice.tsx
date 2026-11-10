import clsx from 'clsx';
import type { PublicMenuProduct } from '@/lib/public-menu-api';
import { formatCentsAsBRL } from '@/lib/money';
import { priceLabel } from '@/lib/menu-display';

// "R$ 25,00", "A partir de R$ 34,00" or "De R$ 35,00 por R$ 32,00".
export function ProductPrice({
  product,
  className,
}: {
  product: PublicMenuProduct;
  className?: string;
}) {
  const label = priceLabel(product);
  return (
    <p className={clsx('flex flex-wrap items-baseline gap-x-1.5 text-sm', className)}>
      {label.compareAtCents !== null && (
        <span
          className="text-xs text-muted-foreground line-through"
          aria-label={`de ${formatCentsAsBRL(label.compareAtCents)}`}
        >
          {formatCentsAsBRL(label.compareAtCents)}
        </span>
      )}
      {label.startingAt && <span className="text-xs text-muted-foreground">A partir de</span>}
      <span
        className={clsx(
          'font-semibold',
          label.compareAtCents !== null ? 'text-success' : 'text-foreground',
        )}
      >
        {formatCentsAsBRL(label.priceCents)}
      </span>
    </p>
  );
}
