'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Undo2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { centsToInput, parseMoneyToCents } from '@/lib/coupons-logic';
import { formatPhone } from '@/lib/customers-logic';
import { ReceivableDetail, ReceivableEntry, ReceivablePaymentMethod, receivablesApi } from '@/lib/receivables-api';
import {
  describeReceivableEntry,
  formatDateOnly,
  formatMoney,
  formatSignedMoney,
  isPaymentReversible,
  MAX_REASON,
  RECEIVABLE_ENTRY_LABEL,
  RECEIVABLE_ENTRY_TONE,
  RECEIVABLE_METHOD_LABEL,
  RECEIVABLE_PAYMENT_METHODS,
  receivableBadge,
  receivableErrorMessage,
  validatePayment,
  validateReason,
} from '@/lib/receivables-logic';
import { useActiveBranch } from '@/lib/use-active-branch';
import { useKeyedAction } from '@/lib/use-keyed-action';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { Field, Input, Select } from '@/components/ds/Input';
import { Alert, ErrorState, LoadingState } from '@/components/ds/States';
import { StatCard } from '@/components/ds/StatCard';
import { useToast } from '@/components/ds/Toast';

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const messageOf = (error: unknown, fallback: string) =>
  receivableErrorMessage(error instanceof ApiError ? error.code : undefined, error instanceof Error && error.message ? error.message : fallback);

interface PaymentDraft {
  amount: string;
  method: ReceivablePaymentMethod;
  // '' = spread over the installments, the one due first paid first.
  installmentId: string;
}
const EMPTY_PAYMENT: PaymentDraft = { amount: '', method: 'PIX', installmentId: '' };

