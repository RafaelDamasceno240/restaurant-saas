import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Restaurant SaaS',
  description: 'Fase 01 — Fundação da plataforma',
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
      </body>
    </html>
  );
}
