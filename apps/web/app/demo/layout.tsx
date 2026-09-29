import type { Metadata } from 'next';
import { DemoShell } from '@/components/demo/DemoShell';

// Not covered by middleware.ts (matcher is only '/dashboard/:path*'), so
// this whole subtree renders with no auth check and no dependency on the
// refresh_token cookie — exactly what "funciona sem depender de
// PostgreSQL/Redis" requires, since nothing here calls the API either.
export const metadata: Metadata = {
  title: 'Restaurant SaaS — Demonstração',
  description: 'Modo apresentação com dados fictícios, sem dependência de banco de dados.',
};

export default function DemoLayout({ children }: { children: React.ReactNode }) {
  return <DemoShell>{children}</DemoShell>;
}
