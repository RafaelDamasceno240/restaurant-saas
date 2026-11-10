'use client';

import { ReactNode, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ShieldAlert } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ToastProvider } from '@/components/ds/Toast';
import { Button } from '@/components/ds/Button';
import { ErrorState, EmptyState, LoadingState } from '@/components/ds/States';
import { AppShell } from '@/components/shell/AppShell';
import { SUPER_ADMIN_NAV } from '@/components/shell/nav';

// /super-admin: the administration of the PLATFORM, a frame of its own (not the restaurant's
// menu). Who gets in is decided by the API (PlatformAdminGuard on /v1/platform); here a signed-in
// account that is not a platform administrator sees "Acesso negado" and the pages below never
// mount, so not one /platform request is made for it.
export default function SuperAdminLayout({ children }: { children: ReactNode }) {
  const router = useRouter();
  const { user, isLoading, logout, sessionUnavailable, retrySession } = useAuth();

  useEffect(() => {
    if (!isLoading && !user && !sessionUnavailable) router.replace('/login');
  }, [isLoading, user, sessionUnavailable, router]);

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

  if (!user.isPlatformAdmin) {
    return (
      <div className="theme-app flex min-h-screen items-center justify-center p-6">
        <EmptyState
          icon={<ShieldAlert />}
          title="Acesso negado"
          description="Esta área é exclusiva da administração da plataforma. A sua conta não tem esse acesso."
          action={
            <Link href="/dashboard">
              <Button variant="outline">Voltar para o painel</Button>
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <ToastProvider>
      <AppShell
        groups={SUPER_ADMIN_NAV}
        brandHref="/super-admin"
        brandName="Administração da Plataforma"
        brandSubtitle="Restaurant SaaS"
        user={{ name: user.name, email: user.email, roleLabel: 'Administrador da plataforma' }}
        onLogout={async () => {
          await logout();
          router.push('/login');
        }}
        banner={
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-accent/30 bg-accent/10 px-4 py-2 text-xs text-foreground sm:px-6">
            <span>
              <strong>Administração da Plataforma</strong>: você está vendo todos os restaurantes, não um
              restaurante.
            </span>
            <Link href="/dashboard" className="font-medium text-accent underline-offset-2 hover:underline">
              Ir para o painel do meu restaurante
            </Link>
          </div>
        }
      >
        {children}
      </AppShell>
    </ToastProvider>
  );
}
