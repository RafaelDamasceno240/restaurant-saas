'use client';

import { ReactNode, useCallback, useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { findActiveItem, NavGroup } from './nav';
import { Sidebar, SidebarUser } from './Sidebar';
import { Topbar } from './Topbar';

const STORAGE_KEY = 'restaurant-saas:sidebar-collapsed';

// The single application frame used by /dashboard/* and /demo/*:
//   fixed sidebar (collapsible, drawer under `md`) + topbar + scrolling main.
// Pages render inside <main>; full-bleed screens (PDV, KDS) simply fill it.
export function AppShell({
  groups,
  brandHref,
  brandName,
  brandSubtitle,
  user,
  onLogout,
  topbarChips,
  banner,
  children,
}: {
  groups: NavGroup[];
  brandHref: string;
  brandName: string;
  brandSubtitle?: string;
  user: SidebarUser;
  onLogout?: () => void;
  topbarChips?: ReactNode;
  banner?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);

  // Preference restored after mount (avoids an SSR/hydration mismatch). With
  // no stored preference, tablet-width viewports start collapsed.
  useEffect(() => {
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(STORAGE_KEY);
    } catch {
      stored = null;
    }
    if (stored === '1' || stored === '0') {
      setCollapsed(stored === '1');
    } else {
      setCollapsed(window.innerWidth < 1280);
    }
  }, []);

  const toggleCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
      } catch {
        // preference just won't persist
      }
      return next;
    });
  }, []);

  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  useEffect(() => {
    if (!drawerOpen) return;
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setDrawerOpen(false);
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [drawerOpen]);

  const sidebarProps = {
    groups,
    pathname,
    collapsed,
    onToggleCollapsed: toggleCollapsed,
    brandHref,
    brandName,
    brandSubtitle,
    user,
    onLogout,
  };

  return (
    <div className="theme-app flex h-[100dvh] overflow-hidden">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-3 focus:top-3 focus:z-[70] focus:rounded-ctl focus:bg-primary focus:px-3 focus:py-2 focus:text-sm focus:font-semibold focus:text-primary-foreground"
      >
        Pular para o conteúdo
      </a>

      <div className="hidden shrink-0 md:block">
        <Sidebar {...sidebarProps} />
      </div>

      {drawerOpen && (
        <div className="fixed inset-0 z-50 md:hidden">
          <div className="absolute inset-0 animate-fade-in bg-black/60" onClick={closeDrawer} aria-hidden />
          <div className="absolute inset-y-0 left-0 animate-slide-in-left">
            <Sidebar {...sidebarProps} drawer onCloseDrawer={closeDrawer} />
          </div>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar title={findActiveItem(groups, pathname)?.label} onOpenMenu={() => setDrawerOpen(true)}>
          {topbarChips}
        </Topbar>
        {banner}
        <main id="main" tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto outline-none">
          {children}
        </main>
      </div>
    </div>
  );
}
