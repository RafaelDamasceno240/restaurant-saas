'use client';

import { ReactNode, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth-context';
import { ActiveBranchProvider } from '@/lib/use-active-branch';
import { ToastProvider } from '@/components/ds/Toast';
import { ErrorState, LoadingState } from '@/components/ds/States';
import { AppShell } from '@/components/shell/AppShell';
import { DashboardChips } from '@/components/shell/DashboardChips';
import { canSee, dashboardNav, routeAccess } from '@/components/shell/nav';
import { NoAccess } from '@/components/shell/NoAccess';
import { ChangeOwnPasswordDialog } from '@/components/users/PasswordDialogs';

const ROLE_LABEL: Record<string, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  MANAGER: 'Gerente',
  CASHIER: 'Caixa',
  WAITER: 'Garçom',
  KITCHEN: 'Cozinha',
  DELIVERY: 'Entregador',
  VIEWER: 'Somente leitura',
};

// One shared frame for every /dashboard/* screen. The real auth check lives
// here (middleware.ts only checks cookie presence); pages no longer repeat it.
export default function DashboardLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { user, isLoading, logout, sessionUnavailable, retrySession } = useAuth();
  const [changingPassword, setChangingPassword] = useState(false);

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

  const groups = useMemo(() => dashboardNav(user?.roles ?? null, user?.isPlatformAdmin === true), [user]);
  // B12: the screen opened by its address obeys the same roles as its menu entry.
  const screen = routeAccess(pathname);
  const allowed = !screen || canSee(screen, user?.roles ?? null);

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
          brandLogoUrl={user.tenant?.logoUrl}
          user={{
            name: user.name,
            email: user.email,
            roleLabel: user.roles.map((r) => ROLE_LABEL[r] ?? r).join(', '),
          }}
          onChangePassword={() => setChangingPassword(true)}
          onLogout={async () => {
            await logout();
            router.push('/login');
          }}
          topbarChips={<DashboardChips />}
        >
          {allowed ? children : <NoAccess screen={screen?.label ?? 'esta tela'} />}
        </AppShell>
        {/* The API ended every session of the account with the change: sign out here too. */}
        <ChangeOwnPasswordDialog
          open={changingPassword}
          onClose={() => setChangingPassword(false)}
          onChanged={async () => {
            setChangingPassword(false);
            await logout();
            router.push('/login');
          }}
        />
      </ActiveBranchProvider>
    </ToastProvider>
  );
}
