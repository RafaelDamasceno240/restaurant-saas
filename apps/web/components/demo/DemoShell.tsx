'use client';

import { ReactNode } from 'react';
import { Bell, Clock, FlaskConical, Timer, Wallet } from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Chip } from '@/components/shell/Chip';
import { DEMO_NAV } from '@/components/shell/nav';

// /demo uses the very same AppShell as /dashboard — only the nav, the chips
// and the user block differ, and every value here is fictitious (no API).
function DemoChips() {
  return (
    <>
      <Chip dot tone="warning" icon={<FlaskConical />} label="Modo demonstração" />
      <Chip dot tone="success" icon={<Wallet />} label="Caixa aberto" title="Fictício" />
      <Chip tone="info" icon={<Clock />} label="40min" title="Tempo médio de entrega (fictício)" />
      <Chip icon={<Timer />} label="15min" title="Tempo médio de preparo (fictício)" />
      <Chip tone="warning" icon={<Bell />} label="2 novos" title="Fictício" />
    </>
  );
}

export function DemoShell({ children }: { children: ReactNode }) {
  return (
    <AppShell
      groups={DEMO_NAV}
      brandHref="/demo"
      brandName="Restaurant SaaS"
      brandSubtitle="Modo demonstração"
      user={{ name: 'Visitante', email: 'demo@restaurant-saas.app' }}
      topbarChips={<DemoChips />}
      banner={
        <p className="shrink-0 border-b border-warning/20 bg-warning/10 px-4 py-1.5 text-center text-2xs text-warning">
          Todos os dados exibidos em /demo são fictícios, gerados para fins de apresentação e não são gravados no banco
          de dados.
        </p>
      }
    >
      {children}
    </AppShell>
  );
}
