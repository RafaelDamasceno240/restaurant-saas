'use client';

import { ReactNode, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ActiveBranchProvider } from '@/lib/use-active-branch';
import { ToastProvider } from '@/components/ds/Toast';
import { LoadingState } from '@/components/ds/States';
import { AppShell } from '@/components/shell/AppShell';
import { DashboardChips } from '@/components/shell/DashboardChips';
import { DASHBOARD_NAV, filterNav } from '@/components/shell/nav';

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  MANAGER: 'Gerente',
  CASHIER: 'Caixa',
  WAITER: 'Garçom',
  KITCHEN: 'Cozinha',
};

// One shared frame for every /dashboard/* screen. The real auth check lives
// here (middleware.ts only checks cookie presence); pages no longer repeat it.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, isLoading, logout } = useAuth();

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace('/login');
    }
  }, [isLoading, user, router]);

  const groups = useMemo(() => filterNav(DASHBOARD_NAV, user?.roles ?? null), [user]);

  if (isLoading || !user) {
    return (
      <div className="theme-app flex min-h-screen items-center justify-center">
        <LoadingState label="Carregando..." />
      </div>
    );
  }

  return (
    <ToastProvider>
      <ActiveBranchProvider>
        <AppShell
          groups={groups}
          brandHref="/dashboard"
          brandName={user.tenant?.name ?? 'Restaurant SaaS'}
          brandSubtitle="Painel de gestão"
          user={{
            name: user.name,
            email: user.email,
            roleLabel: user.roles.map((r) => ROLE_LABEL[r] ?? r).join(', '),
          }}
          onLogout={async () => {
            await logout();
            router.push('/login');
          }}
          topbarChips={<DashboardChips />}
        >
          {children}
        </AppShell>
      </ActiveBranchProvider>
    </ToastProvider>
  );
}
