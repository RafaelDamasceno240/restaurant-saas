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
