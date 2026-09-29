'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { formatCents } from '@/lib/cash-api';
import {
  COMPATIBLE_UNITS,
  formatPercent,
  formatQuantity,
  InventoryItem,
  InventoryUnit,
  inventoryApi,
  parseQuantity,
  RecipeDetail,
  UNIT_LABEL,
} from '@/lib/inventory-api';
import { Alert, EmptyState, LoadingState } from '@/components/ds/States';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { Input, Select } from '@/components/ds/Input';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { useToast } from '@/components/ds/Toast';
import { INVENTORY_QUERY_ROOT, useErrorMessage } from './use-inventory';

interface EditableLine {
  key: number;
  inventoryItemId: string;
  quantity: string;
  unit: InventoryUnit;
}

let nextLineKey = 0;

function linesFrom(recipe: RecipeDetail): EditableLine[] {
  return recipe.items.map((line) => ({
    key: ++nextLineKey,
    inventoryItemId: line.inventoryItemId,
    quantity: String(line.inputQuantity).replace('.', ','),
    unit: line.inputUnit,
  }));
}

export function RecipeDialog({
  open,
  product,
  branchId,
  items,
  canManage,
  onClose,
  onSaved,
}: {
  open: boolean;
  product: { productId: string; name: string } | null;
  branchId: string | null;
  items: InventoryItem[];
  canManage: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { accessToken } = useAuth();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [editing, setEditing] = useState(false);
  const [lines, setLines] = useState<EditableLine[]>([]);
  const [error, setError] = useState<string | null>(null);

  const recipeQuery = useQuery({
    queryKey: [INVENTORY_QUERY_ROOT, 'recipe', product?.productId, branchId],
    queryFn: () => inventoryApi.getRecipe(accessToken as string, product!.productId, branchId as string),
    enabled: open && !!accessToken && !!product && !!branchId,
  });
  const recipe = recipeQuery.data;

  useEffect(() => {
    if (!open) return;
    setEditing(false);
    setError(null);
  }, [open, product?.productId]);

  useEffect(() => {
    if (recipe && !editing) setLines(linesFrom(recipe));
  }, [recipe, editing]);

  const itemById = new Map(items.map((item) => [item.id, item]));
  const selectableItems = items.filter((item) => item.active);

  function startEditing() {
    if (recipe) setLines(linesFrom(recipe));
    setError(null);
    setEditing(true);
  }

  function addLine() {
    const used = new Set(lines.map((line) => line.inventoryItemId));
    const next = selectableItems.find((item) => !used.has(item.id));
    if (!next) return;
    setLines((current) => [...current, { key: ++nextLineKey, inventoryItemId: next.id, quantity: '', unit: next.unit }]);
  }

  function updateLine(key: number, patch: Partial<EditableLine>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  const save = useMutation({
    mutationFn: async () => {
      const payload = lines.map((line) => {
        const quantity = parseQuantity(line.quantity);
        const name = itemById.get(line.inventoryItemId)?.name ?? 'insumo';
        if (quantity === null || quantity <= 0) throw new Error(`Quantidade inválida para "${name}".`);
        return { inventoryItemId: line.inventoryItemId, quantity, unit: line.unit };
      });
      return inventoryApi.putRecipe(accessToken as string, product!.productId, payload);
    },
    onSuccess: async () => {
      toast.success(lines.length ? 'Ficha técnica salva.' : 'Ficha técnica removida.');
      await recipeQuery.refetch();
      onSaved();
      setEditing(false);
    },
    onError: (err) => setError(errorMessage(err, 'Não foi possível salvar a ficha técnica.')),
  });

  const footer = editing ? (
    <>
      <Button variant="ghost" onClick={() => setEditing(false)} disabled={save.isPending}>
        Cancelar
      </Button>
      <Button onClick={() => save.mutate()} loading={save.isPending}>
        Salvar ficha
      </Button>
    </>
  ) : (
    <>
      <Button variant="ghost" onClick={onClose}>
        Fechar
      </Button>
      {canManage && (
        <Button icon={<Pencil className="h-4 w-4" />} onClick={startEditing} disabled={!recipe}>
          {recipe && recipe.items.length ? 'Editar ficha' : 'Criar ficha'}
        </Button>
      )}
    </>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title={`Ficha técnica — ${product?.name ?? ''}`}
      description="Consumo por 1 unidade vendida. A baixa acontece quando o pedido é confirmado."
      footer={footer}
    >
      {recipeQuery.isLoading || !recipe ? (
        <LoadingState className="py-8" />
      ) : editing ? (
        <RecipeEditor
          lines={lines}
          items={items}
          itemById={itemById}
          selectableCount={selectableItems.length}
          error={error}
          onAdd={addLine}
          onChange={updateLine}
          onRemove={(key) => setLines((current) => current.filter((line) => line.key !== key))}
        />
      ) : (
        <RecipeView recipe={recipe} />
      )}
    </Dialog>
  );
}

function RecipeView({ recipe }: { recipe: RecipeDetail }) {
  if (recipe.items.length === 0) {
    return (
      <EmptyState
        title="Sem ficha técnica"
        description="Vendas deste produto não baixam estoque até que a ficha seja criada."
      />
    );
  }
  return (
    <div className="space-y-4">
      <div className="overflow-hidden rounded-card border border-line">
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <Th>Insumo</Th>
                <Th className="text-right">Quantidade</Th>
                <Th>Unidade</Th>
                <Th className="text-right">Custo</Th>
                <Th className="text-right">Subtotal</Th>
              </tr>
            </THead>
            <TBody>
              {recipe.items.map((line) => (
                <Tr key={line.inventoryItemId}>
                  <Td className="font-medium text-foreground">{line.name}</Td>
                  <Td className="text-right text-foreground">
                    {line.inputQuantity.toLocaleString('pt-BR', { maximumFractionDigits: 3 })}
                  </Td>
                  <Td className="text-muted-foreground">
                    {UNIT_LABEL[line.inputUnit]}
                    {line.inputUnit !== line.unit && (
                      <span className="ml-1 text-2xs text-subtle">({formatQuantity(line.quantity, line.unit)})</span>
                    )}
                  </Td>
                  <Td className="whitespace-nowrap text-right text-muted-foreground">
                    {line.unitCostCents === null ? '—' : `${formatCents(line.unitCostCents)}/${UNIT_LABEL[line.unit]}`}
                  </Td>
                  <Td className="whitespace-nowrap text-right font-semibold text-foreground">
                    {line.subtotalCents === null ? '—' : formatCents(line.subtotalCents)}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </div>
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Figure label="Custo da ficha" value={recipe.costCents === null ? '—' : formatCents(recipe.costCents)} highlight />
        <Figure label="Preço de venda" value={formatCents(recipe.priceCents)} />
        <Figure
          label="Margem"
          value={recipe.marginCents === null ? '—' : formatCents(recipe.marginCents)}
          tone={recipe.marginCents !== null && recipe.marginCents < 0 ? 'danger' : undefined}
        />
        <Figure
          label="Margem %"
          value={formatPercent(recipe.marginPercent)}
          tone={recipe.marginPercent !== null && recipe.marginPercent < 0 ? 'danger' : undefined}
        />
      </dl>
      <p className="text-2xs text-subtle">Custos calculados pelo custo médio atual de cada insumo nesta unidade.</p>
    </div>
  );
}

function Figure({
  label,
  value,
  highlight,
  tone,
}: {
  label: string;
  value: string;
  highlight?: boolean;
  tone?: 'danger';
}) {
  return (
    <div className="rounded-ctl bg-surface-2 px-3 py-2.5">
      <dt className="text-2xs font-medium text-muted-foreground">{label}</dt>
      <dd
        className={`mt-0.5 text-base font-semibold ${
          tone === 'danger' ? 'text-danger' : highlight ? 'text-accent' : 'text-foreground'
        }`}
      >
        {value}
      </dd>
    </div>
  );
}

function RecipeEditor({
  lines,
  items,
  itemById,
  selectableCount,
  error,
  onAdd,
  onChange,
  onRemove,
}: {
  lines: EditableLine[];
  items: InventoryItem[];
  itemById: Map<string, InventoryItem>;
  selectableCount: number;
  error: string | null;
  onAdd: () => void;
  onChange: (key: number, patch: Partial<EditableLine>) => void;
  onRemove: (key: number) => void;
}) {
  if (items.length === 0) {
    return <EmptyState title="Nenhum insumo cadastrado" description="Cadastre insumos antes de montar a ficha técnica." />;
  }
  return (
    <div className="space-y-3">
      {error && <Alert>{error}</Alert>}
      {lines.length === 0 ? (
        <p className="rounded-ctl border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted-foreground">
          Adicione os insumos consumidos por 1 unidade do produto. Uma ficha vazia é removida ao salvar.
        </p>
      ) : (
        <ul className="space-y-2">
          <li className="grid grid-cols-[1fr_7rem_5.5rem_2.25rem] gap-2 px-1 text-2xs font-medium uppercase tracking-wide text-subtle">
            <span>Insumo</span>
            <span>Quantidade</span>
            <span>Unidade</span>
            <span />
          </li>
          {lines.map((line) => {
            const item = itemById.get(line.inventoryItemId);
            return (
              <li key={line.key} className="grid grid-cols-[1fr_7rem_5.5rem_2.25rem] items-center gap-2">
                <Select
                  aria-label="Insumo"
                  value={line.inventoryItemId}
                  onChange={(e) => {
                    const next = itemById.get(e.target.value);
                    onChange(line.key, { inventoryItemId: e.target.value, unit: next?.unit ?? line.unit });
                  }}
                >
                  {items
                    .filter((candidate) => candidate.active || candidate.id === line.inventoryItemId)
                    .filter(
                      (candidate) =>
                        candidate.id === line.inventoryItemId || !lines.some((other) => other.inventoryItemId === candidate.id),
                    )
                    .map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.name}
                      </option>
                    ))}
                </Select>
                <Input
                  aria-label="Quantidade"
                  inputMode="decimal"
                  value={line.quantity}
                  onChange={(e) => onChange(line.key, { quantity: e.target.value })}
                />
                <Select
                  aria-label="Unidade"
                  disabled={!item}
                  value={line.unit}
                  onChange={(e) => onChange(line.key, { unit: e.target.value as InventoryUnit })}
                >
                  {(item ? COMPATIBLE_UNITS[item.unit] : [line.unit]).map((unit) => (
                    <option key={unit} value={unit}>
                      {UNIT_LABEL[unit]}
                    </option>
                  ))}
                </Select>
                <Button variant="danger-ghost" size="icon" aria-label="Remover insumo" onClick={() => onRemove(line.key)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      <Button
        variant="outline"
        size="sm"
        icon={<Plus className="h-3.5 w-3.5" />}
        onClick={onAdd}
        disabled={lines.length >= selectableCount}
      >
        Adicionar insumo
      </Button>
      <p className="text-2xs text-subtle">O custo e a margem são recalculados pelo sistema depois de salvar.</p>
    </div>
  );
}
