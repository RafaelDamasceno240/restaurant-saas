import type { MetadataRoute } from 'next';

// Web app manifest, served by Next at /manifest.webmanifest and linked from every page.
// It describes the OPERATOR app (the dashboard): that is what gets installed on the tablet of
// the kitchen, the counter or the delivery desk. The public menu is a normal website.
export default function manifest(): MetadataRoute.Manifest {
  return {
    id: '/dashboard',
    name: 'Restaurant SaaS — Painel do restaurante',
    short_name: 'Restaurante',
    description: 'Pedidos, PDV, cozinha, mesas, delivery e caixa do restaurante.',
    lang: 'pt-BR',
    dir: 'ltr',
    start_url: '/dashboard',
    scope: '/',
    display: 'standalone',
    orientation: 'any',
    background_color: '#020001',
    theme_color: '#020001',
    categories: ['business', 'food', 'productivity'],
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
    // Long-press on the installed icon: straight to the screen each station lives on.
    shortcuts: [
      { name: 'PDV', short_name: 'PDV', url: '/dashboard/pdv', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Pedidos', short_name: 'Pedidos', url: '/dashboard/pedidos', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Cozinha', short_name: 'Cozinha', url: '/dashboard/cozinha', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
      { name: 'Delivery', short_name: 'Delivery', url: '/dashboard/delivery', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
    ],
  };
}
