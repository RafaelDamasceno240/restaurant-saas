import clsx from 'clsx';

// Connectors are skipped: "Cantina da Nona" is CN.
const CONNECTORS = new Set(['da', 'das', 'de', 'do', 'dos', 'e']);

export function brandInitials(name: string): string {
  return (
    name
      .split(/\s+/)
      .map((part) => part.replace(/[^\p{L}\p{N}]/gu, ''))
      .filter((part) => part && !CONNECTORS.has(part))
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || '?'
  );
}

// The restaurant's own logo in a circular frame, or its initials when it has none. Never a
// fixed brand: every restaurant (and the platform area) sees its own identity. A plain <img>:
// logos come from this host (/api/public/media/...), like the photos of the public menu.
// `decorative` when the name is printed next to it (alt=""); alone, it carries the name.
export function BrandMark({
  name,
  logoUrl,
  className,
  imageClassName = 'object-cover',
  decorative,
}: {
  name: string;
  logoUrl?: string | null;
  className: string;
  /** How the picture fills the circle (a badge with margins can zoom in). */
  imageClassName?: string;
  decorative?: boolean;
}) {
  return (
    <span
      className={clsx(
        'relative flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-background',
        className,
      )}
      role={decorative || logoUrl ? undefined : 'img'}
      aria-label={decorative || logoUrl ? undefined : name}
      aria-hidden={decorative && !logoUrl ? true : undefined}
    >
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoUrl}
          alt={decorative ? '' : name}
          className={clsx('h-full w-full', imageClassName)}
        />
      ) : (
        <span aria-hidden className="select-none font-heading font-semibold text-accent">
          {brandInitials(name)}
        </span>
      )}
    </span>
  );
}
