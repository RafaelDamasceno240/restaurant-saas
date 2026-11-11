import clsx from 'clsx';
import { UtensilsCrossed } from 'lucide-react';

// Photo of a product (or a neutral placeholder). A plain <img>: images come from this host
// (/api/public/media/...) or from any https URL a restaurant pasted, so next/image would need an
// unbounded list of domains.
export function ProductImage({
  src,
  alt,
  className,
  eager = false,
}: {
  src: string | null | undefined;
  alt: string;
  className?: string;
  eager?: boolean;
}) {
  if (!src) {
    return (
      <div
        aria-hidden
        className={clsx('flex items-center justify-center bg-surface-2 text-subtle', className)}
      >
        <UtensilsCrossed className="h-1/3 w-1/3 max-h-10 max-w-10" />
      </div>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      loading={eager ? 'eager' : 'lazy'}
      decoding="async"
      className={clsx('bg-surface-2 object-cover', className)}
    />
  );
}
