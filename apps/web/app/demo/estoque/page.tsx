'use client';

import { useState } from 'react';
import { ArrowDownToLine, ArrowUpFromLine, Pencil, Plus, Scale, ShoppingBag, TriangleAlert } from 'lucide-react';
import {
  demoInventoryItems,
  demoItemStatus,
  demoStockMovements,
  demoStockProducts,
  DemoStockStatus,
  DemoUnit,
} from '@/lib/demo/inventory';
import { formatDemoBRL } from '@/lib/demo/format';
import { Badge, BadgeTone } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Card } from '@/components/ds/Card';
import { SearchInput, Select } from '@/components/ds/Input';
import { Page, PageHeader } from '@/components/ds/PageHeader';
import { EmptyState } from '@/components/ds/States';
import { Switch } from '@/components/ds/Switch';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { Tabs } from '@/components/ds/Tabs';
import { Tooltip } from '@/components/ds/Tooltip';

type View = 'produtos' | 'insumos' | 'movimentacoes' | 'compras';

const STATUS_LABEL: Record<DemoStockStatus, string> = {
  OK: 'OK',
  LOW_STOCK: 'Estoque baixo',
  OUT_OF_STOCK: 'Sem estoque',
  NO_RECIPE: 'Sem ficha técnica',
};
const STATUS_TONE: Record<DemoStockStatus, BadgeTone> = {
  OK: 'success',
  LOW_STOCK: 'warning',
  OUT_OF_STOCK: 'danger',
  NO_RECIPE: 'neutral',
};
const MOVEMENT_LABEL = { ENTRY: 'Entrada', EXIT: 'Saída', ADJUSTMENT: 'Ajuste', SALE: 'Venda', SALE_REVERSAL: 'Estorno de venda' };
const MOVEMENT_TONE: Record<keyof typeof MOVEMENT_LABEL, BadgeTone> = {
  ENTRY: 'success',
  EXIT: 'danger',
  ADJUSTMENT: 'info',
  SALE: 'primary',
  SALE_REVERSAL: 'warning',
};

function qty(value: number, unit: DemoUnit) {
  const digits = Number.isInteger(value) ? 0 : 3;
  return `${value.toLocaleString('pt-BR', { minimumFractionDigits: digits, maximumFractionDigits: 3 })} ${unit}`;
}

function StatusBadge({ status }: { status: DemoStockStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {STATUS_LABEL[status]}
    </Badge>
  );
}

