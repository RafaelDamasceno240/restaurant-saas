'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { centsToInput } from '@/lib/coupons-logic';
import { receivablesApi } from '@/lib/receivables-api';
import { formatDateOnly, formatMoney, parseLimit, receivableBadge, receivableErrorMessage } from '@/lib/receivables-logic';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Input } from '@/components/ds/Input';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { StatCard } from '@/components/ds/StatCard';
import { useToast } from '@/components/ds/Toast';

// The API decides (receivables.read / receivables.manage); this only hides what would be refused.
const CAN_MANAGE = ['OWNER', 'ADMIN', 'MANAGER'];
const PAGE_SIZE = 5;

// Fiado of one customer: the limit, what is owed, what is overdue and the customer's accounts.
// Receiving and reversing happen in "Contas a receber" (each row links there). Every number
// shown comes from the API.
export function CustomerCreditPanel({ customerId }: { customerId: string }) {
  const { accessToken, user } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canManage = (user?.roles ?? []).some((role) => CAN_MANAGE.includes(role));

  const [page, setPage] = useState(1);
  const [limitInput, setLimitInput] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
    setLimitInput(null);
    setError(null);
  }, [customerId]);

  const account = useQuery({
    queryKey: ['receivables', 'account', customerId],
    queryFn: () => receivablesApi.getAccount(accessToken as string, customerId),
    enabled: !!accessToken,
  });
  const list = useQuery({
    queryKey: ['receivables', 'customer-list', customerId, page],
    queryFn: () => receivablesApi.list(accessToken as string, { customerId, status: 'all', page, pageSize: PAGE_SIZE }),
    enabled: !!accessToken,
    placeholderData: (previous) => previous,
  });

  async function onSaveLimit(event: FormEvent) {
    event.preventDefault();
    if (limitInput === null || savingRef.current) return;
    const cents = parseLimit(limitInput);
    if (cents === null) {
      setError('Informe um limite válido (ou deixe em branco para não permitir fiado).');
      return;
    }
    setError(null);
    savingRef.current = true;
    setSaving(true);
    try {
      const saved = await receivablesApi.setLimit(accessToken as string, customerId, cents);
      toast.success(saved.creditLimitCents > 0 ? `Limite de fiado: ${formatMoney(saved.creditLimitCents)}.` : 'Cliente sem fiado.');
      setLimitInput(null);
      await queryClient.invalidateQueries({ queryKey: ['receivables'] });
    } catch (err) {
      setError(
        receivableErrorMessage(
          err instanceof ApiError ? err.code : undefined,
          err instanceof Error && err.message ? err.message : 'Não foi possível salvar o limite.',
        ),
      );
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }

  if (account.isPending) return <LoadingState label="Carregando fiado..." />;
  if (account.isError || !account.data) {
    return <ErrorState message="Não foi possível carregar o fiado do cliente." onRetry={() => void account.refetch()} />;
  }

  const { creditLimitCents, balanceCents, availableCents, overdueCents } = account.data;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="Limite" value={creditLimitCents > 0 ? formatMoney(creditLimitCents) : <span className="text-lg">Sem fiado</span>} />
        <StatCard label="Deve hoje" value={formatMoney(balanceCents)} featured />
        <StatCard label="Disponível" value={formatMoney(availableCents)} />
        <StatCard label="Vencido" value={formatMoney(overdueCents)} tone={overdueCents > 0 ? 'danger' : 'neutral'} />
      </div>

      {overdueCents > 0 && <Alert tone="warning">Cliente com parcela vencida: novas vendas fiado ficam bloqueadas até o recebimento.</Alert>}
      {creditLimitCents > 0 && balanceCents > creditLimitCents && (
        <Alert tone="info">A dívida está acima do limite atual: novas vendas fiado ficam bloqueadas até ela baixar.</Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}

      {canManage && (
        <section aria-label="Limite de fiado" className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Limite de fiado</h3>
          {limitInput === null ? (
            <div className="flex flex-wrap items-center gap-3">
              <p className="text-sm text-muted-foreground">
                {creditLimitCents > 0
                  ? `Este cliente pode dever até ${formatMoney(creditLimitCents)}.`
                  : 'Este cliente não compra fiado. Defina um limite para permitir.'}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  setError(null);
                  setLimitInput(creditLimitCents > 0 ? centsToInput(creditLimitCents) : '');
                }}
              >
                {creditLimitCents > 0 ? 'Alterar limite' : 'Definir limite'}
              </Button>
            </div>
          ) : (
            <form onSubmit={onSaveLimit} className="flex flex-wrap items-center gap-2" noValidate>
              <Input
                autoFocus
                aria-label="Limite de fiado"
                placeholder="Limite (R$) — vazio = sem fiado"
                inputMode="decimal"
                maxLength={12}
                className="w-56"
                value={limitInput}
                disabled={saving}
                onChange={(event) => setLimitInput(event.target.value)}
              />
              <Button type="submit" size="sm" loading={saving} disabled={saving}>
                Salvar
              </Button>
              <Button size="sm" variant="ghost" disabled={saving} onClick={() => setLimitInput(null)}>
                Cancelar
              </Button>
            </form>
          )}
        </section>
      )}

      <section aria-label="Contas do cliente" className="space-y-2">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-foreground">Contas</h3>
          <Link href={`/dashboard/fiado?cliente=${customerId}`} className="text-xs font-medium text-accent hover:underline">
            Abrir em Contas a receber
          </Link>
        </div>
        {list.isPending ? (
          <LoadingState label="Carregando contas..." />
        ) : list.isError ? (
          <ErrorState message="Não foi possível carregar as contas." onRetry={() => void list.refetch()} />
        ) : list.data.data.length === 0 ? (
          <EmptyState title="Nenhuma conta" description="Vendas fiado e dívidas lançadas para este cliente aparecem aqui." />
        ) : (
          <>
            <ul className="divide-y divide-line rounded-ctl border border-line">
              {list.data.data.map((receivable) => {
                const badge = receivableBadge(receivable);
                return (
                  <li key={receivable.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 py-2.5">
                    <div className="min-w-0">
                      <Link href={`/dashboard/fiado?conta=${receivable.id}`} className="text-sm font-medium text-foreground hover:underline">
                        {receivable.description}
                      </Link>
                      <p className="text-xs text-muted-foreground">
                        {receivable.installments.length}x · {receivable.branch.name}
                        {receivable.nextDueDate ? ` · próximo vencimento ${formatDateOnly(receivable.nextDueDate)}` : ''}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                      <span className="text-sm font-medium tabular-nums text-foreground">
                        {receivable.status === 'OPEN' ? formatMoney(receivable.openCents) : formatMoney(receivable.totalCents)}
                      </span>
                    </div>
                  </li>
                );
              })}
            </ul>
            {list.data.meta.totalPages > 1 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Página {list.data.meta.page} de {list.data.meta.totalPages} · {list.data.meta.total} contas
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Anterior
                  </Button>
                  <Button size="sm" variant="outline" disabled={page >= list.data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
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
