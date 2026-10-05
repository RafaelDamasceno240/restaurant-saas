// Parts of the site that never use a staff session: the landing page, the public menu and
// checkout, and the demo. The AuthProvider wraps the whole app, but there it stays idle, so an
// anonymous customer opening a menu does not fire a POST /auth/refresh that can only answer 401
// (noise in the logs, and it spends the per-address refresh rate limit a real user behind the
// same network depends on).
const PUBLIC_PREFIXES = ['/menu', '/demo'];

export function isPublicArea(pathname: string | null): boolean {
  if (!pathname) return false;
  if (pathname === '/') return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

// When restoring the session fails: a 401/403 is the API REFUSING the refresh cookie (not signed
// in, expired, revoked). Any other outcome (no answer at all, 5xx, 429) says nothing about the
// session, so the operator must not be sent to the login form for it.
export function isSessionRefusal(statusCode: number | null): boolean {
  return statusCode === 401 || statusCode === 403;
}
