'use client';

import { Suspense, useDeferredValue, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ClipboardList, X } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@/lib/auth-context';
import { formatCents } from '@/lib/cash-api';
import {
  EXIT_REASON_LABEL,
  formatDate,
  formatQuantity,
  formatSignedQuantity,
  inventoryApi,
  MOVEMENT_TYPE_LABEL,
  ORIGIN_LABEL,
  StockMovement,
  StockMovementOrigin,
  StockMovementType,
  UNIT_LABEL,
} from '@/lib/inventory-api';
import { Button } from '@/components/ds/Button';
import { Card } from '@/components/ds/Card';
import { Input, SearchInput, Select } from '@/components/ds/Input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { MovementTypeBadge, OriginLabel } from '@/components/estoque/badges';
import { useEstoque } from '@/components/estoque/EstoqueProvider';
import { INVENTORY_QUERY_ROOT, useInventoryItems } from '@/components/estoque/use-inventory';

const TYPES = Object.keys(MOVEMENT_TYPE_LABEL) as StockMovementType[];
const ORIGINS = Object.keys(ORIGIN_LABEL) as StockMovementOrigin[];

interface Filters {
  search: string;
  type: StockMovementType | '';
  origin: StockMovementOrigin | '';
  inventoryItemId: string;
  createdByUserId: string;
  from: string;
  to: string;
}

const EMPTY_FILTERS: Filters = {
  search: '',
  type: '',
  origin: '',
  inventoryItemId: '',
  createdByUserId: '',
  from: '',
  to: '',
};

export default function MovimentacoesPage() {
  return (
    <Suspense fallback={<LoadingState label="Carregando movimentações..." />}>
      <MovementsView />
    </Suspense>
  );
}

