'use client';

import Link from 'next/link';
import { ArrowLeft, ShoppingBag } from 'lucide-react';
import { EmptyState } from '@/components/ds/States';
import { useEstoque } from '@/components/estoque/EstoqueProvider';
import { PurchaseForm } from '@/components/compras/PurchaseForm';

export default function NovaCompraPage() {
  const { canManage } = useEstoque();

  if (!canManage) {
    return <EmptyState icon={<ShoppingBag />} title="Sem acesso às compras" />;
  }

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/dashboard/estoque/compras"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          Compras
        </Link>
        <h2 className="mt-1 text-lg font-semibold text-foreground">Nova compra</h2>
        <p className="text-sm text-muted-foreground">Registre os itens comprados, com custo, lote e validade.</p>
      </div>
      <PurchaseForm />
    </div>
  );
}
