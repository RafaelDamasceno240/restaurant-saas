/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['@restaurant-saas/ui', '@restaurant-saas/types'],
};

module.exports = nextConfig;
