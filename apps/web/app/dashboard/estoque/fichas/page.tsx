'use client';

import { useDeferredValue, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { BookOpen, ImageIcon } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { formatCents } from '@/lib/cash-api';
import { formatPercent, inventoryApi, RecipeRow } from '@/lib/inventory-api';
import { Button } from '@/components/ds/Button';
import { Card } from '@/components/ds/Card';
import { SearchInput } from '@/components/ds/Input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { Tabs } from '@/components/ds/Tabs';
import { StockStatusBadge } from '@/components/estoque/badges';
import { useEstoque } from '@/components/estoque/EstoqueProvider';
import { RecipeDialog } from '@/components/estoque/RecipeDialog';
import { INVENTORY_QUERY_ROOT, useInventoryItems } from '@/components/estoque/use-inventory';

type RecipeFilter = 'ALL' | 'WITH' | 'WITHOUT';

export default function FichasPage() {
  const { accessToken } = useAuth();
  const { branchId, canManage, refresh } = useEstoque();
  const itemsQuery = useInventoryItems(branchId);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<RecipeFilter>('ALL');
  const [selected, setSelected] = useState<RecipeRow | null>(null);
  const deferredSearch = useDeferredValue(search.trim());

  const query = useQuery({
    queryKey: [INVENTORY_QUERY_ROOT, 'recipes', branchId, deferredSearch],
    queryFn: () => inventoryApi.listRecipes(accessToken as string, branchId as string, deferredSearch || undefined),
    enabled: !!accessToken && !!branchId,
    placeholderData: (previous) => previous,
  });
  const all = query.data ?? [];
  const rows = all.filter((row) => filter === 'ALL' || (filter === 'WITH' ? row.hasRecipe : !row.hasRecipe));
  const withRecipe = all.filter((row) => row.hasRecipe).length;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[14rem] flex-1 sm:max-w-sm">
          <SearchInput placeholder="Buscar produto..." aria-label="Buscar produto" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Tabs
          variant="pill"
          value={filter}
          onChange={setFilter}
          items={[
            { key: 'ALL', label: 'Todos', count: all.length },
            { key: 'WITH', label: 'Com ficha', count: withRecipe },
            { key: 'WITHOUT', label: 'Sem ficha', count: all.length - withRecipe },
          ]}
        />
      </div>

      {query.isLoading ? (
        <LoadingState label="Carregando fichas técnicas..." />
      ) : query.isError ? (
        <ErrorState message="Não foi possível carregar as fichas técnicas." onRetry={() => query.refetch()} />
      ) : all.length === 0 && !deferredSearch ? (
        <EmptyState
          icon={<BookOpen />}
          title="Nenhum produto no cardápio"
          description="Cadastre produtos no Cardápio para montar a ficha técnica deles."
          action={
            <Link href="/dashboard/cardapio">
              <Button variant="outline">Ir para o Cardápio</Button>
            </Link>
          }
        />
      ) : rows.length === 0 ? (
        <EmptyState icon={<BookOpen />} title="Nenhum produto encontrado" description="Ajuste a busca ou o filtro." />
      ) : (
        <Card className="overflow-hidden">
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <Th>Produto</Th>
                  <Th className="text-right">Custo</Th>
                  <Th className="text-right">Preço</Th>
                  <Th className="text-right">Margem</Th>
                  <Th className="text-right">Produzível</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Ficha técnica</Th>
                </tr>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <Tr key={row.productId}>
                    <Td>
                      <div className="flex items-center gap-3">
                        {row.imageUrl ? (
                          <span
                            aria-hidden
                            className="h-9 w-9 shrink-0 rounded-md border border-line bg-cover bg-center"
                            style={{ backgroundImage: `url(${JSON.stringify(row.imageUrl)})` }}
                          />
                        ) : (
                          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-subtle">
                            <ImageIcon className="h-4 w-4" aria-hidden />
                          </span>
                        )}
                        <div className="min-w-0">
                          <p className="truncate font-medium text-foreground">{row.name}</p>
                          <p className="truncate text-xs text-subtle">
                            {row.category.name}
                            {!row.active && ' · pausado no cardápio'}
                          </p>
                        </div>
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap text-right text-foreground">
                      {row.costCents === null ? <span className="text-subtle">—</span> : formatCents(row.costCents)}
                    </Td>
                    <Td className="whitespace-nowrap text-right font-semibold text-accent">{formatCents(row.priceCents)}</Td>
                    <Td className="whitespace-nowrap text-right">
                      {row.marginCents === null ? (
                        <span className="text-subtle">—</span>
                      ) : (
                        <span className={row.marginCents < 0 ? 'text-danger' : 'text-foreground'}>
                          {formatCents(row.marginCents)}
                          <span className="ml-1.5 text-xs text-muted-foreground">{formatPercent(row.marginPercent)}</span>
                        </span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-right text-muted-foreground">
                      {row.producibleUnits === null ? '—' : `${row.producibleUnits} un.`}
                    </Td>
                    <Td>
                      <StockStatusBadge status={row.status} />
                    </Td>
                    <Td className="text-right">
                      <Button variant={row.hasRecipe ? 'ghost' : 'outline'} size="sm" onClick={() => setSelected(row)}>
                        {row.hasRecipe ? `${row.itemCount} insumo(s)` : canManage ? 'Criar ficha' : 'Ver'}
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      )}
      <p className="text-2xs text-subtle">
        Custo = soma de (quantidade × custo médio do insumo nesta unidade), calculado pelo sistema. Produzível = unidades que o saldo atual dos
        insumos permite produzir.
      </p>

      <RecipeDialog
        open={selected !== null}
        product={selected ? { productId: selected.productId, name: selected.name } : null}
        branchId={branchId}
        items={itemsQuery.data ?? []}
        canManage={canManage}
        onClose={() => setSelected(null)}
        onSaved={refresh}
      />
    </div>
  );
}
