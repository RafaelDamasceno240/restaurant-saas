'use client';

import { ReactNode } from 'react';
import { ArrowDownToLine, ArrowUpFromLine } from 'lucide-react';
import { Button } from '@/components/ds/Button';
import { Page, PageHeader } from '@/components/ds/PageHeader';
import { LoadingState } from '@/components/ds/States';
import { TabLinks } from '@/components/ds/TabLinks';
import { EstoqueProvider, useEstoque } from '@/components/estoque/EstoqueProvider';

const TABS = [
  { href: '/dashboard/estoque', label: 'Visão geral', exact: true },
  { href: '/dashboard/estoque/insumos', label: 'Insumos' },
  { href: '/dashboard/estoque/fichas', label: 'Ficha técnica' },
  { href: '/dashboard/estoque/movimentacoes', label: 'Movimentações' },
  { href: '/dashboard/estoque/compras', label: 'Compras' },
  { href: '/dashboard/estoque/inventario', label: 'Inventário' },
];

function EstoqueFrame({ children }: { children: ReactNode }) {
  const { branchId, canManage, openEntry, openExit } = useEstoque();
  const tabs = canManage ? TABS : TABS.filter((tab) => tab.href !== '/dashboard/estoque/compras');
  return (
    <Page wide>
      <PageHeader
        title="Controle de estoque"
        description="Gerencie insumos, custos, movimentações e rupturas."
        actions={
          canManage ? (
            <>
              <Button variant="outline" icon={<ArrowUpFromLine className="h-4 w-4" />} onClick={() => openExit()}>
                Nova saída
              </Button>
              <Button icon={<ArrowDownToLine className="h-4 w-4" />} onClick={() => openEntry()}>
                Nova entrada
              </Button>
            </>
          ) : undefined
        }
      />
      <TabLinks items={tabs} />
      {branchId ? children : <LoadingState label="Carregando unidade..." />}
    </Page>
  );
}

export default function EstoqueLayout({ children }: { children: ReactNode }) {
  return (
    <EstoqueProvider>
      <EstoqueFrame>{children}</EstoqueFrame>
    </EstoqueProvider>
  );
}
