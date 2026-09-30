'use client';

import { useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from '@tanstack/react-query';
import { PackageCheck, Plus, Trash2, Users } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { formatCents } from '@/lib/cash-api';
import { InventoryItem, UNIT_LABEL } from '@/lib/inventory-api';
import { PurchaseDetail, PurchaseInput, purchasesApi } from '@/lib/purchases-api';
import { costToCents, previewTotals, quantityToMilli, todayIso } from '@/lib/purchases-logic';
import { useActiveBranch } from '@/lib/use-active-branch';
import { Button } from '@/components/ds/Button';
import { Card, CardHeader } from '@/components/ds/Card';
import { Dialog } from '@/components/ds/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ds/Input';
import { Alert, LoadingState } from '@/components/ds/States';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { useToast } from '@/components/ds/Toast';
import { useEstoque } from '@/components/estoque/EstoqueProvider';
import { useErrorMessage, useInventoryItems, useRefreshInventory } from '@/components/estoque/use-inventory';
import { SuppliersDialog } from './SuppliersDialog';
import { useSuppliers } from './use-purchases';

interface LineDraft {
  key: number;
  inventoryItemId: string;
  quantity: string;
  unitCost: string;
  lotCode: string;
  expiresAt: string;
}

const emptyLine = (key: number): LineDraft => ({ key, inventoryItemId: '', quantity: '', unitCost: '', lotCode: '', expiresAt: '' });

function centsToInput(cents: number): string {
  return cents === 0 ? '' : (cents / 100).toFixed(2).replace('.', ',');
}

function linesFrom(purchase: PurchaseDetail | undefined): LineDraft[] {
  if (!purchase) return [emptyLine(1)];
  return purchase.items.map((item, index) => ({
    key: index + 1,
    inventoryItemId: item.inventoryItem.id,
    quantity: String(item.quantity).replace('.', ','),
    unitCost: (item.unitCostCents / 100).toFixed(2).replace('.', ','),
    lotCode: item.lotCode ?? '',
    expiresAt: item.expiresAt ? item.expiresAt.slice(0, 10) : '',
  }));
}

export function PurchaseForm({ purchase }: { purchase?: PurchaseDetail }) {
  const router = useRouter();
  const { accessToken } = useAuth();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const refresh = useRefreshInventory();
  const { branchId } = useEstoque();
  const { branches } = useActiveBranch();
  const itemsQuery = useInventoryItems(branchId);
  const suppliersQuery = useSuppliers(false);
  const editing = purchase !== undefined;
  const lineCounter = useRef(purchase ? purchase.items.length : 1);
  const submitting = useRef(false);

  const [supplierId, setSupplierId] = useState(purchase?.supplier.id ?? '');
  const [purchaseDate, setPurchaseDate] = useState(purchase ? purchase.purchaseDate.slice(0, 10) : todayIso());
  const [notes, setNotes] = useState(purchase?.notes ?? '');
  const [discount, setDiscount] = useState(centsToInput(purchase?.discountCents ?? 0));
  const [freight, setFreight] = useState(centsToInput(purchase?.freightCents ?? 0));
  const [otherCosts, setOtherCosts] = useState(centsToInput(purchase?.otherCostsCents ?? 0));
  const [lines, setLines] = useState<LineDraft[]>(() => linesFrom(purchase));
  const [error, setError] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [suppliersOpen, setSuppliersOpen] = useState(false);

  const activeItems = useMemo(() => (itemsQuery.data ?? []).filter((item) => item.active), [itemsQuery.data]);
  const itemById = useMemo(() => new Map<string, InventoryItem>((itemsQuery.data ?? []).map((item) => [item.id, item])), [itemsQuery.data]);
  const suppliers = useMemo(() => {
    const list = suppliersQuery.data ?? [];
    if (purchase && !list.some((supplier) => supplier.id === purchase.supplier.id)) {
      return [{ id: purchase.supplier.id, name: `${purchase.supplier.name} (inativo)` }, ...list];
    }
    return list;
  }, [suppliersQuery.data, purchase]);
  const branchName = branches.find((branch) => branch.id === branchId)?.name ?? purchase?.branch.name ?? '';

  const adjustments = {
    discountCents: costToCents(discount || '0') ?? 0,
    freightCents: costToCents(freight || '0') ?? 0,
    otherCostsCents: costToCents(otherCosts || '0') ?? 0,
  };
  const totals = previewTotals(lines, adjustments);

  function updateLine(key: number, patch: Partial<LineDraft>) {
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  }

  function addLine() {
    lineCounter.current += 1;
    setLines((current) => [...current, emptyLine(lineCounter.current)]);
  }

  function removeLine(key: number) {
    setLines((current) => (current.length === 1 ? current : current.filter((line) => line.key !== key)));
  }

  function buildInput(): PurchaseInput {
    if (!supplierId) throw new Error('Selecione o fornecedor.');
    if (!purchaseDate) throw new Error('Informe a data da compra.');
    if (costToCents(discount || '0') === null || costToCents(freight || '0') === null || costToCents(otherCosts || '0') === null) {
      throw new Error('Desconto, frete e outros custos devem ser valores em reais (ex.: 12,50).');
    }
    const items = lines.map((line, index) => {
      const number = index + 1;
      const item = itemById.get(line.inventoryItemId);
      if (!item) throw new Error(`Item ${number}: selecione o insumo.`);
      const milli = quantityToMilli(line.quantity);
      if (milli === null || milli <= 0) throw new Error(`Item ${number}: informe uma quantidade maior que zero (até 3 casas).`);
      const unitCostCents = costToCents(line.unitCost);
      if (unitCostCents === null) throw new Error(`Item ${number}: informe o custo unitário (ex.: 32,50).`);
      if (item.tracksExpiry && !line.expiresAt) throw new Error(`Item ${number}: "${item.name}" controla validade, informe a data.`);
      return {
        inventoryItemId: item.id,
        quantity: milli / 1000,
        unitCostCents,
        lotCode: line.lotCode.trim() || undefined,
        expiresAt: line.expiresAt || undefined,
      };
    });
    if (totals.totalCents < 0) throw new Error('O desconto não pode ser maior que a soma dos itens, frete e outros custos.');
    return {
      supplierId,
      purchaseDate,
      notes: notes.trim() || undefined,
      ...adjustments,
      items,
    };
  }

  const save = useMutation({
    mutationFn: async ({ receive }: { receive: boolean }) => {
      const input = buildInput();
      if (!branchId) throw new Error('Selecione a unidade.');
      const token = accessToken as string;
      if (!editing) return purchasesApi.create(token, { ...input, branchId, receiveNow: receive });
      const updated = await purchasesApi.update(token, purchase.id, input);
      return receive ? purchasesApi.receive(token, updated.id) : updated;
    },
    onSuccess: (result, variables) => {
      toast.success(
        variables.receive ? `${result.purchaseNumber} recebida. Estoque atualizado.` : `${result.purchaseNumber} salva como rascunho.`,
      );
      void refresh();
      router.push(`/dashboard/estoque/compras/${result.id}`);
    },
    onError: (err) => {
      setConfirmOpen(false);
      setError(errorMessage(err, 'Não foi possível salvar a compra.'));
      void refresh();
    },
    onSettled: () => {
      submitting.current = false;
    },
  });

  function submit(receive: boolean) {
    if (submitting.current) return;
    setError(null);
    try {
      buildInput();
    } catch (err) {
      setConfirmOpen(false);
      setError(err instanceof Error ? err.message : 'Revise os dados da compra.');
      return;
    }
    submitting.current = true;
    save.mutate({ receive });
  }

  function askReceive() {
    setError(null);
    try {
      buildInput();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Revise os dados da compra.');
      return;
    }
    setConfirmOpen(true);
  }

  if (!branchId || itemsQuery.isPending || suppliersQuery.isPending) {
    return <LoadingState label="Carregando..." />;
  }

  const supplierName = suppliers.find((supplier) => supplier.id === supplierId)?.name ?? '';
  const pending = save.isPending;

  return (
    <div className="space-y-4">
      {error && <Alert tone="danger">{error}</Alert>}

      <Card>
        <CardHeader title="Dados da compra" description={`Unidade: ${branchName}`} />
        <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="Fornecedor" className="lg:col-span-2">
            <div className="flex gap-2">
              <div className="min-w-0 flex-1">
                <Select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} aria-label="Fornecedor">
                  <option value="">Selecione...</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </Select>
              </div>
              <Button variant="outline" icon={<Users className="h-4 w-4" aria-hidden />} onClick={() => setSuppliersOpen(true)}>
                Fornecedores
              </Button>
            </div>
          </Field>
          <Field label="Data da compra">
            <Input type="date" value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
          </Field>
          <Field label="Unidade">
            <Input value={branchName} readOnly aria-readonly />
          </Field>
          <Field label="Observações" className="sm:col-span-2 lg:col-span-4">
            <Textarea value={notes} rows={2} maxLength={500} onChange={(e) => setNotes(e.target.value)} />
          </Field>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Itens"
          description="A quantidade usa a unidade de estoque do insumo. O total é recalculado pelo servidor ao salvar."
          action={
            <Button size="sm" variant="outline" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={addLine}>
              Adicionar item
            </Button>
          }
        />
        <TableWrap>
          <Table className="min-w-[980px]">
            <THead>
              <Tr className="hover:bg-transparent">
                <Th className="w-[26%]">Insumo</Th>
                <Th className="w-[13%]">Quantidade</Th>
                <Th className="w-[13%]">Custo unitário (R$)</Th>
                <Th className="w-[14%]">Lote</Th>
                <Th className="w-[15%]">Validade</Th>
                <Th className="w-[12%] text-right">Total</Th>
                <Th className="relative w-[7%]">
                  <span className="sr-only">Remover</span>
                </Th>
              </Tr>
            </THead>
            <TBody>
              {lines.map((line, index) => {
                const item = itemById.get(line.inventoryItemId);
                const lineTotal = totals.lineTotals[index];
                return (
                  <Tr key={line.key}>
                    <Td>
                      <Select
                        aria-label={`Insumo do item ${index + 1}`}
                        value={line.inventoryItemId}
                        onChange={(e) => updateLine(line.key, { inventoryItemId: e.target.value })}
                      >
                        <option value="">Selecione...</option>
                        {activeItems.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name} ({UNIT_LABEL[candidate.unit]})
                          </option>
                        ))}
                        {item && !item.active && <option value={item.id}>{item.name} (inativo)</option>}
                      </Select>
                    </Td>
                    <Td>
                      <div className="flex items-center gap-1.5">
                        <Input
                          inputMode="decimal"
                          aria-label={`Quantidade do item ${index + 1}`}
                          value={line.quantity}
                          onChange={(e) => updateLine(line.key, { quantity: e.target.value })}
                          placeholder="0"
                        />
                        <span className="w-7 shrink-0 text-xs text-muted-foreground">{item ? UNIT_LABEL[item.unit] : ''}</span>
                      </div>
                    </Td>
                    <Td>
                      <Input
                        inputMode="decimal"
                        aria-label={`Custo unitário do item ${index + 1}`}
                        value={line.unitCost}
                        onChange={(e) => updateLine(line.key, { unitCost: e.target.value })}
                        placeholder="0,00"
                      />
                    </Td>
                    <Td>
                      <Input
                        aria-label={`Lote do item ${index + 1}`}
                        value={line.lotCode}
                        maxLength={60}
                        onChange={(e) => updateLine(line.key, { lotCode: e.target.value })}
                      />
                    </Td>
                    <Td>
                      <Input
                        type="date"
                        aria-label={`Validade do item ${index + 1}`}
                        aria-required={item?.tracksExpiry}
                        value={line.expiresAt}
                        onChange={(e) => updateLine(line.key, { expiresAt: e.target.value })}
                      />
                      {item?.tracksExpiry && <span className="mt-0.5 block text-2xs text-warning">Obrigatória</span>}
                    </Td>
                    <Td className="text-right font-medium tabular-nums">{lineTotal === null ? '—' : formatCents(lineTotal)}</Td>
                    <Td>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Remover item ${index + 1}`}
                        disabled={lines.length === 1}
                        onClick={() => removeLine(line.key)}
                        icon={<Trash2 className="h-4 w-4" aria-hidden />}
                      />
                    </Td>
                  </Tr>
                );
              })}
            </TBody>
          </Table>
        </TableWrap>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="hidden lg:block" />
        <Card>
          <CardHeader title="Resumo" />
          <div className="space-y-2.5 p-4 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Subtotal</span>
              <span className="font-medium tabular-nums">{formatCents(totals.subtotalCents)}</span>
            </div>
            <Field label="Desconto (R$)">
              <Input inputMode="decimal" value={discount} onChange={(e) => setDiscount(e.target.value)} placeholder="0,00" />
            </Field>
            <Field label="Frete (R$)">
              <Input inputMode="decimal" value={freight} onChange={(e) => setFreight(e.target.value)} placeholder="0,00" />
            </Field>
            <Field label="Outros custos (R$)">
              <Input inputMode="decimal" value={otherCosts} onChange={(e) => setOtherCosts(e.target.value)} placeholder="0,00" />
            </Field>
            <div className="flex items-baseline justify-between border-t border-line pt-3">
              <span className="font-semibold text-foreground">Total</span>
              <span className="text-xl font-semibold tabular-nums text-accent">{formatCents(totals.totalCents)}</span>
            </div>
            <p className="text-2xs text-subtle">Frete, desconto e outros custos ficam no total da compra; o custo do estoque usa o custo unitário dos itens.</p>
          </div>
        </Card>
      </div>

      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" onClick={() => router.back()} disabled={pending}>
          Cancelar
        </Button>
        <Button variant="outline" onClick={() => submit(false)} loading={pending && !confirmOpen} disabled={pending}>
          {editing ? 'Salvar alterações' : 'Salvar rascunho'}
        </Button>
        <Button icon={<PackageCheck className="h-4 w-4" aria-hidden />} onClick={askReceive} disabled={pending}>
          Salvar e receber
        </Button>
      </div>

      <Dialog
        open={confirmOpen}
        onClose={() => (pending ? undefined : setConfirmOpen(false))}
        title="Receber esta compra?"
        size="sm"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={pending}>
              Voltar
            </Button>
            <Button icon={<PackageCheck className="h-4 w-4" aria-hidden />} loading={pending} onClick={() => submit(true)}>
              Receber e atualizar estoque
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">Receber esta compra irá adicionar os itens ao estoque da unidade selecionada.</p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-ctl border border-line bg-surface-2 p-3 text-sm">
            <dt className="text-muted-foreground">Fornecedor</dt>
            <dd className="text-right font-medium text-foreground">{supplierName}</dd>
            <dt className="text-muted-foreground">Unidade</dt>
            <dd className="text-right font-medium text-foreground">{branchName}</dd>
            <dt className="text-muted-foreground">Itens</dt>
            <dd className="text-right font-medium text-foreground">{lines.length}</dd>
            <dt className="text-muted-foreground">Valor</dt>
            <dd className="text-right font-medium text-foreground">{formatCents(totals.totalCents)}</dd>
          </dl>
        </div>
      </Dialog>

      <SuppliersDialog open={suppliersOpen} onClose={() => setSuppliersOpen(false)} />
    </div>
  );
}
