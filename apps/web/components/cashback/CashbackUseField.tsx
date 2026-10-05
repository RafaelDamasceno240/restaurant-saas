'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { PiggyBank } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { formatCents } from '@/lib/cash-api';
import { cashbackApi } from '@/lib/cashback-api';
import { maxUsableCashbackCents, validateCashbackToUse } from '@/lib/cashback-logic';
import { centsToInput } from '@/lib/coupons-logic';
import { Button } from '@/components/ds/Button';
import { Input } from '@/components/ds/Input';

// "Use the customer's cashback on this sale". Shown only when the program is on and the picked
// customer has balance. It only ever produces the AMOUNT the cashier asks for: the sale sends
// that amount and the API checks it against the customer's real balance and against what the
// items cost, inside the transaction that creates the order. The total shown on screen is a
// convenience, never an input.
export function CashbackUseField({
  customerId,
  itemsAfterDiscountCents,
  value,
  onChange,
  onMaxChange,
  disabled,
}: {
  customerId: string;
  // Items subtotal after the coupon, in cents: cashback never pays more than this.
  itemsAfterDiscountCents: number;
  value: string;
  onChange: (value: string) => void;
  // Tells the parent the most this sale may use (0 when cashback is unavailable).
  onMaxChange: (maxCents: number) => void;
  disabled?: boolean;
}) {
  const { accessToken } = useAuth();
  const account = useQuery({
    queryKey: ['cashback', 'account', customerId],
    queryFn: () => cashbackApi.getAccount(accessToken as string, customerId),
    enabled: !!accessToken,
    staleTime: 10_000,
  });

  const available = account.data?.program.enabled ? account.data.balanceCents : 0;
  const maxCents = maxUsableCashbackCents(itemsAfterDiscountCents, available);
  useEffect(() => onMaxChange(maxCents), [maxCents, onMaxChange]);

  if (!account.data || available <= 0) return null;

  const problem = validateCashbackToUse(value, maxCents);
  return (
    <div className="space-y-1.5 rounded-ctl border border-line bg-surface-2 p-2.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          <PiggyBank className="h-4 w-4 text-accent" aria-hidden />
          Cashback do cliente
        </span>
        <span className="tabular-nums text-muted-foreground">Saldo {formatCents(available)}</span>
      </div>
      <div className="flex gap-2">
        <Input
          placeholder="Usar (R$)"
          aria-label="Cashback a usar"
          inputMode="decimal"
          maxLength={12}
          value={value}
          disabled={disabled || maxCents === 0}
          onChange={(event) => onChange(event.target.value)}
        />
        <Button variant="outline" disabled={disabled || maxCents === 0} onClick={() => onChange(centsToInput(maxCents))}>
          Usar {formatCents(maxCents)}
        </Button>
      </div>
      {problem && value.trim() !== '' && <p className="text-xs text-warning">{problem}</p>}
    </div>
  );
}
