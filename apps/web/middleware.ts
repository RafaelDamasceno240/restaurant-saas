import { NextRequest, NextResponse } from 'next/server';
import { buildContentSecurityPolicy, createNonce } from './lib/csp';

// Two jobs, on every page request:
//
// 1. Content-Security-Policy with a fresh nonce (lib/csp.ts). The policy goes on the REQUEST
//    headers too: that is where Next reads the nonce it stamps on its own scripts. A page has
//    to be rendered per request for that (app/layout.tsx reads the nonce, which opts every
//    route out of static prerendering).
//
// 2. Coarse, edge-runtime-safe guard for /dashboard and /super-admin: only checks whether a refresh_token
//    cookie is present. It deliberately does NOT verify the token's signature/expiry — that
//    requires calling the API, which happens client-side in AuthProvider on mount. This
//    two-layer approach (fast edge check + real client-side check) avoids a network round
//    trip in the Edge middleware for every navigation.
//
//    This works because the browser only talks to this host: every API call goes through the
//    same-origin /api rewrite (next.config.js), so the refresh_token cookie the API sets is
//    stored for the frontend host and arrives here on every navigation — in production too,
//    where the API runs on another domain. It also depends on the cookie's Path=/ (see
//    apps/api .../auth.controller.ts): if the API ever narrows that Path, this check silently
//    breaks (always sees no cookie -> always redirects to /login).
//    See docs/authentication.md "Escopo do cookie de refresh".
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isSignedInArea = ['/dashboard', '/super-admin'].some(
    (area) => pathname === area || pathname.startsWith(`${area}/`),
  );
  if (isSignedInArea && !request.cookies.has('refresh_token')) {
    return NextResponse.redirect(new URL('/login', request.url));
  }

  const nonce = createNonce();
  const policy = buildContentSecurityPolicy({ nonce, isDev: process.env.NODE_ENV !== 'production' });

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', policy);
  return response;
}

export const config = {
  matcher: [
    // Pages only. /api is the rewrite to the API (it answers with its own headers), and the
    // build's static files are not documents.
    '/((?!api/|_next/static|_next/image|favicon.ico|manifest.webmanifest|sw.js|icons/).*)',
  ],
};
