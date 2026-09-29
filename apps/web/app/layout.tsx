import type { Metadata } from 'next';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Restaurant SaaS',
  description: 'Fase 01 — Fundação da plataforma',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
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
