import fs from 'fs';
import path from 'path';

// public/sw.js is plain JavaScript served as-is; its decisions are pure functions exported for
// this test (the `module` global does not exist inside a real service worker).
const worker = require('../public/sw.js') as {
  strategyFor: (request: { method: string; url: string; mode?: string }, scopeOrigin: string) => 'bypass' | 'navigate' | 'static';
  isCacheable: (response: { status: number; type: string } | null | undefined) => boolean;
  notificationTarget: (data: unknown) => string;
  PRECACHE: string[];
  STATIC_CACHE: string;
};

const ORIGIN = 'https://app.example.com';
const get = (pathname: string, mode = 'cors') => ({ method: 'GET', url: `${ORIGIN}${pathname}`, mode });
const strategy = (request: { method: string; url: string; mode?: string }) => worker.strategyFor(request, ORIGIN);

describe('service worker: what may be cached', () => {
  it('never touches the API, whatever the method', () => {
    expect(strategy(get('/api/orders'))).toBe('bypass');
    expect(strategy(get('/api/auth/me'))).toBe('bypass');
    expect(strategy(get('/api/receivables?status=open'))).toBe('bypass');
    expect(strategy(get('/api'))).toBe('bypass');
    // Even a navigation to an API address is left alone.
    expect(strategy(get('/api/orders', 'navigate'))).toBe('bypass');
  });

  it('never touches writes', () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(strategy({ method, url: `${ORIGIN}/api/pos/orders`, mode: 'cors' })).toBe('bypass');
      expect(strategy({ method, url: `${ORIGIN}/_next/static/chunks/a.js`, mode: 'cors' })).toBe('bypass');
      expect(strategy({ method, url: `${ORIGIN}/dashboard`, mode: 'navigate' })).toBe('bypass');
    }
  });

  it('pages are fetched from the network every time (offline page as the only fallback)', () => {
    expect(strategy(get('/dashboard', 'navigate'))).toBe('navigate');
    expect(strategy(get('/dashboard/pdv', 'navigate'))).toBe('navigate');
    expect(strategy(get('/login', 'navigate'))).toBe('navigate');
    expect(strategy(get('/menu/minha-loja', 'navigate'))).toBe('navigate');
  });

  it('page data requested by the router is not cached either', () => {
    expect(strategy(get('/dashboard/pedidos?_rsc=abc12'))).toBe('bypass');
    expect(strategy(get('/_next/data/build/dashboard.json'))).toBe('bypass');
    expect(strategy(get('/_next/image?url=%2Fbrand%2Flogo.png&w=64&q=75'))).toBe('bypass');
    expect(strategy(get('/brand/doce-logo.png'))).toBe('bypass');
    expect(strategy(get('/manifest.webmanifest'))).toBe('bypass');
    expect(strategy(get('/sw.js'))).toBe('bypass');
  });

  it('keeps only the immutable build files and the app icons', () => {
    expect(strategy(get('/_next/static/chunks/app/layout-1a2b3c.js'))).toBe('static');
    expect(strategy(get('/_next/static/css/9f8e7d.css'))).toBe('static');
    expect(strategy(get('/icons/icon-192.png'))).toBe('static');
    expect(strategy(get('/favicon.ico'))).toBe('static');
  });

  it('leaves other origins and malformed addresses alone', () => {
    expect(strategy({ method: 'GET', url: 'https://cdn.example.org/_next/static/x.js', mode: 'cors' })).toBe('bypass');
    expect(strategy({ method: 'GET', url: 'https://evil.example/api/orders', mode: 'navigate' })).toBe('bypass');
    expect(strategy({ method: 'GET', url: 'not a url', mode: 'cors' })).toBe('bypass');
  });

  it('a path that only looks like the API or the static folder gets no special treatment', () => {
    expect(strategy(get('/apiary'))).toBe('bypass');
    expect(strategy(get('/dashboard/_next/static/x.js'))).toBe('bypass');
    expect(strategy(get('/icons-of-something/x.png'))).toBe('bypass');
  });

  it('stores only complete, same-origin, successful answers', () => {
    expect(worker.isCacheable({ status: 200, type: 'basic' })).toBe(true);
    expect(worker.isCacheable({ status: 404, type: 'basic' })).toBe(false);
    expect(worker.isCacheable({ status: 500, type: 'basic' })).toBe(false);
    expect(worker.isCacheable({ status: 206, type: 'basic' })).toBe(false);
    expect(worker.isCacheable({ status: 200, type: 'opaque' })).toBe(false);
    expect(worker.isCacheable({ status: 200, type: 'cors' })).toBe(false);
    expect(worker.isCacheable(null)).toBe(false);
  });

  it('precaches only files that exist, and nothing that depends on a session', () => {
    const publicDir = path.join(__dirname, '..', 'public');
    for (const file of worker.PRECACHE) {
      expect(fs.existsSync(path.join(publicDir, file))).toBe(true);
      expect(file.startsWith('/api')).toBe(false);
      expect(file.startsWith('/dashboard')).toBe(false);
    }
    expect(worker.PRECACHE).toContain('/offline.html');
  });
});

describe('service worker: where a notification leads', () => {
  it('opens dashboard paths only', () => {
    expect(worker.notificationTarget({ path: '/dashboard/pedidos' })).toBe('/dashboard/pedidos');
    expect(worker.notificationTarget({ path: '/dashboard' })).toBe('/dashboard');
    expect(worker.notificationTarget({ path: '/dashboard/pedidos/0b1c2d3e-aaaa-4bbb-8ccc-1234567890ab' })).toBe('/dashboard/pedidos/0b1c2d3e-aaaa-4bbb-8ccc-1234567890ab');
  });

  it('falls back to the orders screen for anything else', () => {
    for (const data of [null, undefined, {}, { path: 5 }, { path: 'https://evil.example/' }, { path: '//evil.example' }, { path: '/login' }, { path: '/dashboard/../api/x' }, { path: '/dashboard?next=//evil' }, { path: 'javascript:alert(1)' }]) {
      expect(worker.notificationTarget(data)).toBe('/dashboard/pedidos');
    }
  });
});

describe('offline page', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'public', 'offline.html'), 'utf8');

  it('is static: no script, nothing loaded from another origin', () => {
    expect(html).not.toMatch(/<script/i);
    expect(html).not.toMatch(/https?:\/\//i);
    expect(html).toMatch(/Sem conexão/);
  });
});
