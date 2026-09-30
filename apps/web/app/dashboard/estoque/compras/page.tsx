'use client';

import { useDeferredValue, useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Clock, Eye, Pencil, PackageCheck, Plus, ShoppingBag, Users, Wallet, XCircle } from 'lucide-react';
import { formatCents } from '@/lib/cash-api';
import { formatDate } from '@/lib/inventory-api';
import { PURCHASE_STATUS_LABEL, PurchaseListItem, PurchaseStatus } from '@/lib/purchases-api';
import { monthRange } from '@/lib/purchases-logic';
import { Button } from '@/components/ds/Button';
import { Card } from '@/components/ds/Card';
import { Field, Input, SearchInput, Select } from '@/components/ds/Input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { StatCard } from '@/components/ds/StatCard';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { useEstoque } from '@/components/estoque/EstoqueProvider';
import { CancelDialog, PurchaseRef, PurchaseStatusBadge, ReceiveDialog } from '@/components/compras/purchase-parts';
import { SuppliersDialog } from '@/components/compras/SuppliersDialog';
import { usePurchases, useSuppliers } from '@/components/compras/use-purchases';

const STATUSES: PurchaseStatus[] = ['DRAFT', 'RECEIVED', 'CANCELLED'];

function refOf(purchase: PurchaseListItem): PurchaseRef {
  return {
    id: purchase.id,
    purchaseNumber: purchase.purchaseNumber,
    status: purchase.status,
    supplierName: purchase.supplier.name,
    branchName: purchase.branch.name,
    itemCount: purchase.itemCount,
    totalCents: purchase.totalCents,
  };
}

