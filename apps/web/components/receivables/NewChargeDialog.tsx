'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { parseMoneyToCents } from '@/lib/coupons-logic';
import { ReceivableDetail, receivablesApi } from '@/lib/receivables-api';
import {
  addDaysToDateOnly,
  ChargeDraft,
  DEFAULT_DUE_IN_DAYS,
  formatDateOnly,
  formatMoney,
  localDateOnly,
  MAX_DESCRIPTION,
  MAX_FIRST_DUE_DAYS,
  MAX_INSTALLMENTS,
  previewInstallments,
  receivableErrorMessage,
  validateCharge,
} from '@/lib/receivables-logic';
import { useActiveBranch } from '@/lib/use-active-branch';
import { useKeyedAction } from '@/lib/use-keyed-action';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { Field, Input, Select } from '@/components/ds/Input';
import { Alert } from '@/components/ds/States';
import { CustomerPicker, PickedCustomer } from '@/components/customers/CustomerPicker';

const emptyDraft = (today: string): ChargeDraft => ({
  description: '',
  amount: '',
  installments: 1,
  firstDueDate: addDaysToDateOnly(today, DEFAULT_DUE_IN_DAYS),
});

// A debt that did not come from a sale of this system (the paper notebook's balance, an
// agreement). Management only. It is not checked against the customer's limit: the limit governs
// what the counter may sell on account.
export function NewChargeDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (receivable: ReceivableDetail) => void;
}) {
  const { accessToken } = useAuth();
  const { branchId } = useActiveBranch();
  const today = localDateOnly();
  const [customer, setCustomer] = useState<PickedCustomer | null>(null);
  const [draft, setDraft] = useState<ChargeDraft>(() => emptyDraft(today));
  const [error, setError] = useState<string | null>(null);

  const action = useKeyedAction(
    (input: { customerId: string; branchId: string; description: string; totalCents: number; installments: number; firstDueDate: string }, idempotencyKey) =>
      receivablesApi.create(accessToken as string, { ...input, idempotencyKey }),
  );
  const { reset } = action;

  useEffect(() => {
    if (!open) return;
    setCustomer(null);
    setDraft(emptyDraft(localDateOnly()));
    setError(null);
    reset();
  }, [open, reset]);

  function change(patch: Partial<ChargeDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    reset();
  }

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    const problem = validateCharge(draft, customer !== null, today);
    if (problem) {
      setError(problem);
      return;
    }
    if (!branchId) {
      setError('Selecione a unidade da dívida.');
      return;
    }
    setError(null);
    try {
      const created = await action.run({
        customerId: (customer as PickedCustomer).id,
        branchId,
        description: draft.description.trim(),
        totalCents: parseMoneyToCents(draft.amount) as number,
        installments: draft.installments,
        firstDueDate: draft.firstDueDate,
      });
      if (created) onCreated(created);
    } catch (err) {
      setError(
        receivableErrorMessage(
          err instanceof ApiError ? err.code : undefined,
          err instanceof Error && err.message ? err.message : 'Não foi possível lançar a dívida.',
        ),
      );
    }
  }

  const totalCents = parseMoneyToCents(draft.amount) ?? 0;
  const plan = previewInstallments(totalCents, draft);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Lançar dívida"
      description="Para dívidas que não vieram de uma venda do sistema. Vendas fiado são lançadas pelo PDV ou pela mesa."
      size="md"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={action.busy}>
            Cancelar
          </Button>
          <Button type="submit" form="new-charge-form" loading={action.busy} disabled={action.busy}>
            Lançar dívida
          </Button>
        </>
      }
    >
      <form id="new-charge-form" onSubmit={onSubmit} className="space-y-4" noValidate>
        {error && <Alert tone="danger">{error}</Alert>}
        <CustomerPicker
          value={customer}
          disabled={action.busy}
          label="Cliente"
          onChange={(picked) => {
            setCustomer(picked);
            reset();
          }}
        />
        <Field label="Descrição">
          <Input
            placeholder="Ex.: saldo do caderno até setembro"
            maxLength={MAX_DESCRIPTION}
            value={draft.description}
            disabled={action.busy}
            onChange={(event) => change({ description: event.target.value })}
          />
        </Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Valor (R$)">
            <Input
              inputMode="decimal"
              maxLength={12}
              placeholder="0,00"
              value={draft.amount}
              disabled={action.busy}
              onChange={(event) => change({ amount: event.target.value })}
            />
          </Field>
          <Field label="Parcelas">
            <Select value={draft.installments} disabled={action.busy} onChange={(event) => change({ installments: Number(event.target.value) })}>
              {Array.from({ length: MAX_INSTALLMENTS }, (_, index) => index + 1).map((count) => (
                <option key={count} value={count}>
                  {count}x
                </option>
              ))}
            </Select>
          </Field>
          <Field label="1º vencimento">
            <Input
              type="date"
              min={today}
              max={addDaysToDateOnly(today, MAX_FIRST_DUE_DAYS)}
              value={draft.firstDueDate}
              disabled={action.busy}
              onChange={(event) => change({ firstDueDate: event.target.value })}
            />
          </Field>
        </div>
        {plan.length > 0 && (
          <ul className="divide-y divide-line rounded-ctl border border-line text-sm">
            {plan.map((item) => (
              <li key={item.number} className="flex items-center justify-between px-3 py-1.5">
                <span className="text-muted-foreground">
                  {item.number}/{plan.length} · vence {formatDateOnly(item.dueDate)}
                </span>
                <span className="font-medium tabular-nums text-foreground">{formatMoney(item.amountCents)}</span>
              </li>
            ))}
          </ul>
        )}
      </form>
    </Dialog>
  );
}
