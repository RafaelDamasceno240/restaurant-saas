'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import clsx from 'clsx';

export interface TabLink {
  href: string;
  label: string;
  exact?: boolean;
  badge?: string;
}

export function TabLinks({ items, className }: { items: TabLink[]; className?: string }) {
  const pathname = usePathname();
  return (
    <nav className={clsx('flex gap-1 overflow-x-auto overflow-y-hidden border-b border-line', className)}>
      {items.map((item) => {
        const active = item.exact ? pathname === item.href : pathname === item.href || pathname.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={clsx(
              '-mb-px inline-flex shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
              active ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
          >
            {item.label}
            {item.badge && (
              <span className="rounded bg-surface-hover px-1.5 py-px text-2xs font-semibold uppercase tracking-wide text-subtle">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
