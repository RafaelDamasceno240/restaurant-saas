// Server-only: where the API really lives (e.g. https://<api-host>/v1). It is read here, at build
// time, for the /api rewrite, and by lib/api-client.ts at runtime for Server Components. It is
// deliberately not a NEXT_PUBLIC_ variable: the browser never needs the API's address.
const apiUrl = (process.env.API_URL ?? 'http://localhost:4000/v1').replace(/\/+$/, '');

// On Vercel a missing API_URL would silently bake the localhost fallback into the rewrite.
if (process.env.VERCEL && !process.env.API_URL) {
  throw new Error('API_URL is required: set it to the public URL of the API, including /v1.');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  transpilePackages: ['@restaurant-saas/ui', '@restaurant-saas/types'],
  // The browser calls the API through this host (docs/authentication.md): the refresh_token
  // cookie then belongs to the frontend's domain, which is what lets middleware.ts read it and
  // keeps it first-party when the API is deployed on a different domain.
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${apiUrl}/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          // The dashboard acts on a session, so it must never render inside another site's frame.
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
        ],
      },
    ];
  },
};

module.exports = nextConfig;
