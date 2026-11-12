import type { LucideIcon } from 'lucide-react';
import {
  BarChart3,
  Bike,
  BookOpen,
  Building2,
  ChefHat,
  ClipboardList,
  Contact,
  Gift,
  LayoutDashboard,
  LayoutGrid,
  MessageCircle,
  NotebookPen,
  Package,
  Settings,
  ShieldCheck,
  Sparkles,
  Store,
  Ticket,
  Users,
  Wallet,
} from 'lucide-react';
import type { Permission } from '@/lib/permissions';

export interface NavItem {
  key: string;
  label: string;
  icon: LucideIcon;
  href?: string;
  exact?: boolean;
  roles?: string[];
  // B12: what the screen needs from the API to work. Every role in `roles` must have it
  // (nav.test.ts checks it against lib/permissions.ts), so no menu leads to a 403.
  permission?: Permission;
  soon?: boolean;
}

export interface NavGroup {
  key: string;
  label?: string;
  items: NavItem[];
}

const MANAGEMENT = ['OWNER', 'ADMIN', 'MANAGER'];

export const DASHBOARD_NAV: NavGroup[] = [
  {
    key: 'home',
    items: [{ key: 'overview', label: 'Visão geral', icon: LayoutDashboard, href: '/dashboard', exact: true }],
  },
  {
    key: 'operacao',
    label: 'Operação',
    items: [
      { key: 'pedidos', label: 'Pedidos', icon: ClipboardList, href: '/dashboard/pedidos', permission: 'orders.read' },
      { key: 'pdv', label: 'PDV', icon: Store, href: '/dashboard/pdv', roles: [...MANAGEMENT, 'CASHIER'], permission: 'pos.create' },
      {
        key: 'mesas',
        label: 'Mesas e Comandas',
        icon: LayoutGrid,
        href: '/dashboard/mesas',
        roles: [...MANAGEMENT, 'WAITER', 'CASHIER'],
        permission: 'tables.read',
      },
      { key: 'cozinha', label: 'Cozinha', icon: ChefHat, href: '/dashboard/cozinha', roles: [...MANAGEMENT, 'KITCHEN'], permission: 'orders.update' },
      { key: 'delivery', label: 'Delivery', icon: Bike, href: '/dashboard/delivery', roles: [...MANAGEMENT, 'DELIVERY'], permission: 'delivery.read' },
      { key: 'caixa', label: 'Caixa', icon: Wallet, href: '/dashboard/caixa', roles: [...MANAGEMENT, 'CASHIER'], permission: 'cash.read' },
    ],
  },
  {
    key: 'atendimento',
    label: 'Atendimento',
    items: [
      {
        key: 'whatsapp',
        label: 'WhatsApp',
        icon: MessageCircle,
        href: '/dashboard/atendimento/whatsapp',
        roles: [...MANAGEMENT, 'CASHIER'],
        permission: 'whatsapp.read',
      },
    ],
  },
  {
    key: 'gestao',
    label: 'Gestão',
    items: [
      { key: 'clientes', label: 'Clientes', icon: Contact, href: '/dashboard/clientes', roles: [...MANAGEMENT, 'CASHIER'], permission: 'customers.read' },
      { key: 'cupons', label: 'Cupons', icon: Ticket, href: '/dashboard/cupons', roles: MANAGEMENT, permission: 'coupons.read' },
      { key: 'fidelidade', label: 'Fidelidade', icon: Gift, href: '/dashboard/fidelidade', roles: [...MANAGEMENT, 'CASHIER'], permission: 'loyalty.read' },
      { key: 'fiado', label: 'Fiado', icon: NotebookPen, href: '/dashboard/fiado', roles: [...MANAGEMENT, 'CASHIER'], permission: 'receivables.read' },
      { key: 'relatorios', label: 'Relatórios', icon: BarChart3, href: '/dashboard/relatorios', roles: MANAGEMENT, permission: 'reports.read' },
      // B12: was open to every role; KITCHEN and DELIVERY cannot read the catalogue (products.read).
      {
        key: 'cardapio',
        label: 'Cardápio',
        icon: BookOpen,
        href: '/dashboard/cardapio',
        roles: [...MANAGEMENT, 'CASHIER', 'WAITER', 'VIEWER'],
        permission: 'products.read',
      },
      { key: 'estoque', label: 'Estoque', icon: Package, href: '/dashboard/estoque', roles: [...MANAGEMENT, 'CASHIER', 'KITCHEN'], permission: 'inventory.read' },
      { key: 'restaurante', label: 'Restaurante', icon: Building2, href: '/dashboard/restaurante', roles: MANAGEMENT, permission: 'restaurant.read' },
    ],
  },
  {
    key: 'admin',
    label: 'Administração',
    items: [
      { key: 'usuarios', label: 'Usuários', icon: Users, href: '/dashboard/usuarios', roles: MANAGEMENT, permission: 'users.read' },
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
      { key: 'restaurante', label: 'Restaurante', icon: Building2, href: '/demo/restaurante' },
    ],
  },
];
// /super-admin: the administration of the PLATFORM (every restaurant), with its own menu. Never
// mixed into DASHBOARD_NAV, which is the menu of ONE restaurant.
export const SUPER_ADMIN_NAV: NavGroup[] = [
  {
    key: 'plataforma',
    label: 'Administração da Plataforma',
    items: [
      { key: 'overview', label: 'Visão geral', icon: LayoutDashboard, href: '/super-admin', exact: true },
      { key: 'restaurantes', label: 'Restaurantes', icon: Building2, href: '/super-admin/restaurantes' },
    ],
  },
];

// The way from a restaurant's panel to /super-admin, added only for a platform administrator
// (/auth/me isPlatformAdmin). Hiding it is convenience: the API refuses everyone else anyway.
export const PLATFORM_LINK_GROUP: NavGroup = {
  key: 'plataforma',
  label: 'Plataforma',
  items: [{ key: 'super-admin', label: 'Administração da Plataforma', icon: ShieldCheck, href: '/super-admin' }],
};

export function dashboardNav(roles: string[] | null, isPlatformAdmin: boolean): NavGroup[] {
  return [...filterNav(DASHBOARD_NAV, roles), ...(isPlatformAdmin ? [PLATFORM_LINK_GROUP] : [])];
}

// Screens below a menu entry that ask for more than the entry itself.
export const DASHBOARD_SUBROUTES: NavItem[] = [
  { key: 'compras', label: 'Compras', icon: Package, href: '/dashboard/estoque/compras', roles: MANAGEMENT, permission: 'purchases.read' },
];

// B12: the rule for the screen at `pathname` (the most specific menu entry or subroute that
// covers it), so the dashboard can refuse a screen opened by its address, not only hide its menu.
export function routeAccess(pathname: string): NavItem | undefined {
  return [...DASHBOARD_NAV.flatMap((g) => g.items), ...DASHBOARD_SUBROUTES]
    .filter((item) => isItemActive(item, pathname))
    .sort((a, b) => (b.href?.length ?? 0) - (a.href?.length ?? 0))[0];
}

export function canSee(item: NavItem, roles: string[] | null): boolean {
  return !item.roles || !roles || item.roles.some((r) => roles.includes(r));
}

export function filterNav(groups: NavGroup[], roles: string[] | null): NavGroup[] {
  return groups
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => canSee(item, roles)),
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
