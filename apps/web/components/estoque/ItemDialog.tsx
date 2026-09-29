'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { InventoryItem, InventoryUnit, inventoryApi, parseQuantity, UNIT_OPTIONS } from '@/lib/inventory-api';
import { Alert } from '@/components/ds/States';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ds/Input';
import { Switch } from '@/components/ds/Switch';
import { useToast } from '@/components/ds/Toast';
import { useErrorMessage } from './use-inventory';

function toInput(value: number | null | undefined): string {
  return value === null || value === undefined ? '' : String(value).replace('.', ',');
}

export function ItemDialog({
  open,
  item,
  onClose,
  onSaved,
}: {
  open: boolean;
  item: InventoryItem | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { accessToken } = useAuth();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [name, setName] = useState('');
  const [sku, setSku] = useState('');
  const [unit, setUnit] = useState<InventoryUnit>('KG');
  const [minStock, setMinStock] = useState('0');
  const [maxStock, setMaxStock] = useState('');
  const [tracksExpiry, setTracksExpiry] = useState(false);
  const [notes, setNotes] = useState('');
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setName(item?.name ?? '');
    setSku(item?.sku ?? '');
    setUnit(item?.unit ?? 'KG');
    setMinStock(toInput(item?.minStock ?? 0));
    setMaxStock(toInput(item?.maxStock));
    setTracksExpiry(item?.tracksExpiry ?? false);
    setNotes(item?.notes ?? '');
    setActive(item?.active ?? true);
    setError(null);
  }, [open, item]);

  const save = useMutation({
    mutationFn: async () => {
      const min = parseQuantity(minStock || '0');
      if (min === null) throw new Error('Estoque mínimo inválido (até 3 casas decimais).');
      const max = maxStock.trim() ? parseQuantity(maxStock) : null;
      if (maxStock.trim() && max === null) throw new Error('Estoque máximo inválido (até 3 casas decimais).');
      const input = {
        name: name.trim(),
        sku: sku.trim() || null,
        minStock: min,
        maxStock: max,
        tracksExpiry,
        notes: notes.trim() || null,
      };
      if (item) return inventoryApi.updateItem(accessToken as string, item.id, { ...input, active });
      return inventoryApi.createItem(accessToken as string, {
        ...input,
        sku: input.sku ?? undefined,
        notes: input.notes ?? undefined,
        maxStock: input.maxStock ?? undefined,
        unit,
      });
    },
    onSuccess: () => {
      toast.success(item ? 'Insumo atualizado.' : 'Insumo cadastrado.');
      onSaved();
      onClose();
    },
    onError: (err) => setError(errorMessage(err, 'Não foi possível salvar o insumo.')),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    save.mutate();
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={item ? 'Editar insumo' : 'Novo insumo'}
      description="Ingredientes, embalagens e materiais controlados no estoque."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="inventory-item-form" loading={save.isPending}>
            Salvar
          </Button>
        </>
      }
    >
      <form id="inventory-item-form" onSubmit={submit} className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <Field label="Nome">
          <Input required minLength={2} autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex.: Queijo cheddar" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="SKU (opcional)">
            <Input value={sku} onChange={(e) => setSku(e.target.value)} />
          </Field>
          <Field label="Unidade de estoque" hint={item ? 'Não pode ser alterada' : undefined}>
            <Select value={unit} onChange={(e) => setUnit(e.target.value as InventoryUnit)} disabled={!!item}>
              {UNIT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Estoque mínimo" hint="Igual ou abaixo: estoque baixo">
            <Input inputMode="decimal" value={minStock} onChange={(e) => setMinStock(e.target.value)} />
          </Field>
          <Field label="Estoque máximo (opcional)">
            <Input inputMode="decimal" value={maxStock} onChange={(e) => setMaxStock(e.target.value)} />
          </Field>
        </div>
        <div className="flex items-center justify-between gap-3 rounded-ctl border border-line bg-surface-2 px-3 py-2.5">
          <span>
            <span className="block text-sm font-medium text-foreground">Controlar validade</span>
            <span className="block text-2xs text-subtle">Entradas passam a exigir a data de validade.</span>
          </span>
          <Switch label="Controlar validade" checked={tracksExpiry} onChange={setTracksExpiry} />
        </div>
        <Field label="Observação (opcional)">
          <Textarea value={notes} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        {item && (
          <div className="flex items-center justify-between gap-3 rounded-ctl border border-line bg-surface-2 px-3 py-2.5">
            <span className="text-sm font-medium text-foreground">Insumo ativo</span>
            <Switch label="Insumo ativo" checked={active} onChange={setActive} />
          </div>
        )}
      </form>
    </Dialog>
  );
}
