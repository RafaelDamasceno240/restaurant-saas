'use client';

import { ReactNode } from 'react';
import { Menu } from 'lucide-react';

// Presentational only: the hamburger (mobile), the current section title and
// a slot for chips. What goes in the slot is decided by the caller —
// DashboardChips for the real app, DemoChips for /demo.
export function Topbar({
  title,
  onOpenMenu,
  children,
}: {
  title?: string;
  onOpenMenu: () => void;
  children?: ReactNode;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-background/95 px-3 backdrop-blur sm:px-4">
      <button
        type="button"
        onClick={onOpenMenu}
        aria-label="Abrir menu"
        className="flex h-9 w-9 items-center justify-center rounded-ctl text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground md:hidden"
      >
        <Menu className="h-5 w-5" />
      </button>
      {title && <p className="hidden truncate text-sm font-semibold text-foreground sm:block">{title}</p>}
      <div className="ml-auto flex min-w-0 items-center gap-2 overflow-x-auto py-1">{children}</div>
    </header>
  );
}
