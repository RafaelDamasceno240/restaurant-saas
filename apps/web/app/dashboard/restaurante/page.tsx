'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { BrandingDialog } from '@/components/restaurante/BrandingDialog';
import { RestaurantProfileFormDialog } from '@/components/restaurante/RestaurantProfileFormDialog';
import { RestaurantProfileView } from '@/components/restaurante/RestaurantProfileView';
import { ErrorState, LoadingState } from '@/components/ds';
import { useAuth } from '@/lib/auth-context';
import { demoRestaurantProfile } from '@/lib/demo/restaurant-profile';
import { formatBRL } from '@/lib/format';
import { getRestaurantProfile, ProfileMetric, RestaurantProfile } from '@/lib/restaurant-profile';
import { toProfileView } from '@/lib/restaurant-profile-logic';
import { useDashboardStats } from '@/lib/use-dashboard-stats';

// Same roles the API grants restaurant.update to; the API checks it again on every save.
const EDITOR_ROLES = ['OWNER', 'ADMIN'];

export default function RestaurantePage() {
  const { accessToken, user } = useAuth();
  const [editing, setEditing] = useState(false);
  const [branding, setBranding] = useState(false);
  const data = useQuery({
    queryKey: ['restaurant-profile'],
    queryFn: () => getRestaurantProfile(accessToken as string),
    enabled: !!accessToken,
  });
  const { stats, isLoading: statsLoading } = useDashboardStats();
  const canEdit = !!user?.roles.some((role) => EDITOR_ROLES.includes(role));

  const profile = useMemo<RestaurantProfile | null>(() => {
    if (!data.data) return null;
    // The demonstration profile only lends the operation cards and the metric labels.
    const view = toProfileView(data.data, demoRestaurantProfile);
    const withValue = (key: string, value: string | null): ProfileMetric => ({
      ...(view.metrics.find((m) => m.key === key) as ProfileMetric),
      value,
    });
    return {
      ...view,
      metrics: [
        withValue('orders', stats ? String(stats.ordersToday) : null),
        withValue('sales', stats ? formatBRL(stats.salesToday) : null),
        withValue('ticket', stats ? formatBRL(stats.avgTicket) : null),
        withValue('products', null),
        withValue('customers', null),
      ],
    };
  }, [data.data, stats]);

  if (data.isLoading) return <LoadingState label="Carregando perfil..." />;
  if (data.isError || !profile || !data.data) {
    return (
      <ErrorState
        message="Não foi possível carregar o perfil do restaurante."
        onRetry={() => data.refetch()}
      />
    );
  }

  return (
    <>
      <RestaurantProfileView
        profile={profile}
        logoUrl={data.data.logoUrl ?? user?.tenant?.logoUrl}
        coverUrl={data.data.coverUrl}
        editable={false}
        metricsLoading={statsLoading}
        onEdit={canEdit ? () => setEditing(true) : undefined}
        onEditBranding={canEdit ? () => setBranding(true) : undefined}
      />
      {canEdit && (
        <RestaurantProfileFormDialog
          open={editing}
          profile={data.data}
          onClose={() => setEditing(false)}
        />
      )}
      {canEdit && (
        <BrandingDialog open={branding} profile={data.data} onClose={() => setBranding(false)} />
      )}
    </>
  );
}
