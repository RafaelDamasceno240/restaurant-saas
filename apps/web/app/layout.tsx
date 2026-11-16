import type { Metadata, Viewport } from 'next';
import { headers } from 'next/headers';
import { ServiceWorkerRegistration } from '@/components/pwa/ServiceWorkerRegistration';
import { Providers } from './providers';
import './globals.css';

// app/manifest.ts is linked automatically (<link rel="manifest">); app/favicon.ico too.
export const metadata: Metadata = {
  title: { default: 'Restaurant SaaS', template: '%s · Restaurant SaaS' },
  description: 'Gestão do restaurante: pedidos, PDV, cozinha, mesas, delivery, caixa e clientes.',
  applicationName: 'Restaurant SaaS',
  icons: {
    icon: [
      { url: '/icons/icon.svg', type: 'image/svg+xml' },
      { url: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
    ],
    apple: [{ url: '/icons/apple-touch-icon.png', sizes: '180x180', type: 'image/png' }],
  },
  // iOS: opens from the home screen in its own window, with an opaque status bar (the page
  // never draws under it, so no safe-area handling is needed).
  appleWebApp: { capable: true, title: 'Restaurante', statusBarStyle: 'black' },
  // Phone numbers on screen are data (customers, orders), not links to dial by accident.
  formatDetection: { telephone: false },
};

// Zoom stays enabled on purpose (accessibility); form fields use 16px text on touch devices so
// iOS does not zoom by itself when one is focused.
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#020001',
  colorScheme: 'dark',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // The Content-Security-Policy (middleware.ts) only runs scripts that carry this request's
  // nonce, and Next can only stamp it on HTML rendered for the request. Reading it here makes
  // every route dynamic; a statically prerendered page would ship scripts without a nonce and
  // the browser would refuse all of them.
  headers().get('x-nonce');

  return (
    <html lang="pt-BR">
      <head>
        {/* The operator app ships its own dark theme; stops "dark mode"
            browser extensions from re-tinting it a second time. */}
        <meta name="darkreader-lock" />
      </head>
      <body>
        <Providers>{children}</Providers>
        <ServiceWorkerRegistration />
      </body>
    </html>
  );
}