// Visual twin of /dashboard/estoque with static data: tabs, filters and the
// negative-stock toggle work locally; nothing is saved anywhere.
export default function DemoEstoquePage() {
  const [view, setView] = useState<View>('produtos');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [allowNegative, setAllowNegative] = useState(false);

  const items = demoInventoryItems;
  const itemById = new Map(items.map((i) => [i.id, i]));
  const lowItems = items.filter((i) => demoItemStatus(i) !== 'OK');
  const categories = [...new Set(demoStockProducts.map((p) => p.category))];
  const term = search.trim().toLowerCase();

  const products = demoStockProducts.filter(
    (p) => (!category || p.category === category) && (!term || p.name.toLowerCase().includes(term)),
  );
  const filteredItems = items.filter((i) => !term || i.name.toLowerCase().includes(term));

  return (
    <Page wide>
      <PageHeader
        title="Controle de estoque"
        description="Gerencie limites, custos e movimentações para evitar rupturas."
        actions={<Button icon={<Plus className="h-4 w-4" />}>Novo insumo</Button>}
      />

      <Tabs
        value={view}
        onChange={(v) => {
          setView(v);
          setSearch('');
        }}
        items={[
          { key: 'produtos', label: 'Produtos', count: demoStockProducts.length },
          { key: 'insumos', label: 'Insumos', count: items.length },
          { key: 'movimentacoes', label: 'Movimentações' },
          { key: 'compras', label: 'Compras' },
        ]}
      />

      <Card className="flex flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3">
        <div className="flex items-center gap-3">
          <Switch label="Permitir estoque negativo" checked={allowNegative} onChange={setAllowNegative} />
          <div>
            <p className="text-sm font-medium text-foreground">Permitir estoque negativo</p>
            <p className="text-2xs text-subtle">Desligado: saídas e vendas que zerariam o saldo são bloqueadas.</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Quando o estoque zerar:</span>
          <Tooltip label="Em breve">
            <span className="flex gap-1 rounded-ctl bg-surface-2 p-1 opacity-60">
              <span className="rounded-md px-2.5 py-1 text-xs font-medium text-subtle">Pausar o produto</span>
              <span className="rounded-md px-2.5 py-1 text-xs font-medium text-subtle">Vender sob encomenda</span>
            </span>
          </Tooltip>
        </div>
      </Card>

      {view !== 'compras' && (
        <button
          type="button"
          onClick={() => setView('insumos')}
          className="flex w-full items-center gap-2 rounded-ctl border border-warning/30 bg-warning/10 px-3 py-2 text-left text-sm text-warning transition-colors hover:bg-warning/15"
        >
          <TriangleAlert className="h-4 w-4 shrink-0" aria-hidden />
          <span className="min-w-0 flex-1 truncate">
            {lowItems.length} insumos com estoque baixo ou zerado: {lowItems.map((i) => i.name).join(', ')}
          </span>
          <span className="shrink-0 text-xs font-semibold underline">Ver insumos</span>
        </button>
      )}

      {view === 'produtos' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-[14rem] flex-1 sm:max-w-sm">
              <SearchInput placeholder="Buscar produto..." aria-label="Buscar produto" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <div className="w-full sm:w-56">
              <Select aria-label="Filtrar por categoria" value={category} onChange={(e) => setCategory(e.target.value)}>
                <option value="">Todas as categorias</option>
                {categories.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
            <p className="ml-auto text-xs text-muted-foreground">{products.length} produtos</p>
          </div>
          <Card className="overflow-hidden">
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <Th>Produto</Th>
                    <Th className="text-right">Estoque</Th>
                    <Th className="text-right">Saída (7 dias)</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Ficha técnica</Th>
                  </tr>
                </THead>
                <TBody>
                  {products.map((p) => (
                    <Tr key={p.id}>
                      <Td>
                        <div className="flex items-center gap-3">
                          <span aria-hidden className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-line bg-surface-2 text-lg">
                            {p.emoji}
                          </span>
                          <div className="min-w-0">
                            <p className="truncate font-medium text-foreground">{p.name}</p>
                            <p className="text-xs text-subtle">{p.category}</p>
                          </div>
                        </div>
                      </Td>
                      <Td className="text-right text-foreground">
                        {p.producibleUnits === null ? <span className="text-subtle">—</span> : `${p.producibleUnits} un.`}
                      </Td>
                      <Td className="text-right text-muted-foreground">{p.soldLast7Days} un.</Td>
                      <Td>
                        <StatusBadge status={p.status} />
                      </Td>
                      <Td className="text-right">
                        <Button variant={p.status === 'NO_RECIPE' ? 'outline' : 'ghost'} size="sm">
                          {p.status === 'NO_RECIPE' ? 'Criar ficha' : 'Ver ficha'}
                        </Button>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </Card>
        </div>
      )}

      {view === 'insumos' && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-[14rem] flex-1 sm:max-w-sm">
              <SearchInput placeholder="Buscar insumo..." aria-label="Buscar insumo" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <p className="ml-auto text-xs text-muted-foreground">{filteredItems.length} insumos</p>
          </div>
          <Card className="overflow-hidden">
            <TableWrap>
              <Table>
                <THead>
                  <tr>
                    <Th>Nome</Th>
                    <Th>Unidade</Th>
                    <Th className="text-right">Estoque</Th>
                    <Th className="text-right">Mínimo</Th>
                    <Th className="text-right">Saída (7 dias)</Th>
                    <Th className="text-right">Custo médio</Th>
                    <Th>Status</Th>
                    <Th className="text-right">Ações</Th>
                  </tr>
                </THead>
                <TBody>
                  {filteredItems.map((item) => (
                    <Tr key={item.id}>
                      <Td className="font-medium text-foreground">{item.name}</Td>
                      <Td className="text-muted-foreground">{item.unit}</Td>
                      <Td className="whitespace-nowrap text-right font-semibold text-foreground">{qty(item.quantity, item.unit)}</Td>
                      <Td className="whitespace-nowrap text-right text-muted-foreground">{qty(item.minStock, item.unit)}</Td>
                      <Td className="whitespace-nowrap text-right text-muted-foreground">{qty(item.exitLast7Days, item.unit)}</Td>
                      <Td className="whitespace-nowrap text-right text-muted-foreground">
                        {formatDemoBRL(item.averageCostCents)}/{item.unit}
                      </Td>
                      <Td>
                        <StatusBadge status={demoItemStatus(item)} />
                      </Td>
                      <Td>
                        <div className="flex justify-end gap-0.5">
                          <Button variant="ghost" size="icon-sm" aria-label="Entrada">
                            <ArrowDownToLine className="h-4 w-4 text-success" />
                          </Button>
                          <Button variant="ghost" size="icon-sm" aria-label="Saída">
                            <ArrowUpFromLine className="h-4 w-4 text-danger" />
                          </Button>
                          <Button variant="ghost" size="icon-sm" aria-label="Ajuste">
                            <Scale className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon-sm" aria-label="Editar">
                            <Pencil className="h-4 w-4" />
                          </Button>
                        </div>
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </Card>
        </div>
      )}

      {view === 'movimentacoes' && (
        <Card className="overflow-hidden">
          <TableWrap>
            <Table>
              <THead>
                <tr>
                  <Th>Data</Th>
                  <Th>Tipo</Th>
                  <Th>Insumo</Th>
                  <Th className="text-right">Quantidade</Th>
                  <Th className="text-right">Custo</Th>
                  <Th>Usuário</Th>
                  <Th>Motivo</Th>
                  <Th>Referência</Th>
                </tr>
              </THead>
              <TBody>
                {demoStockMovements.map((m) => {
                  const item = itemById.get(m.itemId)!;
                  return (
                    <Tr key={m.id}>
                      <Td className="whitespace-nowrap text-muted-foreground">{m.at}</Td>
                      <Td>
                        <Badge tone={MOVEMENT_TONE[m.type]}>{MOVEMENT_LABEL[m.type]}</Badge>
                      </Td>
                      <Td className="font-medium text-foreground">{item.name}</Td>
                      <Td className={`whitespace-nowrap text-right font-semibold ${m.quantity < 0 ? 'text-danger' : 'text-success'}`}>
                        {m.quantity > 0 ? '+' : '−'}
                        {qty(Math.abs(m.quantity), item.unit)}
                      </Td>
                      <Td className="whitespace-nowrap text-right text-muted-foreground">
                        {m.unitCostCents ? formatDemoBRL(m.unitCostCents) : '—'}
                      </Td>
                      <Td className="text-muted-foreground">{m.user}</Td>
                      <Td className="max-w-[14rem] truncate text-muted-foreground">{m.reason ?? '—'}</Td>
                      <Td className="text-muted-foreground">{m.orderNumber ? `Pedido #${m.orderNumber}` : '—'}</Td>
                    </Tr>
                  );
                })}
              </TBody>
            </Table>
          </TableWrap>
        </Card>
      )}

      {view === 'compras' && (
        <EmptyState
          icon={<ShoppingBag />}
          title="Compras — em breve"
          description="Pedidos de compra, fornecedores e notas de entrada chegam numa próxima fase."
        />
      )}
    </Page>
  );
}
