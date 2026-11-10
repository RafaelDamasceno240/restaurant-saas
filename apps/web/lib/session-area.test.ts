import { isPublicArea, isSessionRefusal } from './session-area';

describe('isPublicArea', () => {
  it('treats the landing page, the public menu, the demo and the old sign-up notice as session-free', () => {
    for (const path of ['/', '/menu/doce', '/menu/doce/carrinho', '/menu/doce/pedido/123', '/demo', '/demo/pdv', '/register']) {
      expect(isPublicArea(path)).toBe(true);
    }
  });

  it('keeps the session on the dashboard and on the sign-in page', () => {
    for (const path of ['/dashboard', '/dashboard/pdv', '/login']) {
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

describe('isSessionRefusal', () => {
  it('only 401 and 403 mean "not signed in"', () => {
    expect(isSessionRefusal(401)).toBe(true);
    expect(isSessionRefusal(403)).toBe(true);
  });

  it('no answer, a server error or a rate limit say nothing about the session', () => {
    expect(isSessionRefusal(null)).toBe(false);
    expect(isSessionRefusal(500)).toBe(false);
    expect(isSessionRefusal(502)).toBe(false);
    expect(isSessionRefusal(503)).toBe(false);
    expect(isSessionRefusal(429)).toBe(false);
    expect(isSessionRefusal(404)).toBe(false);
  });
});
