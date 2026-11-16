'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Bell, Wallet } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { getCurrentSession } from '@/lib/cash-api';
import { hasPermission } from '@/lib/permissions';
import { listOrders } from '@/lib/orders-api';
import { useActiveBranch } from '@/lib/use-active-branch';
import { useOrderAlerts } from '@/lib/use-order-alerts';
import { BranchSelector } from '@/components/branch/BranchSelector';
import { InstallAppButton, OrderAlertsButton } from '@/components/pwa/PwaControls';
import { Chip } from './Chip';

// Real-data chips for the operator topbar. Each one degrades to "hidden"
// when its query fails (e.g. a role without access to that endpoint) rather
// than showing a wrong or scary value.
export function DashboardChips() {
  const { accessToken, user } = useAuth();
  const { branches, branchId, setBranchId } = useActiveBranch();
  // Decided before the query below: with alerts on, the count keeps being refreshed while the
  // screen is in the background (that is the whole point of the alert).
  const [alertsOn, setAlertsOn] = useState(false);

  // Same query key/fn as the Caixa page, so both share one cache entry.
  const cash = useQuery({
    queryKey: ['cash-current', branchId],
    queryFn: () => getCurrentSession(accessToken as string, branchId as string),
    // B12: only roles that can read the drawer ask (the others got a 403 on every screen).
    enabled: !!accessToken && !!branchId && hasPermission(user?.roles, 'cash.read'),
    refetchInterval: 30_000,
  });

  const pending = useQuery({
    queryKey: ['topbar-pending-orders'],
    queryFn: () => listOrders(accessToken as string, { status: 'PENDING', pageSize: 1 }),
    enabled: !!accessToken,
    refetchInterval: 20_000,
    refetchIntervalInBackground: alertsOn,
  });
  const pendingCount = pending.data?.meta.total ?? 0;
  const alerts = useOrderAlerts(user?.id, pending.data?.meta.total);
  useEffect(() => setAlertsOn(alerts.active), [alerts.active]);

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

      {!pending.isError && <OrderAlertsButton enabled={alerts.enabled} permission={alerts.permission} onToggle={() => void alerts.toggle()} />}
      <InstallAppButton />
    </>
  );
}
