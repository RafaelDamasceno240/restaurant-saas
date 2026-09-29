'use client';

import { useQuery } from '@tanstack/react-query';
import { Bell, Wallet } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { getCurrentSession } from '@/lib/cash-api';
import { listOrders } from '@/lib/orders-api';
import { useActiveBranch } from '@/lib/use-active-branch';
import { BranchSelector } from '@/components/branch/BranchSelector';
import { Chip } from './Chip';

// Real-data chips for the operator topbar. Each one degrades to "hidden"
// when its query fails (e.g. a role without access to that endpoint) rather
// than showing a wrong or scary value.
export function DashboardChips() {
  const { accessToken } = useAuth();
  const { branches, branchId, setBranchId } = useActiveBranch();

  // Same query key/fn as the Caixa page, so both share one cache entry.
  const cash = useQuery({
    queryKey: ['cash-current', branchId],
    queryFn: () => getCurrentSession(accessToken as string, branchId as string),
    enabled: !!accessToken && !!branchId,
    refetchInterval: 30_000,
  });

  const pending = useQuery({
    queryKey: ['topbar-pending-orders'],
    queryFn: () => listOrders(accessToken as string, { status: 'PENDING', pageSize: 1 }),
    enabled: !!accessToken,
    refetchInterval: 20_000,
  });
  const pendingCount = pending.data?.meta.total ?? 0;

  return (
    <>
      <BranchSelector branches={branches} value={branchId} onChange={setBranchId} />

      {cash.data && (
        <Chip
          href="/dashboard/caixa"
          dot
          tone={cash.data.session ? 'success' : 'neutral'}
          icon={<Wallet />}
          label={cash.data.session ? 'Caixa aberto' : 'Caixa fechado'}
          title="Situação do caixa da unidade"
        />
      )}

      <Chip
        href="/dashboard/pedidos"
        icon={<Bell />}
        tone={pendingCount > 0 ? 'warning' : 'neutral'}
        label={
          pending.isError
            ? 'Pedidos'
            : pendingCount > 0
              ? `${pendingCount} novo${pendingCount === 1 ? '' : 's'}`
              : 'Sem novos'
        }
        title="Pedidos aguardando confirmação"
      />
    </>
  );
}
