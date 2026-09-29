import type { LucideIcon } from 'lucide-react';
import {
  BookOpen,
  ChefHat,
  ClipboardList,
  LayoutDashboard,
  LayoutGrid,
  Package,
  Settings,
  Sparkles,
  Store,
  Users,
  Wallet,
} from 'lucide-react';

export interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  /** Omitted for modules that don't exist yet (rendered disabled, "Em breve"). */
  href?: string;
  /** Exact-match highlighting (dashboard root) instead of prefix match. */
  exact?: boolean;
  /** UI-only visibility hint. The real gate is always the backend's RBAC. */
  roles?: string[];
  soon?: boolean;
}

export interface NavGroup {
  key: string;
  label?: string;
  items: NavItem[];
}

const MANAGEMENT = ['OWNER', 'ADMIN', 'MANAGER'];

// Role hints mirror the links the old dashboard already gated (same lists),
// so no screen becomes visible to a role that couldn't see its link before.
export const DASHBOARD_NAV: NavGroup[] = [
  {
    key: 'home',
    items: [{ key: 'overview', label: 'Visão geral', icon: LayoutDashboard, href: '/dashboard', exact: true }],
  },
  {
    key: 'operacao',
    label: 'Operação',
    items: [
      { key: 'pedidos', label: 'Pedidos', icon: ClipboardList, href: '/dashboard/pedidos' },
      { key: 'pdv', label: 'PDV', icon: Store, href: '/dashboard/pdv', roles: [...MANAGEMENT, 'CASHIER'] },
      {
        key: 'mesas',
        label: 'Mesas e Comandas',
        icon: LayoutGrid,
        href: '/dashboard/mesas',
        roles: [...MANAGEMENT, 'WAITER', 'CASHIER'],
      },
      { key: 'cozinha', label: 'Cozinha', icon: ChefHat, href: '/dashboard/cozinha', roles: [...MANAGEMENT, 'KITCHEN'] },
      { key: 'caixa', label: 'Caixa', icon: Wallet, href: '/dashboard/caixa', roles: [...MANAGEMENT, 'CASHIER'] },
    ],
  },
  {
    key: 'gestao',
    label: 'Gestão',
    items: [
      { key: 'cardapio', label: 'Cardápio', icon: BookOpen, href: '/dashboard/cardapio' },
      { key: 'estoque', label: 'Estoque', icon: Package, href: '/dashboard/estoque', roles: [...MANAGEMENT, 'CASHIER', 'KITCHEN'] },
    ],
  },
  {
    key: 'admin',
    label: 'Administração',
    items: [
      { key: 'usuarios', label: 'Usuários', icon: Users, roles: MANAGEMENT, soon: true },
      { key: 'config', label: 'Configurações', icon: Settings, roles: MANAGEMENT, soon: true },
    ],
  },
  {
    key: 'outros',
    label: 'Outros',
    items: [{ key: 'recursos', label: 'Mais recursos', icon: Sparkles, roles: MANAGEMENT, soon: true }],
  },
];

export const DEMO_NAV: NavGroup[] = [
  {
    key: 'home',
    items: [{ key: 'overview', label: 'Visão geral', icon: LayoutDashboard, href: '/demo', exact: true }],
  },
  {
    key: 'operacao',
    label: 'Operação',
    items: [
      { key: 'pedidos', label: 'Pedidos', icon: ClipboardList, href: '/demo/pedidos' },
      { key: 'pdv', label: 'PDV', icon: Store, href: '/demo/pdv' },
      { key: 'cozinha', label: 'Cozinha', icon: ChefHat, href: '/demo/cozinha' },
      { key: 'caixa', label: 'Caixa', icon: Wallet, href: '/demo/caixa' },
    ],
  },
  {
    key: 'gestao',
    label: 'Gestão',
    items: [
      { key: 'cardapio', label: 'Cardápio', icon: BookOpen, href: '/demo/cardapio' },
      { key: 'estoque', label: 'Estoque', icon: Package, href: '/demo/estoque' },
    ],
  },
];

/** Drops items (and then empty groups) the user's roles can't see. */
export function filterNav(groups: NavGroup[], roles: string[] | null): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.roles || !roles || item.roles.some((r) => roles.includes(r))),
    }))
    .filter((group) => group.items.length > 0);
}

export function isItemActive(item: NavItem, pathname: string): boolean {
  if (!item.href) return false;
  if (item.exact) return pathname === item.href;
  return pathname === item.href || pathname.startsWith(`${item.href}/`);
}

export function findActiveItem(groups: NavGroup[], pathname: string): NavItem | undefined {
  return groups.flatMap((g) => g.items).find((item) => isItemActive(item, pathname));
}
