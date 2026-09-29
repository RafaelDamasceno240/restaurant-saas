'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { formatCents } from '@/lib/cash-api';
import {
  EXIT_REASON_LABEL,
  formatQuantity,
  InventoryItem,
  inventoryApi,
  parseCostToCents,
  parseQuantity,
  StockExitReason,
  UNIT_LABEL,
} from '@/lib/inventory-api';
import { Alert } from '@/components/ds/States';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { Field, Input, Select } from '@/components/ds/Input';
import { useToast } from '@/components/ds/Toast';
import { useErrorMessage } from './use-inventory';

interface MovementDialogProps {
  open: boolean;
  branchId: string | null;
  items: InventoryItem[];
  initialItemId: string | null;
  onClose: () => void;
  onSaved: () => void;
}

const EXIT_REASONS = Object.keys(EXIT_REASON_LABEL) as StockExitReason[];

function ItemPicker({
  items,
  value,
  onChange,
}: {
  items: InventoryItem[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <Field label="Insumo">
      <Select required value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="" disabled>
          Selecione um insumo
        </option>
        {items.map((item) => (
          <option key={item.id} value={item.id}>
            {item.name} ({UNIT_LABEL[item.unit]})
          </option>
        ))}
      </Select>
    </Field>
  );
}

function CurrentBalance({ item }: { item: InventoryItem | undefined }) {
  if (!item) return null;
  return (
    <p className="rounded-ctl bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
      Saldo atual: <span className="font-semibold text-foreground">{formatQuantity(item.quantity ?? 0, item.unit)}</span>
      {item.averageCostCents ? ` · custo médio ${formatCents(item.averageCostCents)}/${UNIT_LABEL[item.unit]}` : ''}
    </p>
  );
}

function useActiveItems(items: InventoryItem[]) {
  return useMemo(() => items.filter((item) => item.active), [items]);
}

export function EntryDialog({ open, branchId, items, initialItemId, onClose, onSaved }: MovementDialogProps) {
  const { accessToken } = useAuth();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const activeItems = useActiveItems(items);
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [cost, setCost] = useState('');
  const [supplier, setSupplier] = useState('');
  const [documentNumber, setDocumentNumber] = useState('');
  const [lotCode, setLotCode] = useState('');
  const [expiresAt, setExpiresAt] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const item = activeItems.find((candidate) => candidate.id === itemId);

  useEffect(() => {
    if (!open) return;
    setItemId(initialItemId ?? '');
    setQuantity('');
    setSupplier('');
    setDocumentNumber('');
    setLotCode('');
    setExpiresAt('');
    setNotes('');
    setError(null);
  }, [open, initialItemId]);

  useEffect(() => {
    setCost(item?.averageCostCents ? (item.averageCostCents / 100).toFixed(2).replace('.', ',') : '');
  }, [item]);

  const save = useMutation({
    mutationFn: async () => {
      if (!branchId || !item) throw new Error('Selecione o insumo.');
      const qty = parseQuantity(quantity);
      if (qty === null || qty <= 0) throw new Error('Informe uma quantidade maior que zero (até 3 casas decimais).');
      const unitCostCents = parseCostToCents(cost);
      if (unitCostCents === null) throw new Error('Informe o custo unitário (ex.: 12,50).');
      if (item.tracksExpiry && !expiresAt) throw new Error('Este insumo controla validade: informe a data.');
      return inventoryApi.createMovement(accessToken as string, {
        type: 'ENTRY',
        branchId,
        inventoryItemId: item.id,
        quantity: qty,
        unitCostCents,
        supplierName: supplier.trim() || undefined,
        documentNumber: documentNumber.trim() || undefined,
        lotCode: lotCode.trim() || undefined,
        expiresAt: expiresAt || undefined,
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: (movement) => {
      toast.success(`Entrada registrada: ${item?.name}. Saldo ${formatQuantity(movement.balanceAfter, movement.inventoryItem.unit)}.`);
      onSaved();
      onClose();
    },
    onError: (err) => setError(errorMessage(err, 'Não foi possível registrar a entrada.')),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    save.mutate();
  }

  const unitLabel = item ? UNIT_LABEL[item.unit] : 'unidade';

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="lg"
      title="Nova entrada"
      description="Atualiza o saldo e o custo médio do insumo nesta unidade."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="stock-entry-form" loading={save.isPending}>
            Confirmar entrada
          </Button>
        </>
      }
    >
      <form id="stock-entry-form" onSubmit={submit} className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <ItemPicker items={activeItems} value={itemId} onChange={setItemId} />
        <CurrentBalance item={item} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={`Quantidade (${unitLabel})`}>
            <Input required inputMode="decimal" placeholder="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field label={`Custo por ${unitLabel} (R$)`}>
            <Input required inputMode="decimal" placeholder="0,00" value={cost} onChange={(e) => setCost(e.target.value)} />
          </Field>
          <Field label="Fornecedor (opcional)">
            <Input value={supplier} maxLength={120} onChange={(e) => setSupplier(e.target.value)} />
          </Field>
          <Field label="Nº do documento (opcional)" hint="Nota fiscal, pedido, recibo">
            <Input value={documentNumber} maxLength={60} onChange={(e) => setDocumentNumber(e.target.value)} />
          </Field>
          <Field label="Lote (opcional)">
            <Input value={lotCode} maxLength={60} onChange={(e) => setLotCode(e.target.value)} />
          </Field>
          <Field label={item?.tracksExpiry ? 'Validade (obrigatória)' : 'Validade (opcional)'}>
            <Input type="date" required={item?.tracksExpiry} value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
          </Field>
        </div>
        <Field label="Observação (opcional)">
          <Input value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} />
        </Field>
      </form>
    </Dialog>
  );
}

export function ExitDialog({ open, branchId, items, initialItemId, onClose, onSaved }: MovementDialogProps) {
  const { accessToken } = useAuth();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const activeItems = useActiveItems(items);
  const [itemId, setItemId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<StockExitReason>('CONSUMPTION');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState<string | null>(null);
  const item = activeItems.find((candidate) => candidate.id === itemId);

  useEffect(() => {
    if (!open) return;
    setItemId(initialItemId ?? '');
    setQuantity('');
    setReason('CONSUMPTION');
    setNotes('');
    setError(null);
  }, [open, initialItemId]);

  const save = useMutation({
    mutationFn: async () => {
      if (!branchId || !item) throw new Error('Selecione o insumo.');
      const qty = parseQuantity(quantity);
      if (qty === null || qty <= 0) throw new Error('Informe uma quantidade maior que zero (até 3 casas decimais).');
      if (reason === 'OTHER' && notes.trim().length < 3) throw new Error('Descreva o motivo na observação.');
      return inventoryApi.createMovement(accessToken as string, {
        type: 'EXIT',
        branchId,
        inventoryItemId: item.id,
        quantity: qty,
        exitReason: reason,
        notes: notes.trim() || undefined,
      });
    },
    onSuccess: (movement) => {
      toast.success(`Saída registrada: ${item?.name}. Saldo ${formatQuantity(movement.balanceAfter, movement.inventoryItem.unit)}.`);
      onSaved();
      onClose();
    },
    onError: (err) => setError(errorMessage(err, 'Não foi possível registrar a saída.')),
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
      title="Nova saída"
      description="Baixa manual de estoque. Vendas baixam automaticamente pela ficha técnica."
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button type="submit" form="stock-exit-form" variant="danger" loading={save.isPending}>
            Confirmar saída
          </Button>
        </>
      }
    >
      <form id="stock-exit-form" onSubmit={submit} className="space-y-3">
        {error && <Alert>{error}</Alert>}
        <ItemPicker items={activeItems} value={itemId} onChange={setItemId} />
        <CurrentBalance item={item} />
        <div className="grid grid-cols-2 gap-3">
          <Field label={`Quantidade (${item ? UNIT_LABEL[item.unit] : 'unidade'})`}>
            <Input required inputMode="decimal" placeholder="0" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </Field>
          <Field label="Motivo">
            <Select value={reason} onChange={(e) => setReason(e.target.value as StockExitReason)}>
              {EXIT_REASONS.map((value) => (
                <option key={value} value={value}>
                  {EXIT_REASON_LABEL[value]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <Field label={reason === 'OTHER' ? 'Observação (obrigatória)' : 'Observação (opcional)'}>
          <Input
            required={reason === 'OTHER'}
            maxLength={300}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Ex.: embalagem rompida no recebimento"
          />
        </Field>
      </form>
    </Dialog>
  );
}
