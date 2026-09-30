'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, PackageCheck, Pencil, ShoppingBag, XCircle } from 'lucide-react';
import { formatCents } from '@/lib/cash-api';
import { formatDate, formatQuantity } from '@/lib/inventory-api';
import { PURCHASE_EVENT_LABEL, PurchaseDetail } from '@/lib/purchases-api';
import { Button } from '@/components/ds/Button';
import { Card, CardHeader } from '@/components/ds/Card';
import { EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { useEstoque } from '@/components/estoque/EstoqueProvider';
import { CancelDialog, PurchaseRef, PurchaseStatusBadge, ReceiveDialog } from '@/components/compras/purchase-parts';
import { usePurchase } from '@/components/compras/use-purchases';

function refOf(purchase: PurchaseDetail): PurchaseRef {
  return {
    id: purchase.id,
    purchaseNumber: purchase.purchaseNumber,
    status: purchase.status,
    supplierName: purchase.supplier.name,
    branchName: purchase.branch.name,
    itemCount: purchase.items.length,
    totalCents: purchase.totalCents,
  };
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs font-medium uppercase tracking-wide text-subtle">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-foreground">{value}</dd>
    </div>
  );
}

export default function CompraDetalhePage({ params }: { params: { id: string } }) {
  const { canManage } = useEstoque();
  const query = usePurchase(params.id);
  const [receiving, setReceiving] = useState<PurchaseRef | null>(null);
  const [cancelling, setCancelling] = useState<PurchaseRef | null>(null);

  if (!canManage) {
    return <EmptyState icon={<ShoppingBag />} title="Sem acesso às compras" />;
  }
  if (query.isLoading) return <LoadingState label="Carregando compra..." />;
  if (query.isError || !query.data) {
    return <ErrorState message="Não foi possível carregar a compra." onRetry={() => void query.refetch()} />;
  }

  const purchase = query.data;
  const refresh = () => void query.refetch();

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/dashboard/estoque/compras"
            className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            Compras
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold text-foreground">{purchase.purchaseNumber}</h2>
            <PurchaseStatusBadge status={purchase.status} />
          </div>
          <p className="text-sm text-muted-foreground">
            {purchase.supplier.name} · {purchase.branch.name}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {purchase.status === 'DRAFT' && (
            <>
              <Link href={`/dashboard/estoque/compras/${purchase.id}/editar`}>
                <Button variant="outline" icon={<Pencil className="h-4 w-4" aria-hidden />}>
                  Editar
                </Button>
              </Link>
              <Button icon={<PackageCheck className="h-4 w-4" aria-hidden />} onClick={() => setReceiving(refOf(purchase))}>
                Receber
              </Button>
            </>
          )}
          {purchase.status !== 'CANCELLED' && (
            <Button variant="danger-ghost" icon={<XCircle className="h-4 w-4" aria-hidden />} onClick={() => setCancelling(refOf(purchase))}>
              Cancelar compra
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Informações" />
          <dl className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
            <Info label="Fornecedor" value={purchase.supplier.name} />
            <Info label="Unidade" value={purchase.branch.name} />
            <Info label="Data da compra" value={formatDate(purchase.purchaseDate)} />
            <Info label="Criada por" value={`${purchase.createdBy.name} em ${formatDateTime(purchase.createdAt)}`} />
            {purchase.receivedAt && purchase.receivedBy && (
              <Info label="Recebida por" value={`${purchase.receivedBy.name} em ${formatDateTime(purchase.receivedAt)}`} />
            )}
            {purchase.cancelledAt && purchase.cancelledBy && (
              <Info label="Cancelada por" value={`${purchase.cancelledBy.name} em ${formatDateTime(purchase.cancelledAt)}`} />
            )}
            {purchase.cancelReason && <Info label="Motivo do cancelamento" value={purchase.cancelReason} />}
            {purchase.notes && <Info label="Observações" value={purchase.notes} />}
          </dl>
        </Card>

        <Card>
          <CardHeader title="Totais" />
          <div className="space-y-2 p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="tabular-nums">{formatCents(purchase.subtotalCents)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Desconto</span>
              <span className="tabular-nums">− {formatCents(purchase.discountCents)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Frete</span>
              <span className="tabular-nums">{formatCents(purchase.freightCents)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Outros custos</span>
              <span className="tabular-nums">{formatCents(purchase.otherCostsCents)}</span>
            </div>
            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <span className="font-semibold text-foreground">Total</span>
              <span className="text-xl font-semibold tabular-nums text-accent">{formatCents(purchase.totalCents)}</span>
            </div>
          </div>
        </Card>
      </div>

      <Card className="overflow-hidden">
        <CardHeader title="Itens" description={`${purchase.items.length} item(ns)`} />
        <TableWrap>
          <Table className="min-w-[760px]">
            <THead>
              <Tr className="hover:bg-transparent">
                <Th>Insumo</Th>
                <Th className="text-right">Quantidade</Th>
                <Th className="text-right">Custo unitário</Th>
                <Th>Lote</Th>
                <Th>Validade</Th>
                <Th className="text-right">Total</Th>
              </Tr>
            </THead>
            <TBody>
              {purchase.items.map((item) => (
                <Tr key={item.id}>
                  <Td className="font-medium">{item.inventoryItem.name}</Td>
                  <Td className="text-right tabular-nums">{formatQuantity(item.quantity, item.inventoryItem.unit)}</Td>
                  <Td className="text-right tabular-nums">{formatCents(item.unitCostCents)}</Td>
                  <Td className="text-muted-foreground">{item.lotCode ?? '—'}</Td>
                  <Td className="tabular-nums text-muted-foreground">{item.expiresAt ? formatDate(item.expiresAt) : '—'}</Td>
                  <Td className="text-right font-medium tabular-nums">{formatCents(item.totalCostCents)}</Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </Card>

      <Card>
        <CardHeader title="Histórico" />
        <ol className="space-y-3 p-4">
          {purchase.events.map((event) => (
            <li key={event.id} className="flex gap-3">
              <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" aria-hidden />
              <div className="min-w-0">
                <p className="text-sm text-foreground">{PURCHASE_EVENT_LABEL[event.action] ?? event.action}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(event.createdAt)}
                  {event.user ? ` · ${event.user.name}` : ''}
                  {event.reason ? ` · ${event.reason}` : ''}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Card>

      <ReceiveDialog purchase={receiving} onClose={() => setReceiving(null)} onDone={refresh} />
      <CancelDialog purchase={cancelling} onClose={() => setCancelling(null)} onDone={refresh} />
    </div>
  );
}
