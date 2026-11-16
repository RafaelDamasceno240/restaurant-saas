'use client';

import Link from 'next/link';
import { Lock } from 'lucide-react';
import { Button } from '@/components/ds/Button';
import { Page } from '@/components/ds/PageHeader';
import { EmptyState } from '@/components/ds/States';

// B12 (piloto 2026-10-23): the one "Sem acesso" every dashboard screen shows to a role that cannot
// use it, whether it was reached by the menu (hidden anyway) or typed in the address bar. Shown
// before the screen mounts, so it never fires the requests the API would answer with 403.
export function NoAccess({ screen }: { screen: string }) {
  return (
    <Page>
      <EmptyState
        icon={<Lock />}
        title={`Sem acesso a ${screen}`}
        description="O seu perfil não tem permissão para esta tela. Se precisar dela, fale com o responsável pelo restaurante."
        action={
          <Link href="/dashboard">
            <Button variant="outline">Voltar para a visão geral</Button>
          </Link>
        }
      />
    </Page>
  );
}
