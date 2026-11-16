'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Undo2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { formatCents } from '@/lib/cash-api';
import { cashbackApi, CashbackEntry } from '@/lib/cashback-api';
import {
  CASHBACK_ENTRY_LABEL,
  CASHBACK_ENTRY_TONE,
  CashbackAdjustDraft,
  cashbackAdjustCents,
  cashbackErrorMessage,
  describeCashbackEntry,
  describeProgram,
  EMPTY_CASHBACK_ADJUST,
  formatSignedCents,
  isCashbackReversible,
  MAX_REASON,
  validateCashbackAdjust,
  validateCashbackReason,
} from '@/lib/cashback-logic';
import { useKeyedAction } from '@/lib/use-keyed-action';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Field, Input, Select } from '@/components/ds/Input';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { StatCard } from '@/components/ds/StatCard';
import { useToast } from '@/components/ds/Toast';

// The API decides (cashback.read / cashback.adjust); this only hides what would be refused.
const CAN_ADJUST = ['OWNER', 'ADMIN', 'MANAGER'];

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}
const formatDate = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

const messageOf = (error: unknown, fallback: string) =>
  cashbackErrorMessage(error instanceof ApiError ? error.code : undefined, error instanceof Error && error.message ? error.message : fallback);

// Cashback of one customer: available balance, administrative adjustment and the statement.
// Spending it happens on a sale (PDV, table checkout), not here. Every number shown comes from
// the API; this component computes nothing about the balance.
export function CustomerCashbackPanel({ customerId }: { customerId: string }) {
  const { accessToken, user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canAdjust = (user?.roles ?? []).some((role) => CAN_ADJUST.includes(role));

  const [page, setPage] = useState(1);
  const [adjust, setAdjust] = useState<CashbackAdjustDraft>(EMPTY_CASHBACK_ADJUST);
  const [reversing, setReversing] = useState<{ entry: CashbackEntry; reason: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
    setAdjust(EMPTY_CASHBACK_ADJUST);
    setReversing(null);
    setError(null);
  }, [customerId]);

  const account = useQuery({
    queryKey: ['cashback', 'account', customerId],
    queryFn: () => cashbackApi.getAccount(accessToken as string, customerId),
    enabled: !!accessToken,
  });
  const entries = useQuery({
    queryKey: ['cashback', 'entries', customerId, page],
    queryFn: () => cashbackApi.listEntries(accessToken as string, customerId, page),
    enabled: !!accessToken,
    placeholderData: (previous) => previous,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['cashback'] });

  const adjustAction = useKeyedAction((input: { amountCents: number; reason: string }, idempotencyKey) =>
    cashbackApi.adjust(accessToken as string, customerId, { ...input, idempotencyKey }),
  );
  const reverseAction = useKeyedAction((input: { entryId: string; reason: string }, idempotencyKey) =>
    cashbackApi.reverse(accessToken as string, input.entryId, { reason: input.reason, idempotencyKey }),
  );
  const busy = adjustAction.busy || reverseAction.busy;

  async function onAdjust(event: FormEvent) {
    event.preventDefault();
    const problem = validateCashbackAdjust(adjust, account.data?.balanceCents ?? 0);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      const entry = await adjustAction.run({ amountCents: cashbackAdjustCents(adjust), reason: adjust.reason.trim() });
      if (!entry) return;
      toast.success(`Ajuste lançado: ${formatSignedCents(entry.amountCents)}.`);
      setAdjust(EMPTY_CASHBACK_ADJUST);
      await refresh();
    } catch (err) {
      setError(messageOf(err, 'Não foi possível lançar o ajuste.'));
      await refresh();
    }
  }

  async function onReverse(event: FormEvent) {
    event.preventDefault();
    if (!reversing) return;
    const problem = validateCashbackReason(reversing.reason);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      const entry = await reverseAction.run({ entryId: reversing.entry.id, reason: reversing.reason.trim() });
      if (!entry) return;
      toast.success('Movimentação estornada.');
      setReversing(null);
      await refresh();
    } catch (err) {
      setError(messageOf(err, 'Não foi possível estornar a movimentação.'));
      await refresh();
    }
  }

  if (account.isPending) return <LoadingState label="Carregando cashback..." />;
  if (account.isError || !account.data) {
    return <ErrorState message="Não foi possível carregar o cashback do cliente." onRetry={() => void account.refetch()} />;
  }

  const { balanceCents, expiredPendingCents, expiresAt, program } = account.data;

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard
          label="Saldo disponível"
          value={formatCents(balanceCents)}
          hint={expiresAt ? `Expira em ${formatDate(expiresAt)} se não houver compra nem uso` : undefined}
          featured
        />
        <StatCard
          label="Cashback"
          value={<span className="text-lg">{program.enabled ? 'Ativo' : 'Desativado'}</span>}
          hint={program.enabled ? describeProgram(program) : 'Compras não geram cashback'}
        />
      </div>

      {expiredPendingCents > 0 && (
        <Alert tone="warning">
          {formatCents(expiredPendingCents)} deste cliente já expiraram por falta de movimentação e não podem mais ser usados. A baixa
          aparece no extrato na próxima movimentação.
        </Alert>
      )}
      {!program.enabled && <Alert tone="info">O cashback está desativado: compras não geram saldo e o saldo não pode ser usado.</Alert>}
      {error && <Alert tone="danger">{error}</Alert>}

      <p className="text-sm text-muted-foreground">
        O saldo é usado no <strong className="font-medium text-foreground">PDV</strong> ou no fechamento da mesa, com o cliente
        selecionado. Se o pedido for cancelado, o valor usado volta para o cliente.
      </p>

      {canAdjust && (
        <section aria-label="Ajuste administrativo" className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Ajuste administrativo</h3>
          <form onSubmit={onAdjust} className="grid gap-2 sm:grid-cols-[9rem_8rem_minmax(0,1fr)_auto]" noValidate>
            <Select
              aria-label="Tipo de ajuste"
              value={adjust.direction}
              disabled={busy}
              onChange={(event) => {
                setAdjust({ ...adjust, direction: event.target.value as CashbackAdjustDraft['direction'] });
                adjustAction.reset();
              }}
            >
              <option value="credit">Creditar</option>
              <option value="debit">Debitar</option>
            </Select>
            <Input
              aria-label="Valor do ajuste"
              placeholder="Valor (R$)"
              inputMode="decimal"
              maxLength={12}
              value={adjust.amount}
              disabled={busy}
              onChange={(event) => {
                setAdjust({ ...adjust, amount: event.target.value });
                adjustAction.reset();
              }}
            />
            <Input
              aria-label="Motivo do ajuste"
              placeholder="Motivo (obrigatório)"
              maxLength={MAX_REASON}
              value={adjust.reason}
              disabled={busy}
              onChange={(event) => {
                setAdjust({ ...adjust, reason: event.target.value });
                adjustAction.reset();
              }}
            />
            <Button type="submit" variant="outline" loading={adjustAction.busy} disabled={busy}>
              Lançar
            </Button>
          </form>
        </section>
      )}

      <section aria-label="Extrato de cashback" className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Extrato</h3>
        {entries.isPending ? (
          <LoadingState label="Carregando extrato..." />
        ) : entries.isError ? (
          <ErrorState message="Não foi possível carregar o extrato." onRetry={() => void entries.refetch()} />
        ) : entries.data.data.length === 0 ? (
          <EmptyState title="Nenhuma movimentação" description="Cashback de compras, usos e ajustes aparecem aqui." />
        ) : (
          <>
            <ul className="divide-y divide-line rounded-ctl border border-line">
              {entries.data.data.map((entry) => (
                <li key={entry.id} className="space-y-2 px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={CASHBACK_ENTRY_TONE[entry.type]}>{CASHBACK_ENTRY_LABEL[entry.type]}</Badge>
                        <span className={entry.reversed ? 'text-sm text-muted-foreground line-through' : 'text-sm text-foreground'}>
                          {describeCashbackEntry(entry)}
                        </span>
                        {entry.reversed && <Badge tone="neutral">Estornado</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDateTime(entry.createdAt)}
                        {entry.createdBy ? ` · ${entry.createdBy.name}` : ''} · saldo {formatCents(entry.balanceAfterCents)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          entry.amountCents > 0
                            ? 'text-sm font-semibold tabular-nums text-success'
                            : 'text-sm font-semibold tabular-nums text-foreground'
                        }
                      >
                        {formatSignedCents(entry.amountCents)}
                      </span>
                      {canAdjust && isCashbackReversible(entry) && reversing?.entry.id !== entry.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Undo2 className="h-4 w-4" aria-hidden />}
                          disabled={busy}
                          aria-label={`Estornar ${CASHBACK_ENTRY_LABEL[entry.type].toLowerCase()} de ${formatCents(Math.abs(entry.amountCents))}`}
                          onClick={() => {
                            reverseAction.reset();
                            setError(null);
                            setReversing({ entry, reason: '' });
                          }}
                        >
                          Estornar
                        </Button>
                      )}
                    </div>
                  </div>
                  {reversing?.entry.id === entry.id && (
                    <form onSubmit={onReverse} className="flex flex-col gap-2 sm:flex-row" noValidate>
                      <div className="min-w-0 flex-1">
                        <Field label="Motivo do estorno">
                          <Input
                            autoFocus
                            maxLength={MAX_REASON}
                            value={reversing.reason}
                            disabled={busy}
                            onChange={(event) => setReversing({ entry, reason: event.target.value })}
                          />
                        </Field>
                      </div>
                      <div className="flex items-end gap-2">
                        <Button type="submit" variant="danger" size="sm" loading={reverseAction.busy} disabled={busy}>
                          Confirmar estorno
                        </Button>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setReversing(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            {entries.data.meta.totalPages > 1 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Página {entries.data.meta.page} de {entries.data.meta.totalPages} · {entries.data.meta.total} movimentações
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Anterior
                  </Button>
                  <Button size="sm" variant="outline" disabled={page >= entries.data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
                    Próxima
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
