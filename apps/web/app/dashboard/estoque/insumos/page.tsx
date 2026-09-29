'use client';

import { useDeferredValue, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ArrowDownToLine, ArrowUpFromLine, CalendarClock, History, Pencil, Plus, Scale } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { formatCents } from '@/lib/cash-api';
import { formatQuantity, inventoryApi, ItemStatusFilter, UNIT_LABEL } from '@/lib/inventory-api';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Card } from '@/components/ds/Card';
import { SearchInput, Select } from '@/components/ds/Input';
import { EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { Tooltip } from '@/components/ds/Tooltip';
import { StockStatusBadge } from '@/components/estoque/badges';
import { useEstoque } from '@/components/estoque/EstoqueProvider';
import { INVENTORY_QUERY_ROOT } from '@/components/estoque/use-inventory';

export default function InsumosPage() {
  const { accessToken } = useAuth();
  const { branchId, canManage, openEntry, openExit, openItem } = useEstoque();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ItemStatusFilter | ''>('');
  const deferredSearch = useDeferredValue(search.trim());

  const query = useQuery({
    queryKey: [INVENTORY_QUERY_ROOT, 'items', branchId, deferredSearch, status],
    queryFn: () =>
      inventoryApi.listItems(accessToken as string, branchId as string, {
        search: deferredSearch || undefined,
        status: status || undefined,
      }),
    enabled: !!accessToken && !!branchId,
    placeholderData: (previous) => previous,
  });
  const items = query.data ?? [];
  const filtered = !!deferredSearch || !!status;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[14rem] flex-1 sm:max-w-sm">
          <SearchInput placeholder="Buscar por nome ou SKU..." aria-label="Buscar insumo" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="w-full sm:w-48">
          <Select aria-label="Filtrar por status" value={status} onChange={(e) => setStatus(e.target.value as ItemStatusFilter | '')}>
            <option value="">Todos os status</option>
            <option value="OK">OK</option>
            <option value="LOW_STOCK">Estoque baixo</option>
            <option value="OUT_OF_STOCK">Sem estoque</option>
            <option value="INACTIVE">Inativos</option>
          </Select>
        </div>
        <p className="text-xs text-muted-foreground">{items.length} insumo(s)</p>
        {canManage && (
          <Button className="ml-auto" icon={<Plus className="h-4 w-4" />} onClick={() => openItem()}>
            Novo insumo
          </Button>
        )}
      </div>

      {query.isLoading ? (
        <LoadingState label="Carregando insumos..." />
      ) : query.isError ? (
        <ErrorState message="Não foi possível carregar os insumos." onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={<Scale />}
          title={filtered ? 'Nenhum insumo encontrado' : 'Nenhum insumo cadastrado'}
          description={
            filtered
              ? 'Ajuste a busca ou o filtro.'
              : 'Insumos são os ingredientes e materiais controlados: pão, carne, queijo, embalagens...'
          }
          action={
            canManage && !filtered ? (
              <Button icon={<Plus className="h-4 w-4" />} onClick={() => openItem()}>
                Novo insumo
              </Button>
            ) : undefined
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <Th>Insumo</Th>
                  <Th>Unidade</Th>
                  <Th className="text-right">Estoque</Th>
                  <Th className="text-right">Mínimo</Th>
                  <Th className="text-right">Custo médio</Th>
                  <Th className="text-right">Valor</Th>
                  <Th>Status</Th>
                  <Th className="text-right">Ações</Th>
                </tr>
              </THead>
              <TBody>
                {items.map((item) => (
                  <Tr key={item.id} className={item.active ? '' : 'opacity-60'}>
                    <Td>
                      <p className="flex items-center gap-1.5 font-medium text-foreground">
                        {item.name}
                        {item.tracksExpiry && (
                          <Tooltip label="Controla validade">
                            <CalendarClock className="h-3.5 w-3.5 text-accent" aria-label="Controla validade" />
                          </Tooltip>
                        )}
                      </p>
                      <p className="text-xs text-subtle">
                        {item.sku ? `SKU ${item.sku}` : 'Sem SKU'}
                        {item.usedInRecipes > 0 && ` · em ${item.usedInRecipes} ficha(s)`}
                      </p>
                    </Td>
                    <Td className="text-muted-foreground">{UNIT_LABEL[item.unit]}</Td>
                    <Td className={`whitespace-nowrap text-right font-semibold ${(item.quantity ?? 0) < 0 ? 'text-danger' : 'text-foreground'}`}>
                      {formatQuantity(item.quantity ?? 0, item.unit)}
                    </Td>
                    <Td className="whitespace-nowrap text-right text-muted-foreground">
                      {formatQuantity(item.minStock, item.unit)}
                      {item.maxStock !== null && (
                        <span className="block text-2xs text-subtle">máx. {formatQuantity(item.maxStock, item.unit)}</span>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-right text-muted-foreground">
                      {item.averageCostCents ? `${formatCents(item.averageCostCents)}/${UNIT_LABEL[item.unit]}` : '—'}
                    </Td>
                    <Td className="whitespace-nowrap text-right font-semibold text-accent">
                      {formatCents(item.stockValueCents ?? 0)}
                    </Td>
                    <Td>{item.active ? <StockStatusBadge status={item.status} /> : <Badge>Inativo</Badge>}</Td>
                    <Td>
                      <div className="flex items-center justify-end gap-0.5">
                        {canManage && item.active && (
                          <>
                            <Tooltip label="Entrada">
                              <Button variant="ghost" size="icon-sm" aria-label={`Entrada de ${item.name}`} onClick={() => openEntry(item.id)}>
                                <ArrowDownToLine className="h-4 w-4 text-success" />
                              </Button>
                            </Tooltip>
                            <Tooltip label="Saída">
                              <Button variant="ghost" size="icon-sm" aria-label={`Saída de ${item.name}`} onClick={() => openExit(item.id)}>
                                <ArrowUpFromLine className="h-4 w-4 text-danger" />
                              </Button>
                            </Tooltip>
                          </>
                        )}
                        <Tooltip label="Histórico">
                          <Link
                            href={`/dashboard/estoque/movimentacoes?item=${item.id}`}
                            aria-label={`Histórico de ${item.name}`}
                            className="inline-flex h-7 w-7 items-center justify-center rounded-ctl text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
                          >
                            <History className="h-4 w-4" />
                          </Link>
                        </Tooltip>
                        {canManage && (
                          <Tooltip label="Editar">
                            <Button variant="ghost" size="icon-sm" aria-label={`Editar ${item.name}`} onClick={() => openItem(item)}>
                              <Pencil className="h-4 w-4" />
                            </Button>
                          </Tooltip>
                        )}
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      )}
    </div>
  );
}