// One receivable: installments, what was paid, the full history, and the operations on it
// (receive, reverse a payment, cancel). Every number comes from the API; after each operation
// the screen is rebuilt from the API's answer.
export function ReceivableDetailDialog({
  receivableId,
  canReceive,
  canManage,
  onClose,
}: {
  receivableId: string | null;
  canReceive: boolean;
  canManage: boolean;
  onClose: () => void;
}) {
  const { accessToken } = useAuth();
  const { branchId } = useActiveBranch();
  const toast = useToast();
  const queryClient = useQueryClient();
  const open = receivableId !== null;

  const [payment, setPayment] = useState<PaymentDraft>(EMPTY_PAYMENT);
  const [reversing, setReversing] = useState<{ entry: ReceivableEntry; reason: string } | null>(null);
  const [cancelReason, setCancelReason] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPayment(EMPTY_PAYMENT);
    setReversing(null);
    setCancelReason(null);
    setError(null);
  }, [receivableId]);

  const detail = useQuery({
    queryKey: ['receivables', 'detail', receivableId],
    queryFn: () => receivablesApi.get(accessToken as string, receivableId as string),
    enabled: open && !!accessToken,
  });

  const refresh = async (fresh?: ReceivableDetail) => {
    if (fresh) queryClient.setQueryData(['receivables', 'detail', fresh.id], fresh);
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['receivables'] }),
      // A cash receipt or refund moves the open cash session.
      queryClient.invalidateQueries({ queryKey: ['cash-current'] }),
    ]);
  };

  const payAction = useKeyedAction(
    (input: { id: string; amountCents: number; method: ReceivablePaymentMethod; branchId: string; installmentId?: string }, idempotencyKey) =>
      receivablesApi.pay(accessToken as string, input.id, {
        amountCents: input.amountCents,
        method: input.method,
        branchId: input.branchId,
        ...(input.installmentId ? { installmentId: input.installmentId } : {}),
        idempotencyKey,
      }),
  );
  const reverseAction = useKeyedAction((input: { entryId: string; reason: string; branchId?: string }, idempotencyKey) =>
    receivablesApi.reversePayment(accessToken as string, input.entryId, {
      reason: input.reason,
      ...(input.branchId ? { branchId: input.branchId } : {}),
      idempotencyKey,
    }),
  );
  const [cancelling, setCancelling] = useState(false);
  const busy = payAction.busy || reverseAction.busy || cancelling;

  const receivable = detail.data;
  const payable = receivable
    ? payment.installmentId
      ? (receivable.installments.find((installment) => installment.id === payment.installmentId)?.openCents ?? 0)
      : receivable.openCents
    : 0;

  async function onPay(event: FormEvent) {
    event.preventDefault();
    if (!receivable) return;
    if (!branchId) {
      setError('Selecione a unidade em que o pagamento está sendo recebido.');
      return;
    }
    const problem = validatePayment(payment.amount, payable);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      const result = await payAction.run({
        id: receivable.id,
        amountCents: parseMoneyToCents(payment.amount) as number,
        method: payment.method,
        branchId,
        installmentId: payment.installmentId || undefined,
      });
      if (!result) return;
      toast.success(result.status === 'PAID' ? 'Pagamento registrado: conta quitada.' : 'Pagamento registrado.');
      setPayment({ ...EMPTY_PAYMENT, method: payment.method });
      await refresh(result);
    } catch (err) {
      setError(messageOf(err, 'Não foi possível registrar o pagamento.'));
      await refresh();
    }
  }

  async function onReverse(event: FormEvent) {
    event.preventDefault();
    if (!reversing) return;
    const problem = validateReason(reversing.reason);
    if (problem) {
      setError(problem);
      return;
    }
    const isCash = reversing.entry.paymentMethod === 'CASH';
    if (isCash && !branchId) {
      setError('Selecione a unidade: o estorno de dinheiro sai do caixa aberto.');
      return;
    }
    setError(null);
    try {
      const result = await reverseAction.run({
        entryId: reversing.entry.id,
        reason: reversing.reason.trim(),
        branchId: isCash ? (branchId as string) : undefined,
      });
      if (!result) return;
      toast.success('Pagamento estornado.');
      setReversing(null);
      await refresh(result);
    } catch (err) {
      setError(messageOf(err, 'Não foi possível estornar o pagamento.'));
      await refresh();
    }
  }

  async function onCancel(event: FormEvent) {
    event.preventDefault();
    if (!receivable || cancelReason === null || cancelling) return;
    const problem = validateReason(cancelReason);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    setCancelling(true);
    try {
      const result = await receivablesApi.cancel(accessToken as string, receivable.id, cancelReason.trim());
      toast.success('Conta cancelada.');
      setCancelReason(null);
      await refresh(result);
    } catch (err) {
      setError(messageOf(err, 'Não foi possível cancelar a conta.'));
      await refresh();
    } finally {
      setCancelling(false);
    }
  }

  const badge = receivable ? receivableBadge(receivable) : null;
  const isOpen = receivable?.status === 'OPEN';
  const openInstallments = receivable?.installments.filter((installment) => installment.openCents > 0) ?? [];

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={receivable ? receivable.customer.name : 'Conta a receber'}
      description={receivable ? `${formatPhone(receivable.customer.phone)} · ${receivable.description}` : undefined}
      size="lg"
      footer={
        <>
          {receivable && canManage && isOpen && receivable.paidCents === 0 && cancelReason === null && (
            <Button
              variant="danger-ghost"
              size="sm"
              icon={<Ban className="h-4 w-4" aria-hidden />}
              disabled={busy}
              onClick={() => {
                setError(null);
                setCancelReason('');
              }}
            >
              Cancelar conta
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Fechar
          </Button>
        </>
      }
    >
      {detail.isPending ? (
        <LoadingState label="Carregando conta..." />
      ) : detail.isError || !receivable || !badge ? (
        <ErrorState message="Não foi possível carregar a conta." onRetry={() => void detail.refetch()} />
      ) : (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
            <Badge tone={badge.tone} dot>
              {badge.label}
            </Badge>
            <span>{receivable.branch.name}</span>
            <span>· lançada em {formatDateTime(receivable.createdAt)}</span>
            {receivable.order && (
              <Link href={`/dashboard/pedidos/${receivable.order.id}`} className="font-medium text-accent hover:underline">
                Pedido {receivable.order.orderNumber}
              </Link>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="Total" value={formatMoney(receivable.totalCents)} />
            <StatCard label="Pago" value={formatMoney(receivable.paidCents)} />
            <StatCard label="Em aberto" value={formatMoney(receivable.openCents)} featured />
            <StatCard
              label="Vencido"
              value={formatMoney(receivable.overdueCents)}
              tone={receivable.overdueCents > 0 ? 'danger' : 'neutral'}
              hint={receivable.nextDueDate ? `Próximo vencimento ${formatDateOnly(receivable.nextDueDate)}` : undefined}
            />
          </div>

          {receivable.status === 'CANCELLED' && (
            <Alert tone="info">Conta cancelada{receivable.cancelReason ? `: ${receivable.cancelReason}` : '.'}</Alert>
          )}
          {error && <Alert tone="danger">{error}</Alert>}

          {cancelReason !== null && (
            <form onSubmit={onCancel} className="space-y-2 rounded-ctl border border-danger/30 bg-danger/5 p-3" noValidate>
              <Field label="Motivo do cancelamento" hint="A dívida deixa de existir. O histórico continua registrado.">
                <Input autoFocus maxLength={MAX_REASON} value={cancelReason} disabled={busy} onChange={(event) => setCancelReason(event.target.value)} />
              </Field>
              <div className="flex gap-2">
                <Button type="submit" variant="danger" size="sm" loading={cancelling} disabled={busy}>
                  Confirmar cancelamento
                </Button>
                <Button variant="ghost" size="sm" disabled={busy} onClick={() => setCancelReason(null)}>
                  Voltar
                </Button>
              </div>
            </form>
          )}

          <section aria-label="Parcelas" className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Parcelas</h3>
            <ul className="divide-y divide-line rounded-ctl border border-line">
              {receivable.installments.map((installment) => (
                <li key={installment.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2 text-sm">
                  <span className="text-foreground">
                    <span className="mr-2 text-xs font-semibold tabular-nums text-subtle">
                      {installment.number}/{receivable.installments.length}
                    </span>
                    vence {formatDateOnly(installment.dueDate)}
                  </span>
                  <span className="flex items-center gap-2">
                    {installment.paidCents > 0 && installment.openCents > 0 && (
                      <span className="text-xs tabular-nums text-muted-foreground">pago {formatMoney(installment.paidCents)}</span>
                    )}
                    <span className="font-medium tabular-nums text-foreground">{formatMoney(installment.amountCents)}</span>
                    {receivable.status === 'CANCELLED' ? (
                      <Badge tone="neutral">Cancelada</Badge>
                    ) : installment.openCents === 0 ? (
                      <Badge tone="success">Paga</Badge>
                    ) : installment.overdue ? (
                      <Badge tone="danger">Vencida</Badge>
                    ) : (
                      <Badge tone="warning">A vencer</Badge>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {isOpen && canReceive && (
            <section aria-label="Receber pagamento" className="space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Receber pagamento</h3>
              <form onSubmit={onPay} className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)_auto]" noValidate>
                <div className="flex gap-2">
                  <Input
                    aria-label="Valor recebido"
                    placeholder="Valor (R$)"
                    inputMode="decimal"
                    maxLength={12}
                    value={payment.amount}
                    disabled={busy}
                    onChange={(event) => {
                      setPayment({ ...payment, amount: event.target.value });
                      payAction.reset();
                    }}
                  />
                  <Button
                    variant="outline"
                    disabled={busy || payable === 0}
                    onClick={() => {
                      setPayment({ ...payment, amount: centsToInput(payable) });
                      payAction.reset();
                    }}
                  >
                    Tudo
                  </Button>
                </div>
                <Select
                  aria-label="Forma de recebimento"
                  value={payment.method}
                  disabled={busy}
                  onChange={(event) => {
                    setPayment({ ...payment, method: event.target.value as ReceivablePaymentMethod });
                    payAction.reset();
                  }}
                >
                  {RECEIVABLE_PAYMENT_METHODS.map((method) => (
                    <option key={method} value={method}>
                      {RECEIVABLE_METHOD_LABEL[method]}
                    </option>
                  ))}
                </Select>
                <Select
                  aria-label="Parcela a abater"
                  value={payment.installmentId}
                  disabled={busy || openInstallments.length < 2}
                  onChange={(event) => {
                    setPayment({ ...payment, installmentId: event.target.value });
                    payAction.reset();
                  }}
                >
                  <option value="">Parcelas por ordem de vencimento</option>
                  {openInstallments.map((installment) => (
                    <option key={installment.id} value={installment.id}>
                      Só a parcela {installment.number} ({formatMoney(installment.openCents)})
                    </option>
                  ))}
                </Select>
                <Button type="submit" loading={payAction.busy} disabled={busy}>
                  Receber
                </Button>
              </form>
              <p className="text-xs text-muted-foreground">
                {payment.method === 'CASH'
                  ? 'Dinheiro entra no caixa aberto da unidade selecionada.'
                  : 'Pix e cartão não passam pelo caixa.'}
              </p>
            </section>
          )}

          <section aria-label="Histórico da conta" className="space-y-2">
            <h3 className="text-sm font-semibold text-foreground">Histórico</h3>
            <ul className="divide-y divide-line rounded-ctl border border-line">
              {receivable.entries.map((entry) => (
                <li key={entry.id} className="space-y-2 px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={RECEIVABLE_ENTRY_TONE[entry.type]}>{RECEIVABLE_ENTRY_LABEL[entry.type]}</Badge>
                        <span className={entry.reversed ? 'text-sm text-muted-foreground line-through' : 'text-sm text-foreground'}>
                          {describeReceivableEntry(entry)}
                        </span>
                        {entry.reversed && <Badge tone="neutral">Estornado</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDateTime(entry.createdAt)}
                        {entry.createdBy ? ` · ${entry.createdBy.name}` : ''} · dívida do cliente {formatMoney(entry.balanceAfterCents)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span
                        className={
                          entry.amountCents < 0
                            ? 'text-sm font-semibold tabular-nums text-success'
                            : 'text-sm font-semibold tabular-nums text-foreground'
                        }
                      >
                        {formatSignedMoney(entry.amountCents)}
                      </span>
                      {canManage && isPaymentReversible(entry) && reversing?.entry.id !== entry.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Undo2 className="h-4 w-4" aria-hidden />}
                          disabled={busy}
                          aria-label={`Estornar pagamento de ${formatMoney(Math.abs(entry.amountCents))}`}
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
                        <Field
                          label="Motivo do estorno"
                          hint={entry.paymentMethod === 'CASH' ? 'O dinheiro sai do caixa aberto da unidade selecionada.' : undefined}
                        >
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
                          Voltar
                        </Button>
                      </div>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          </section>
        </div>
      )}
    </Dialog>
  );
}
