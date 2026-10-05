'use client';

import { ReactNode, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ActiveBranchProvider } from '@/lib/use-active-branch';
import { ToastProvider } from '@/components/ds/Toast';
import { ErrorState, LoadingState } from '@/components/ds/States';
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
  const { user, isLoading, logout, sessionUnavailable, retrySession } = useAuth();

  // No user because the API REFUSED the session -> login. No user because the API could not be
  // reached -> stay here and say so: the operator is still signed in (see lib/auth-context.tsx).
  useEffect(() => {
    if (!isLoading && !user && !sessionUnavailable) {
      router.replace('/login');
    }
  }, [isLoading, user, sessionUnavailable, router]);

  // The moment the device reports a connection again, try without waiting for a tap.
  useEffect(() => {
    if (!sessionUnavailable) return;
    const retry = () => void retrySession();
    window.addEventListener('online', retry);
    return () => window.removeEventListener('online', retry);
  }, [sessionUnavailable, retrySession]);

  const groups = useMemo(() => filterNav(DASHBOARD_NAV, user?.roles ?? null), [user]);

  if (!isLoading && !user && sessionUnavailable) {
    return (
      <div className="theme-app flex min-h-screen items-center justify-center p-6">
        <ErrorState
          message="Não foi possível falar com o servidor. Confira a conexão deste aparelho; sua sessão continua aberta."
          onRetry={() => void retrySession()}
        />
      </div>
    );
  }

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