function MovementsView() {
  const { accessToken } = useAuth();
  const { branchId } = useEstoque();
  const params = useSearchParams();
  const itemsQuery = useInventoryItems(branchId);
  const [filters, setFilters] = useState<Filters>(() => ({
    ...EMPTY_FILTERS,
    inventoryItemId: params.get('item') ?? '',
    origin: (params.get('origin') as StockMovementOrigin | null) ?? '',
  }));
  const [page, setPage] = useState(1);
  const search = useDeferredValue(filters.search.trim());

  useEffect(() => setPage(1), [filters]);

  const query = useQuery({
    queryKey: [INVENTORY_QUERY_ROOT, 'movements', branchId, { ...filters, search }, page],
    queryFn: () =>
      inventoryApi.listMovements(accessToken as string, branchId as string, {
        search: search || undefined,
        type: filters.type || undefined,
        origin: filters.origin || undefined,
        inventoryItemId: filters.inventoryItemId || undefined,
        createdByUserId: filters.createdByUserId || undefined,
        from: filters.from || undefined,
        to: filters.to || undefined,
        page,
      }),
    enabled: !!accessToken && !!branchId,
    placeholderData: (previous) => previous,
  });

  const data = query.data;
  const hasFilters = Object.entries(filters).some(([, value]) => value !== '');
  const set = <K extends keyof Filters>(key: K, value: Filters[K]) => setFilters((current) => ({ ...current, [key]: value }));

  return (
    <div className="space-y-3">
      <Card className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
        <div className="sm:col-span-2 lg:col-span-4 xl:col-span-2">
          <SearchInput
            placeholder="Buscar insumo, fornecedor, documento, lote..."
            aria-label="Buscar movimentações"
            value={filters.search}
            onChange={(e) => set('search', e.target.value)}
          />
        </div>
        <Select aria-label="Tipo" value={filters.type} onChange={(e) => set('type', e.target.value as Filters['type'])}>
          <option value="">Todos os tipos</option>
          {TYPES.map((type) => (
            <option key={type} value={type}>
              {MOVEMENT_TYPE_LABEL[type]}
            </option>
          ))}
        </Select>
        <Select aria-label="Origem" value={filters.origin} onChange={(e) => set('origin', e.target.value as Filters['origin'])}>
          <option value="">Todas as origens</option>
          {ORIGINS.map((origin) => (
            <option key={origin} value={origin}>
              {ORIGIN_LABEL[origin]}
            </option>
          ))}
        </Select>
        <Select aria-label="Insumo" value={filters.inventoryItemId} onChange={(e) => set('inventoryItemId', e.target.value)}>
          <option value="">Todos os insumos</option>
          {(itemsQuery.data ?? []).map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Usuário" value={filters.createdByUserId} onChange={(e) => set('createdByUserId', e.target.value)}>
          <option value="">Todos os usuários</option>
          {(data?.filters.users ?? []).map((user) => (
            <option key={user.id} value={user.id}>
              {user.name}
            </option>
          ))}
        </Select>
        <div className="flex items-center gap-2 sm:col-span-2 lg:col-span-4 xl:col-span-7">
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            De
            <Input type="date" className="w-40" value={filters.from} onChange={(e) => set('from', e.target.value)} />
          </label>
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            Até
            <Input type="date" className="w-40" value={filters.to} onChange={(e) => set('to', e.target.value)} />
          </label>
          {hasFilters && (
            <Button variant="ghost" size="sm" icon={<X className="h-3.5 w-3.5" />} onClick={() => setFilters(EMPTY_FILTERS)}>
              Limpar filtros
            </Button>
          )}
          {data && <p className="ml-auto text-xs text-muted-foreground">{data.meta.total} movimentação(ões)</p>}
        </div>
      </Card>

      {query.isLoading ? (
        <LoadingState label="Carregando movimentações..." />
      ) : query.isError ? (
        <ErrorState message="Não foi possível carregar as movimentações." onRetry={() => query.refetch()} />
      ) : !data || data.data.length === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title={hasFilters ? 'Nenhuma movimentação encontrada' : 'Nenhuma movimentação ainda'}
          description={
            hasFilters ? 'Ajuste os filtros.' : 'Entradas, saídas, inventários e baixas por venda aparecem aqui.'
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <Th>Data</Th>
                  <Th>Insumo</Th>
                  <Th>Tipo</Th>
                  <Th className="text-right">Quantidade</Th>
                  <Th className="text-right">Custo</Th>
                  <Th>Origem</Th>
                  <Th>Usuário</Th>
                  <Th>Motivo / detalhe</Th>
                  <Th>Referência</Th>
                </tr>
              </THead>
              <TBody>
                {data.data.map((movement) => (
                  <MovementRow key={movement.id} movement={movement} />
                ))}
              </TBody>
            </Table>
          </TableWrap>
          {data.meta.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-muted-foreground">
              <span>
                Página {data.meta.page} de {data.meta.totalPages}
              </span>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Anterior
                </Button>
                <Button variant="outline" size="sm" disabled={page >= data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function MovementRow({ movement }: { movement: StockMovement }) {
  const unit = movement.inventoryItem.unit;
  return (
    <Tr>
      <Td className="whitespace-nowrap text-muted-foreground">
        {new Date(movement.createdAt).toLocaleString('pt-BR', {
          day: '2-digit',
          month: '2-digit',
          year: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </Td>
      <Td className="font-medium text-foreground">{movement.inventoryItem.name}</Td>
      <Td>
        <MovementTypeBadge type={movement.type} />
      </Td>
      <Td className={clsx('whitespace-nowrap text-right font-semibold', movement.quantity < 0 ? 'text-danger' : 'text-success')}>
        {formatSignedQuantity(movement.quantity, unit)}
        <span className="block text-2xs font-normal text-subtle">saldo {formatQuantity(movement.balanceAfter, unit)}</span>
      </Td>
      <Td className="whitespace-nowrap text-right text-muted-foreground">
        {movement.totalCostCents === null ? '—' : formatCents(movement.totalCostCents)}
        {movement.unitCostCents !== null && (
          <span className="block text-2xs text-subtle">
            {formatCents(movement.unitCostCents)}/{UNIT_LABEL[unit]}
          </span>
        )}
      </Td>
      <Td>
        <OriginLabel origin={movement.origin} />
      </Td>
      <Td className="text-muted-foreground">{movement.createdBy?.name ?? 'Sistema'}</Td>
      <Td className="max-w-[16rem] text-muted-foreground">
        <span className="block truncate">{describeMovement(movement)}</span>
        {movement.notes && movement.exitReason && <span className="block truncate text-2xs text-subtle">{movement.notes}</span>}
      </Td>
      <Td className="whitespace-nowrap">
        <MovementReference movement={movement} />
      </Td>
    </Tr>
  );
}

function describeMovement(movement: StockMovement): string {
  if (movement.exitReason) return EXIT_REASON_LABEL[movement.exitReason];
  const parts = [
    movement.supplierName,
    movement.lotCode ? `Lote ${movement.lotCode}` : null,
    movement.expiresAt ? `Val. ${formatDate(movement.expiresAt)}` : null,
    movement.notes,
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : '—';
}

function MovementReference({ movement }: { movement: StockMovement }) {
  if (movement.reference?.type === 'ORDER') {
    return (
      <Link href={`/dashboard/pedidos/${movement.reference.id}`} className="font-medium text-accent hover:underline">
        Pedido #{movement.reference.label ?? '—'}
      </Link>
    );
  }
  if (movement.reference?.type === 'INVENTORY_COUNT') {
    return <span className="text-muted-foreground">Inventário {movement.reference.id.slice(0, 8)}</span>;
  }
  if (movement.documentNumber) return <span className="text-muted-foreground">Doc. {movement.documentNumber}</span>;
  return <span className="text-subtle">—</span>;
}