export default function ComprasPage() {
  const { branchId, canManage } = useEstoque();
  const suppliers = useSuppliers(true);
  const initialRange = monthRange();
  const [dateFrom, setDateFrom] = useState(initialRange.from);
  const [dateTo, setDateTo] = useState(initialRange.to);
  const [status, setStatus] = useState<PurchaseStatus | ''>('');
  const [supplierId, setSupplierId] = useState('');
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [receiving, setReceiving] = useState<PurchaseRef | null>(null);
  const [cancelling, setCancelling] = useState<PurchaseRef | null>(null);
  const [suppliersOpen, setSuppliersOpen] = useState(false);
  const search = useDeferredValue(searchText.trim());

  useEffect(() => setPage(1), [dateFrom, dateTo, status, supplierId, search, branchId]);

  const query = usePurchases(branchId, {
    dateFrom: dateFrom || undefined,
    dateTo: dateTo || undefined,
    status: status || undefined,
    supplierId: supplierId || undefined,
    search: search || undefined,
    page,
  });

  if (!canManage) {
    return (
      <EmptyState
        icon={<ShoppingBag />}
        title="Sem acesso às compras"
        description="Somente proprietários, administradores e gerentes registram e recebem compras."
      />
    );
  }

  const data = query.data;
  const summary = data?.summary;
  const totalPurchases = summary ? STATUSES.reduce((sum, key) => sum + summary[key].count, 0) : 0;
  const hasFilters = status !== '' || supplierId !== '' || search !== '';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Compras</h2>
          <p className="text-sm text-muted-foreground">Entrada e gestão de compras de estoque.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" icon={<Users className="h-4 w-4" aria-hidden />} onClick={() => setSuppliersOpen(true)}>
            Fornecedores
          </Button>
          <Link href="/dashboard/estoque/compras/nova">
            <Button icon={<Plus className="h-4 w-4" aria-hidden />}>Nova compra</Button>
          </Link>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Compras no período" value={totalPurchases} icon={<ShoppingBag />} hint="Todas as situações" loading={!summary} />
        <StatCard
          label="Valor comprado"
          value={summary ? formatCents(summary.RECEIVED.totalCents) : '—'}
          icon={<Wallet />}
          tone="success"
          hint="Compras recebidas"
          featured
          loading={!summary}
        />
        <StatCard
          label="Compras pendentes"
          value={summary?.DRAFT.count ?? 0}
          icon={<Clock />}
          tone="warning"
          hint={summary ? `${formatCents(summary.DRAFT.totalCents)} em rascunho` : undefined}
          loading={!summary}
        />
        <StatCard
          label="Compras recebidas"
          value={summary?.RECEIVED.count ?? 0}
          icon={<CheckCircle2 />}
          tone="success"
          hint={summary && summary.CANCELLED.count > 0 ? `${summary.CANCELLED.count} cancelada(s)` : undefined}
          loading={!summary}
        />
      </div>

      <Card className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-6">
        <div className="sm:col-span-2">
          <SearchInput
            placeholder="Buscar número ou fornecedor..."
            aria-label="Buscar compras"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
          />
        </div>
        <Field label="De" className="[&>span]:sr-only">
          <Input type="date" aria-label="Data inicial" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
        </Field>
        <Field label="Até" className="[&>span]:sr-only">
          <Input type="date" aria-label="Data final" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </Field>
        <Select aria-label="Situação" value={status} onChange={(e) => setStatus(e.target.value as PurchaseStatus | '')}>
          <option value="">Todas as situações</option>
          {STATUSES.map((key) => (
            <option key={key} value={key}>
              {PURCHASE_STATUS_LABEL[key]}
            </option>
          ))}
        </Select>
        <Select aria-label="Fornecedor" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
          <option value="">Todos os fornecedores</option>
          {(suppliers.data ?? []).map((supplier) => (
            <option key={supplier.id} value={supplier.id}>
              {supplier.name}
              {supplier.active ? '' : ' (inativo)'}
            </option>
          ))}
        </Select>
      </Card>

      {query.isLoading ? (
        <LoadingState label="Carregando compras..." />
      ) : query.isError ? (
        <ErrorState message="Não foi possível carregar as compras." onRetry={() => void query.refetch()} />
      ) : (data?.data ?? []).length === 0 ? (
        <EmptyState
          icon={<ShoppingBag />}
          title={hasFilters ? 'Nenhuma compra encontrada' : 'Nenhuma compra no período'}
          description={
            hasFilters
              ? 'Ajuste os filtros para ver outras compras.'
              : 'Registre uma compra para dar entrada nos insumos, com custo, lote e validade.'
          }
          action={
            <Link href="/dashboard/estoque/compras/nova">
              <Button icon={<Plus className="h-4 w-4" aria-hidden />}>Nova compra</Button>
            </Link>
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <TableWrap>
            <Table className="min-w-[860px]">
              <THead>
                <Tr className="hover:bg-transparent">
                  <Th>Número</Th>
                  <Th>Data</Th>
                  <Th>Fornecedor</Th>
                  <Th>Unidade</Th>
                  <Th className="text-right">Itens</Th>
                  <Th className="text-right">Valor</Th>
                  <Th>Situação</Th>
                  <Th className="text-right">Ações</Th>
                </Tr>
              </THead>
              <TBody>
                {(data?.data ?? []).map((purchase) => (
                  <Tr key={purchase.id}>
                    <Td className="font-medium">
                      <Link href={`/dashboard/estoque/compras/${purchase.id}`} className="text-foreground hover:text-accent">
                        {purchase.purchaseNumber}
                      </Link>
                    </Td>
                    <Td className="tabular-nums text-muted-foreground">{formatDate(purchase.purchaseDate)}</Td>
                    <Td>{purchase.supplier.name}</Td>
                    <Td className="text-muted-foreground">{purchase.branch.name}</Td>
                    <Td className="text-right tabular-nums">{purchase.itemCount}</Td>
                    <Td className="text-right font-medium tabular-nums">{formatCents(purchase.totalCents)}</Td>
                    <Td>
                      <PurchaseStatusBadge status={purchase.status} />
                    </Td>
                    <Td>
                      <div className="flex justify-end gap-1">
                        <Link href={`/dashboard/estoque/compras/${purchase.id}`} aria-label={`Visualizar ${purchase.purchaseNumber}`}>
                          <Button variant="ghost" size="icon-sm" icon={<Eye className="h-4 w-4" aria-hidden />} tabIndex={-1} />
                        </Link>
                        {purchase.status === 'DRAFT' && (
                          <>
                            <Link href={`/dashboard/estoque/compras/${purchase.id}/editar`} aria-label={`Editar ${purchase.purchaseNumber}`}>
                              <Button variant="ghost" size="icon-sm" icon={<Pencil className="h-4 w-4" aria-hidden />} tabIndex={-1} />
                            </Link>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Receber ${purchase.purchaseNumber}`}
                              onClick={() => setReceiving(refOf(purchase))}
                              icon={<PackageCheck className="h-4 w-4" aria-hidden />}
                            />
                          </>
                        )}
                        {purchase.status !== 'CANCELLED' && (
                          <Button
                            variant="danger-ghost"
                            size="icon-sm"
                            aria-label={`Cancelar ${purchase.purchaseNumber}`}
                            onClick={() => setCancelling(refOf(purchase))}
                            icon={<XCircle className="h-4 w-4" aria-hidden />}
                          />
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          {data && data.meta.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-muted-foreground">
              <span>
                Página {data.meta.page} de {data.meta.totalPages} · {data.meta.total} compras
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
                  Anterior
                </Button>
                <Button size="sm" variant="outline" disabled={page >= data.meta.totalPages} onClick={() => setPage((current) => current + 1)}>
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <ReceiveDialog purchase={receiving} onClose={() => setReceiving(null)} onDone={() => void query.refetch()} />
      <CancelDialog purchase={cancelling} onClose={() => setCancelling(null)} onDone={() => void query.refetch()} />
      <SuppliersDialog open={suppliersOpen} onClose={() => setSuppliersOpen(false)} />
    </div>
  );
}
