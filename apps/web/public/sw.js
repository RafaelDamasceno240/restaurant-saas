/* Service worker of the operator app (docs/PWA.md).
 *
 * Deliberately conservative. This app shows money, orders and customer data behind a session,
 * so the worker NEVER stores:
 *   - anything under /api (every answer depends on who is asking, and on now);
 *   - HTML documents (they carry a per-request CSP nonce and reflect the session);
 *   - React Server Component payloads, images of the menu, or anything from another origin.
 * It only keeps the build's immutable, content-hashed files (/_next/static) and the app icons,
 * plus one static "you are offline" page shown when a navigation cannot reach the server.
 * Nothing here can make a sale look done when it was not: writes always go to the network.
 */
const VERSION = 'v1';
const STATIC_CACHE = `static-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const PRECACHE = [OFFLINE_URL, '/icons/icon-192.png', '/icons/icon.svg'];

// What to do with a request. Pure, so it is unit-tested (lib/service-worker.test.ts).
//   'bypass'   -> the worker does not touch it (the browser goes to the network as usual)
//   'navigate' -> network only; if the network is unreachable, the offline page
//   'static'   -> cache first (the file name changes whenever its content changes)
function strategyFor(request, scopeOrigin) {
  if (request.method !== 'GET') return 'bypass';
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return 'bypass';
  }
  if (url.origin !== scopeOrigin) return 'bypass';
  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) return 'bypass';
  if (request.mode === 'navigate') return 'navigate';
  if (url.pathname.startsWith('/_next/static/')) return 'static';
  if (url.pathname.startsWith('/icons/') || url.pathname === '/favicon.ico') return 'static';
  return 'bypass';
}

// Only complete, same-origin, successful answers are kept.
function isCacheable(response) {
  return !!response && response.status === 200 && response.type === 'basic';
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (isCacheable(response)) await cache.put(request, response.clone());
  return response;
}

async function networkOrOfflinePage(request) {
  try {
    return await fetch(request);
  } catch (error) {
    const cache = await caches.open(STATIC_CACHE);
    const offline = await cache.match(OFFLINE_URL);
    if (offline) return offline;
    throw error;
  }
}

// Where a notification leads: only paths of this app, never an address taken from outside.
function notificationTarget(data) {
  const path = data && typeof data.path === 'string' ? data.path : '';
  return /^\/dashboard(\/[A-Za-z0-9\-/]*)?$/.test(path) ? path : '/dashboard/pedidos';
}

if (typeof self !== 'undefined' && typeof self.skipWaiting === 'function') {
  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches
        .open(STATIC_CACHE)
        .then((cache) => cache.addAll(PRECACHE))
        .then(() => self.skipWaiting()),
    );
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches
        .keys()
        .then((names) => Promise.all(names.filter((name) => name !== STATIC_CACHE).map((name) => caches.delete(name))))
        .then(() => self.clients.claim()),
    );
  });

  self.addEventListener('fetch', (event) => {
    const strategy = strategyFor(event.request, self.location.origin);
    if (strategy === 'static') event.respondWith(cacheFirst(event.request));
    else if (strategy === 'navigate') event.respondWith(networkOrOfflinePage(event.request));
  });

  // The app shows "new order" notifications itself while it is open (see
  // components/pwa/NewOrderAlerts.tsx). There is no push server yet, so no 'push' listener.
  self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = notificationTarget(event.notification.data);
    event.waitUntil(
      self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
        const open = windows.find((client) => 'focus' in client);
        if (open) {
          if ('navigate' in open) open.navigate(target).catch(() => undefined);
          return open.focus();
        }
        return self.clients.openWindow(target);
      }),
    );
  });
}

if (typeof module !== 'undefined') {
  module.exports = { strategyFor, isCacheable, notificationTarget, PRECACHE, STATIC_CACHE };
}
