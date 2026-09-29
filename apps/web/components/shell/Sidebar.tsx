'use client';

import Image from 'next/image';
import Link from 'next/link';
import clsx from 'clsx';
import { HelpCircle, LifeBuoy, LogOut, Menu, PanelLeftClose, X } from 'lucide-react';
import { Tooltip } from '@/components/ds/Tooltip';
import { isItemActive, NavGroup, NavItem } from './nav';

export interface SidebarUser {
  name: string;
  email: string;
  roleLabel?: string;
}

export interface SidebarProps {
  groups: NavGroup[];
  pathname: string;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Mobile drawer: always rendered expanded, with a close button. */
  drawer?: boolean;
  onCloseDrawer?: () => void;
  brandHref: string;
  brandName: string;
  brandSubtitle?: string;
  user: SidebarUser;
  onLogout?: () => void;
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

// Official logo. The supplied artwork is a circular badge on a light square
// (JPEG, no transparency), so it is shown inside a circular frame: the frame
// crops away the light corners without touching the art (no filters, no
// redraw). `scale` zooms the badge so its rim fills the circle.
const LOGO_SRC = '/brand/doce-logo.png';
const LOGO_NAME = "Do'cê Hamburgueria";

function BrandLogo({ size, decorative }: { size: 'sm' | 'md'; decorative?: boolean }) {
  return (
    <span
      className={clsx(
        'relative block shrink-0 overflow-hidden rounded-full bg-background ring-1 ring-accent/40',
        size === 'md' ? 'h-9 w-9' : 'h-8 w-8',
      )}
    >
      <Image
        src={LOGO_SRC}
        // The restaurant name is printed next to the logo when expanded, so
        // there it is decorative (alt=""); on its own (collapsed) it needs the name.
        alt={decorative ? '' : LOGO_NAME}
        fill
        sizes="36px"
        priority
        className="scale-[1.28] object-contain"
      />
    </span>
  );
}

function NavRow({
  item,
  active,
  collapsed,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  collapsed: boolean;
  onNavigate?: () => void;
}) {
  const Icon = item.icon;
  const rowClass = clsx(
    'group relative flex h-9 items-center gap-3 rounded-ctl text-sm font-medium transition-colors',
    collapsed ? 'w-10 justify-center' : 'w-full px-2.5',
    active ? 'bg-accent/10 text-accent' : 'text-muted-foreground hover:bg-surface-hover hover:text-foreground',
    // Caramel marker: the selected item reads at a glance without a loud fill.
    active && "before:absolute before:left-0 before:top-1.5 before:h-6 before:w-[3px] before:rounded-r before:bg-primary",
    item.soon && 'cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground',
  );
  const inner = (
    <>
      <Icon className="h-[18px] w-[18px] shrink-0" aria-hidden />
      {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {!collapsed && item.soon && (
        <span className="rounded bg-surface-hover px-1.5 py-px text-2xs font-semibold uppercase tracking-wide text-subtle">
          Em breve
        </span>
      )}
    </>
  );

  const tooltip = item.soon ? `${item.label} — em breve` : item.label;

  return (
    <Tooltip label={tooltip} side="right" disabled={!collapsed} className={collapsed ? '' : 'w-full'}>
      {item.href && !item.soon ? (
        <Link
          href={item.href}
          onClick={onNavigate}
          aria-current={active ? 'page' : undefined}
          aria-label={collapsed ? item.label : undefined}
          className={rowClass}
        >
          {inner}
        </Link>
      ) : (
        <span aria-disabled="true" aria-label={collapsed ? tooltip : undefined} className={rowClass}>
          {inner}
        </span>
      )}
    </Tooltip>
  );
}

export function Sidebar({
  groups,
  pathname,
  collapsed: collapsedProp,
  onToggleCollapsed,
  drawer,
  onCloseDrawer,
  brandHref,
  brandName,
  brandSubtitle,
  user,
  onLogout,
}: SidebarProps) {
  const collapsed = drawer ? false : collapsedProp;

  return (
    <aside
      aria-label="Navegação principal"
      className={clsx(
        'flex h-full flex-col border-r border-line bg-sidebar',
        drawer ? 'w-64' : clsx('transition-[width] duration-200', collapsed ? 'w-[68px]' : 'w-60'),
      )}
    >
      {/* Brand */}
      <div className={clsx('flex h-14 shrink-0 items-center border-b border-line', collapsed ? 'justify-center' : 'gap-2 px-3')}>
        {collapsed ? (
          <Tooltip label={LOGO_NAME} side="right">
            <Link href={brandHref} aria-label={LOGO_NAME} className="flex rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60">
              <BrandLogo size="md" />
            </Link>
          </Tooltip>
        ) : (
          <>
            {drawer ? (
              <button
                type="button"
                onClick={onCloseDrawer}
                aria-label="Fechar menu"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            ) : (
              <button
                type="button"
                onClick={onToggleCollapsed}
                aria-label="Recolher menu"
                aria-expanded
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-ctl text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <PanelLeftClose className="h-5 w-5" />
              </button>
            )}
            <Link href={brandHref} onClick={onCloseDrawer} className="flex min-w-0 items-center gap-2.5">
              <BrandLogo size="md" decorative />
              <span className="min-w-0 leading-tight">
                <span className="block truncate font-heading text-sm font-semibold text-foreground">{brandName}</span>
                {brandSubtitle && <span className="block truncate text-2xs text-subtle">{brandSubtitle}</span>}
              </span>
            </Link>
          </>
        )}
      </div>

      {/* Navigation */}
      <nav className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {collapsed && (
          <div className="mb-3 flex justify-center">
            <Tooltip label="Expandir menu" side="right">
              <button
                type="button"
                onClick={onToggleCollapsed}
                aria-label="Expandir menu"
                aria-expanded={false}
                className="flex h-9 w-10 items-center justify-center rounded-ctl text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                <Menu className="h-5 w-5" />
              </button>
            </Tooltip>
          </div>
        )}
        {groups.map((group, index) => (
          <div key={group.key} className={clsx(index > 0 && 'mt-4 border-t border-line pt-3')}>
            {group.label &&
              (collapsed ? null : (
                <p className="mb-1.5 px-2.5 text-2xs font-semibold uppercase tracking-wider text-subtle">{group.label}</p>
              ))}
            <ul className={clsx('space-y-0.5', collapsed && 'flex flex-col items-center')}>
              {group.items.map((item) => (
                <li key={item.key} className={collapsed ? '' : 'w-full'}>
                  <NavRow
                    item={item}
                    active={isItemActive(item, pathname)}
                    collapsed={collapsed}
                    onNavigate={onCloseDrawer}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {/* Footer: help + user */}
      <div className="shrink-0 space-y-0.5 border-t border-line px-3 py-3">
        <div className={clsx('space-y-0.5', collapsed && 'flex flex-col items-center')}>
          <NavRow
            item={{ key: 'ajuda', label: 'Ajuda', icon: HelpCircle, soon: true }}
            active={false}
            collapsed={collapsed}
          />
          <NavRow
            item={{ key: 'suporte', label: 'Suporte', icon: LifeBuoy, soon: true }}
            active={false}
            collapsed={collapsed}
          />
        </div>

        <div className={clsx('mt-2 flex items-center gap-2.5 rounded-ctl border border-line bg-surface p-2', collapsed && 'flex-col border-0 bg-transparent p-0')}>
          <Tooltip label={`${user.name} · ${user.email}`} side="right" disabled={!collapsed}>
            <span
              aria-hidden
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-hover text-xs font-semibold text-foreground"
            >
              {initials(user.name) || '?'}
            </span>
          </Tooltip>
          {!collapsed && (
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-xs font-medium text-foreground">{user.name}</span>
              <span className="block truncate text-2xs text-subtle">{user.email}</span>
            </span>
          )}
          {onLogout && (
            <Tooltip label="Sair" side="right" disabled={!collapsed}>
              <button
                type="button"
                onClick={onLogout}
                aria-label="Sair"
                className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-danger/10 hover:text-danger"
              >
                <LogOut className="h-4 w-4" />
              </button>
            </Tooltip>
          )}
        </div>
      </div>
    </aside>
  );
}
