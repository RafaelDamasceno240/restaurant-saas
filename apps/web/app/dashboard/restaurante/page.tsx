'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RestaurantProfileView } from '@/components/restaurante/RestaurantProfileView';
import { ErrorState, LoadingState } from '@/components/ds';
import { useAuth } from '@/lib/auth-context';
import { demoRestaurantProfile } from '@/lib/demo/restaurant-profile';
import { formatBRL } from '@/lib/format';
import {
  getCurrentTenant,
  mergeTenantIntoProfile,
  ProfileMetric,
  RestaurantProfile,
} from '@/lib/restaurant-profile';
import { useDashboardStats } from '@/lib/use-dashboard-stats';

export default function RestaurantePage() {
  const { accessToken } = useAuth();
  const tenant = useQuery({
    queryKey: ['tenant-current'],
    queryFn: () => getCurrentTenant(accessToken as string),
    enabled: !!accessToken,
  });
  const { stats, isLoading: statsLoading } = useDashboardStats();

  const profile = useMemo<RestaurantProfile | null>(() => {
    if (!tenant.data) return null;
    const merged = mergeTenantIntoProfile(demoRestaurantProfile, tenant.data);
    const withValue = (key: string, value: string | null): ProfileMetric => ({
      ...(merged.metrics.find((m) => m.key === key) as ProfileMetric),
      value,
    });
    return {
      ...merged,
      channels: merged.channels.map((c) => (c.key === 'menu' ? { ...c, value: `/menu/${merged.slug}` } : c)),
      metrics: [
        withValue('orders', stats ? String(stats.ordersToday) : null),
        withValue('sales', stats ? formatBRL(stats.salesToday) : null),
        withValue('ticket', stats ? formatBRL(stats.avgTicket) : null),
        withValue('products', null),
        withValue('customers', null),
      ],
      status: null,
      demo: { profile: true, address: true, hours: true, channels: true, metrics: false },
    };
  }, [tenant.data, stats]);

  if (tenant.isLoading) return <LoadingState label="Carregando perfil..." />;
  if (tenant.isError || !profile) {
    return <ErrorState message="Não foi possível carregar o perfil do restaurante." onRetry={() => tenant.refetch()} />;
  }

  return <RestaurantProfileView profile={profile} editable={false} metricsLoading={statsLoading} computeStatus />;
}
