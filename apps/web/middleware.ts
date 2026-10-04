import { NextRequest, NextResponse } from 'next/server';

// Coarse, edge-runtime-safe guard: only checks whether a refresh_token
// cookie is present before letting the request through to /dashboard. It
// deliberately does NOT verify the token's signature/expiry — that requires
// calling the API, which happens client-side in AuthProvider on mount. This
// two-layer approach (fast edge check + real client-side check) avoids a
// network round trip in the Edge middleware for every navigation.
//
// This works because the browser only talks to this host: every API call
// goes through the same-origin /api rewrite (next.config.js), so the
// refresh_token cookie the API sets is stored for the frontend host and
// arrives here on every navigation — in production too, where the API runs
// on another domain. It also depends on the cookie's Path=/ (see apps/api
// .../auth.controller.ts): if the API ever narrows that Path, this check
// silently breaks (always sees no cookie -> always redirects to /login).
// See docs/authentication.md "Escopo do cookie de refresh".
export function middleware(request: NextRequest) {
  const hasSession = request.cookies.has('refresh_token');
  if (!hasSession) {
    const loginUrl = new URL('/login', request.url);
    return NextResponse.redirect(loginUrl);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/dashboard/:path*'],
};
