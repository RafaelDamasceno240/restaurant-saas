'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Building2, CircleCheck, FlaskConical, PauseCircle, XCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { platformApi } from '@/lib/platform-api';
import { STATUS_LABEL } from '@/lib/platform-logic';
import { Button } from '@/components/ds/Button';
import { Page, PageHeader } from '@/components/ds/PageHeader';
import { StatCard } from '@/components/ds/StatCard';
import { ErrorState } from '@/components/ds/States';

// Visão geral da plataforma: restaurants by status (the real TenantStatus values). Nothing
// financial yet.
export default function SuperAdminOverviewPage() {
  const { accessToken } = useAuth();
  const overview = useQuery({
    queryKey: ['platform', 'overview'],
    queryFn: () => platformApi.overview(accessToken as string),
    enabled: !!accessToken,
  });
  const data = overview.data;
  const loading = overview.isPending;

  return (
    <Page>
      <PageHeader
        title="Visão geral"
        description="Os restaurantes da plataforma, por situação."
        actions={
          <Link href="/super-admin/restaurantes">
            <Button variant="outline" icon={<Building2 className="h-4 w-4" aria-hidden />}>
              Ver restaurantes
            </Button>
          </Link>
        }
      />
      {overview.isError ? (
        <ErrorState message="Não foi possível carregar a visão geral." onRetry={() => void overview.refetch()} />
      ) : (
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
          <StatCard label="Restaurantes totais" value={data?.total ?? 0} loading={loading} icon={<Building2 />} featured />
          <StatCard label={STATUS_LABEL.ACTIVE} value={data?.byStatus.ACTIVE ?? 0} loading={loading} icon={<CircleCheck />} tone="success" />
          <StatCard label={STATUS_LABEL.TRIAL} value={data?.byStatus.TRIAL ?? 0} loading={loading} icon={<FlaskConical />} tone="info" />
          <StatCard label="Suspensos" value={data?.byStatus.SUSPENDED ?? 0} loading={loading} icon={<PauseCircle />} tone="danger" />
          <StatCard label="Cancelados" value={data?.byStatus.CANCELLED ?? 0} loading={loading} icon={<XCircle />} />
        </div>
      )}
    </Page>
  );
}
