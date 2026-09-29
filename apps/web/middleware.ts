import { NextRequest, NextResponse } from 'next/server';

// Coarse, edge-runtime-safe guard: only checks whether a refresh_token
// cookie is present before letting the request through to /dashboard. It
// deliberately does NOT verify the token's signature/expiry — that requires
// calling the API, which happens client-side in AuthProvider on mount. This
// two-layer approach (fast edge check + real client-side check) avoids a
// network round trip in the Edge middleware for every navigation.
//
// This ONLY works because the API sets the refresh_token cookie with
// Path=/ (see apps/api .../auth.controller.ts). The API (a different
// port/origin in dev) and this Next.js server are different hosts as far
// as the browser's cookie jar is concerned; the cookie becomes visible
// here purely through host-only + Path='/' matching. If the API ever
// narrows that cookie's Path again, this check silently breaks (always
// sees no cookie -> always redirects to /login). See
// docs/authentication.md "Escopo do cookie de refresh".
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
