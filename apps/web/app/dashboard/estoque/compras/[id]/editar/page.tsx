'use client';

import Link from 'next/link';
import { ArrowLeft, ShoppingBag } from 'lucide-react';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { useEstoque } from '@/components/estoque/EstoqueProvider';
import { PurchaseForm } from '@/components/compras/PurchaseForm';
import { usePurchase } from '@/components/compras/use-purchases';

export default function EditarCompraPage({ params }: { params: { id: string } }) {
  const { canManage } = useEstoque();
  const query = usePurchase(params.id);

  if (!canManage) {
    return <EmptyState icon={<ShoppingBag />} title="Sem acesso às compras" />;
  }
  if (query.isLoading) return <LoadingState label="Carregando compra..." />;
  if (query.isError || !query.data) {
    return <ErrorState message="Não foi possível carregar a compra." onRetry={() => void query.refetch()} />;
  }

  const purchase = query.data;

  return (
    <div className="space-y-4">
      <div>
        <Link
          href={`/dashboard/estoque/compras/${purchase.id}`}
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden />
          {purchase.purchaseNumber}
        </Link>
        <h2 className="mt-1 text-lg font-semibold text-foreground">Editar {purchase.purchaseNumber}</h2>
      </div>
      {purchase.status === 'DRAFT' ? (
        <PurchaseForm key={purchase.id} purchase={purchase} />
      ) : (
        <Alert tone="warning">Somente compras em rascunho podem ser editadas.</Alert>
      )}
    </div>
  );
}
