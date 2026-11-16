import { hasPermission } from '@/lib/permissions';
import { DASHBOARD_NAV, DASHBOARD_SUBROUTES, canSee, filterNav, routeAccess } from './nav';

// B12 (piloto 2026-10-23): the kitchen saw "Cardápio" and got an error; PDV and Caixa opened by the
// address showed a generic error instead of "Sem acesso".
const ROLES = ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN', 'DELIVERY'];
const menu = (role: string) => filterNav(DASHBOARD_NAV, [role]).flatMap((g) => g.items).filter((i) => !i.soon).map((i) => i.key);

describe('dashboard menu and routes by role (B12)', () => {
  it('no menu entry or subroute leads a role to a screen the API refuses', () => {
    for (const item of [...DASHBOARD_NAV.flatMap((g) => g.items), ...DASHBOARD_SUBROUTES]) {
      if (!item.href || item.key === 'overview') continue;
      expect(item.permission).toBeDefined();
      for (const role of ROLES) {
        if (canSee(item, [role])) expect([item.key, role, hasPermission([role], item.permission!)]).toEqual([item.key, role, true]);
      }
    }
  });

  it('what each role sees (kitchen and courier lost Cardápio; WhatsApp for management and the counter)', () => {
    const all = ['overview', 'pedidos', 'pdv', 'mesas', 'cozinha', 'delivery', 'caixa', 'whatsapp', 'clientes', 'cupons', 'fidelidade', 'fiado', 'relatorios', 'cardapio', 'estoque', 'restaurante', 'usuarios'];
    expect(menu('OWNER')).toEqual(all);
    expect(menu('ADMIN')).toEqual(all);
    expect(menu('MANAGER')).toEqual(all);
    expect(menu('CASHIER')).toEqual(['overview', 'pedidos', 'pdv', 'mesas', 'caixa', 'whatsapp', 'clientes', 'fidelidade', 'fiado', 'cardapio', 'estoque']);
    expect(menu('WAITER')).toEqual(['overview', 'pedidos', 'mesas', 'cardapio']);
    expect(menu('KITCHEN')).toEqual(['overview', 'pedidos', 'cozinha', 'estoque']);
    expect(menu('DELIVERY')).toEqual(['overview', 'pedidos', 'delivery']);
  });

  it('a screen opened by its address follows the most specific rule', () => {
    expect(routeAccess('/dashboard')?.key).toBe('overview');
    expect(routeAccess('/dashboard/cardapio')?.key).toBe('cardapio');
    expect(routeAccess('/dashboard/pedidos/abc')?.key).toBe('pedidos');
    expect(routeAccess('/dashboard/mesas/abc')?.key).toBe('mesas');
    expect(routeAccess('/dashboard/estoque/insumos')?.key).toBe('estoque');
    expect(routeAccess('/dashboard/estoque/compras/nova')?.key).toBe('compras');
    expect(routeAccess('/dashboard/pdvx')).toBeUndefined();
    expect(routeAccess('/dashboard/atendimento/whatsapp')?.key).toBe('whatsapp');
    expect(canSee(routeAccess('/dashboard/atendimento/whatsapp')!, ['WAITER'])).toBe(false);
    const kitchen = ['KITCHEN'];
    expect(canSee(routeAccess('/dashboard/cardapio')!, kitchen)).toBe(false);
    expect(canSee(routeAccess('/dashboard/pdv')!, kitchen)).toBe(false);
    expect(canSee(routeAccess('/dashboard/caixa')!, ['WAITER'])).toBe(false);
    expect(canSee(routeAccess('/dashboard/estoque')!, kitchen)).toBe(true);
    expect(canSee(routeAccess('/dashboard/estoque/compras')!, kitchen)).toBe(false);
    expect(canSee(routeAccess('/dashboard/pedidos/abc')!, ['DELIVERY'])).toBe(true);
  });
});
