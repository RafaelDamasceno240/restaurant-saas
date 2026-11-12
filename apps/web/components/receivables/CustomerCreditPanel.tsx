'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { receivablesApi } from '@/lib/receivables-api';
import { formatDateOnly, formatMoney, receivableBadge } from '@/lib/receivables-logic';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { StatCard } from '@/components/ds/StatCard';

const PAGE_SIZE = 5;

// Fiado of one customer, from before remocao-fiado (fiado is no longer sold and there is no credit
// limit any more): what is still owed, what is overdue and the customer's accounts. Receiving and
// reversing happen in "Contas a receber" (each row links there). Every number comes from the API.
export function CustomerCreditPanel({ customerId }: { customerId: string }) {
  const { accessToken } = useAuth();

  const [page, setPage] = useState(1);

  useEffect(() => {
    setPage(1);
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

  if (account.isPending) return <LoadingState label="Carregando fiado..." />;
  if (account.isError || !account.data) {
    return <ErrorState message="Não foi possível carregar o fiado do cliente." onRetry={() => void account.refetch()} />;
  }

  const { balanceCents, overdueCents } = account.data;

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3">
        <StatCard label="Ainda deve" value={formatMoney(balanceCents)} featured />
        <StatCard label="Vencido" value={formatMoney(overdueCents)} tone={overdueCents > 0 ? 'danger' : 'neutral'} />
      </div>

      <Alert tone="info">O sistema não vende mais fiado. Aqui ficam só as contas antigas deste cliente.</Alert>

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
          <EmptyState title="Nenhuma conta" description="Este cliente não tem fiado de antes da desativação." />
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
