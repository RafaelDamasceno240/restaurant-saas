// Content-Security-Policy for every page, built per request by middleware.ts.
//
// Scripts: only the ones Next itself emits, identified by a per-request nonce ('strict-dynamic'
// lets those load the chunks they need). No 'unsafe-inline': a script injected into the page
// (stored XSS in a product name, an observation, a customer field...) has no nonce and does not
// run. This is what keeps the in-memory access token out of reach of injected code.
// Styles keep 'unsafe-inline' on purpose: React writes `style` attributes all over the app and a
// nonce cannot cover attributes; injected CSS cannot read the token.
// Images: restaurants paste image URLs from anywhere, so any https origin (never a script).
// connect-src 'self': the browser only ever calls this host (/api is rewritten to the API), so
// even injected code could not ship data to another origin with fetch/XHR/WebSocket.
export interface CspOptions {
  nonce: string;
  // `next dev` evaluates code for Fast Refresh and talks to its dev server over a WebSocket.
  isDev: boolean;
}

export function buildContentSecurityPolicy({ nonce, isDev }: CspOptions): string {
  const directives: Record<string, string[]> = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'nonce-${nonce}'`, "'strict-dynamic'", ...(isDev ? ["'unsafe-eval'"] : [])],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:', ...(isDev ? ['http:'] : [])],
    'font-src': ["'self'", 'data:'],
    'connect-src': ["'self'", ...(isDev ? ['ws:', 'wss:'] : [])],
    'media-src': ["'self'", 'data:', 'blob:'],
    'worker-src': ["'self'"],
    'manifest-src': ["'self'"],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  return Object.entries(directives)
    .map(([name, values]) => `${name} ${values.join(' ')}`)
    .join('; ');
}

// 128 random bits, base64: unguessable and new on every request.
export function createNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
