import { isPublicArea } from './session-area';

describe('isPublicArea', () => {
  it('treats the landing page, the public menu and the demo as session-free', () => {
    for (const path of ['/', '/menu/doce', '/menu/doce/carrinho', '/menu/doce/pedido/123', '/demo', '/demo/pdv']) {
      expect(isPublicArea(path)).toBe(true);
    }
  });

  it('keeps the session on the dashboard and on the sign-in pages', () => {
    for (const path of ['/dashboard', '/dashboard/pdv', '/login', '/register']) {
      expect(isPublicArea(path)).toBe(false);
    }
  });

  it('matches whole path segments only', () => {
    expect(isPublicArea('/menus')).toBe(false);
    expect(isPublicArea('/demonstracao')).toBe(false);
  });

  it('asks for the session when the path is unknown', () => {
    expect(isPublicArea(null)).toBe(false);
    expect(isPublicArea('')).toBe(false);
  });
});
