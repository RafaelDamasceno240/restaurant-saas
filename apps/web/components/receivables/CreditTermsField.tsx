'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { NotebookPen } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { receivablesApi } from '@/lib/receivables-api';
import {
  addDaysToDateOnly,
  creditBlockReason,
  formatDateOnly,
  formatMoney,
  localDateOnly,
  MAX_FIRST_DUE_DAYS,
  MAX_INSTALLMENTS,
  previewInstallments,
  TermsDraft,
  validateTerms,
} from '@/lib/receivables-logic';
import { Input, Select } from '@/components/ds/Input';

// "Put this sale on the customer's account". Shows what the customer may still buy on account
// and collects how it will be paid back (installments, first due date). It only produces the
// TERMS: whether the sale fits the limit is decided by the API, against the locked account, in
// the transaction that creates the order. What is shown here can be stale by then.
export function CreditTermsField({
  customerId,
  totalCents,
  value,
  onChange,
  onBlockChange,
  disabled,
}: {
  customerId: string;
  // What would go on account: the sale total after coupon and cashback, in cents.
  totalCents: number;
  value: TermsDraft;
  onChange: (value: TermsDraft) => void;
  // Tells the parent why the sale cannot be confirmed on account right now (null = it can).
  onBlockChange: (reason: string | null) => void;
  disabled?: boolean;
}) {
  const { accessToken } = useAuth();
  const account = useQuery({
    queryKey: ['receivables', 'account', customerId],
    queryFn: () => receivablesApi.getAccount(accessToken as string, customerId),
    enabled: !!accessToken,
    staleTime: 10_000,
  });

  const today = localDateOnly();
  const reason = account.isError
    ? 'Não foi possível consultar o fiado deste cliente.'
    : !account.data
      ? 'Consultando o fiado do cliente...'
      : (creditBlockReason(account.data, totalCents) ?? validateTerms(value, totalCents, today));
  useEffect(() => onBlockChange(reason), [reason, onBlockChange]);

  const plan = previewInstallments(totalCents, value);

  return (
    <div className="space-y-2 rounded-ctl border border-line bg-surface-2 p-2.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <NotebookPen className="h-4 w-4 text-accent" aria-hidden />
          Fiado do cliente
        </span>
        {account.data && (
          <span className="tabular-nums text-muted-foreground">
            Disponível {formatMoney(account.data.availableCents)} de {formatMoney(account.data.creditLimitCents)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1 text-xs text-muted-foreground">
          Parcelas
          <Select
            aria-label="Parcelas do fiado"
            value={value.installments}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, installments: Number(event.target.value) })}
          >
            {Array.from({ length: MAX_INSTALLMENTS }, (_, index) => index + 1).map((count) => (
              <option key={count} value={count}>
                {count}x
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-xs text-muted-foreground">
          1º vencimento
          <Input
            type="date"
            aria-label="Primeiro vencimento"
            value={value.firstDueDate}
            min={today}
            max={addDaysToDateOnly(today, MAX_FIRST_DUE_DAYS)}
            disabled={disabled}
            onChange={(event) => onChange({ ...value, firstDueDate: event.target.value })}
          />
        </label>
      </div>

      {plan.length > 1 && !reason && (
        <p className="text-xs text-muted-foreground">
          {plan.length}x de {formatMoney(plan[plan.length - 1].amountCents)}
          {plan[0].amountCents !== plan[plan.length - 1].amountCents ? ` (1ª de ${formatMoney(plan[0].amountCents)})` : ''}, de{' '}
          {formatDateOnly(plan[0].dueDate)} a {formatDateOnly(plan[plan.length - 1].dueDate)}
        </p>
      )}
      {reason && (
        <p role="alert" className="text-xs text-warning">
          {reason}
        </p>
      )}
    </div>
  );
}
