'use client';

import { ReactNode, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, PauseCircle, PlayCircle } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { platformApi, PlatformTenantDetail } from '@/lib/platform-api';
import { formatDate, formatDateTime, HISTORY_LABEL, STATUS_LABEL, STATUS_TONE, statusActions } from '@/lib/platform-logic';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Card } from '@/components/ds/Card';
import { ConfirmDialog } from '@/components/ds/Dialog';
import { Page, PageHeader } from '@/components/ds/PageHeader';
import { Alert, ErrorState, LoadingState } from '@/components/ds/States';
import { useToast } from '@/components/ds/Toast';
import { SuspendTenantDialog } from '@/components/platform/SuspendTenantDialog';

function Info({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-2xs font-medium uppercase tracking-wide text-subtle">{label}</dt>
      <dd className="mt-0.5 break-words text-sm text-foreground">{children}</dd>
    </div>
  );
}

// One restaurant as the platform sees it: identity (document masked), units, owners, its platform
// history, and the two actions of this MVP: suspend and reactivate. No business data and nothing
// sensitive (no password hash, no tokens) comes from the API for this page.
export default function PlatformTenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const { accessToken } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [suspending, setSuspending] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const detail = useQuery({
    queryKey: ['platform', 'tenant', id],
    queryFn: () => platformApi.detail(accessToken as string, id),
    enabled: !!accessToken && !!id,
  });

  const done = async (tenant: PlatformTenantDetail, message: string) => {
    queryClient.setQueryData(['platform', 'tenant', id], tenant);
    await queryClient.invalidateQueries({ queryKey: ['platform', 'tenants'] });
    await queryClient.invalidateQueries({ queryKey: ['platform', 'overview'] });
    toast.success(message);
  };
  const failure = (err: unknown) =>
    err instanceof Error ? err.message : 'Não foi possível concluir. Tente novamente.';

  const suspend = useMutation({
    mutationFn: (reason: string) => platformApi.suspend(accessToken as string, id, reason),
    onSuccess: async (tenant) => {
      setSuspending(false);
      await done(tenant, `${tenant.name} suspenso. Os usuários perderam o acesso; os dados foram preservados.`);
    },
    onError: (err) => setActionError(failure(err)),
  });
  const reactivate = useMutation({
    mutationFn: () => platformApi.reactivate(accessToken as string, id),
    onSuccess: async (tenant) => {
      setReactivating(false);
      await done(tenant, `${tenant.name} reativado. O acesso voltou com todos os dados.`);
    },
    onError: (err) => {
      setReactivating(false);
      toast.error(failure(err));
    },
  });

  if (detail.isPending) return <LoadingState label="Carregando restaurante..." />;
  if (detail.isError) {
    const notFound = detail.error instanceof ApiError && detail.error.statusCode === 404;
    return (
      <Page>
        <ErrorState
          message={notFound ? 'Restaurante não encontrado.' : 'Não foi possível carregar o restaurante.'}
          onRetry={notFound ? undefined : () => void detail.refetch()}
        />
      </Page>
    );
  }

  const tenant = detail.data;
  const { canSuspend, canReactivate } = statusActions(tenant.status);

  return (
    <Page>
      <Link href="/super-admin/restaurantes" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Restaurantes
      </Link>
      <PageHeader
        title={tenant.name}
        description={
          <span className="inline-flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[tenant.status]}>{STATUS_LABEL[tenant.status]}</Badge>
            <span>/{tenant.slug}</span>
          </span>
        }
        actions={
          <>
            {canSuspend && (
              <Button
                variant="danger"
                icon={<PauseCircle className="h-4 w-4" aria-hidden />}
                onClick={() => {
                  setActionError(null);
                  setSuspending(true);
                }}
              >
                Suspender
              </Button>
            )}
            {canReactivate && (
              <Button icon={<PlayCircle className="h-4 w-4" aria-hidden />} onClick={() => setReactivating(true)}>
                Reativar
              </Button>
            )}
          </>
        }
      />

      {tenant.suspension && (
        <Alert tone="warning">
          Suspenso em {formatDateTime(tenant.suspension.at)}
          {tenant.suspension.by ? ` por ${tenant.suspension.by.email}` : ''}.
          {tenant.suspension.reason ? ` Motivo: ${tenant.suspension.reason}` : ''}
        </Alert>
      )}

      <Card className="p-4">
        <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Info label="Nome">{tenant.name}</Info>
          <Info label="Razão social">{tenant.legalName}</Info>
          <Info label="CNPJ/CPF">{tenant.document}</Info>
          <Info label="Slug">{tenant.slug}</Info>
          <Info label="Situação">{STATUS_LABEL[tenant.status]}</Info>
          <Info label="Fuso horário">{tenant.timezone}</Info>
          <Info label="Criado em">{formatDate(tenant.createdAt)}</Info>
          <Info label="Usuários">{tenant.userCount}</Info>
          <Info label="Delivery da unidade principal">
            {tenant.mainBranchDeliveryEnabled === null ? '—' : tenant.mainBranchDeliveryEnabled ? 'Ligado' : 'Desligado'}
          </Info>
        </dl>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Proprietários (OWNER)</h2>
          {tenant.owners.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum OWNER.</p>
          ) : (
            <ul className="space-y-2">
              {tenant.owners.map((owner) => (
                <li key={owner.id} className="min-w-0 text-sm">
                  <span className="font-medium text-foreground">{owner.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{owner.email}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-4">
          <h2 className="mb-3 text-sm font-semibold text-foreground">Unidades</h2>
          <ul className="space-y-2">
            {tenant.branches.map((branch, index) => (
              <li key={branch.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-foreground">
                  {branch.name}
                  {index === 0 && <span className="ml-1 text-xs text-subtle">(principal)</span>}
                </span>
                <span className="text-xs text-muted-foreground">
                  {branch.status === 'ACTIVE' ? 'Ativa' : 'Inativa'} · delivery {branch.deliveryEnabled ? 'ligado' : 'desligado'}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      <Card className="p-4">
        <h2 className="mb-3 text-sm font-semibold text-foreground">Histórico na plataforma</h2>
        {tenant.history.length === 0 ? (
          <p className="text-sm text-muted-foreground">Sem registros.</p>
        ) : (
          <ol className="space-y-2">
            {tenant.history.map((event, index) => (
              <li key={`${event.action}-${event.at}-${index}`} className="text-sm">
                <span className="font-medium text-foreground">{HISTORY_LABEL[event.action] ?? event.action}</span>
                <span className="text-xs text-muted-foreground">
                  {' '}
                  · {formatDateTime(event.at)}
                  {event.by ? ` · ${event.by.email}` : ''}
                </span>
                {event.reason && <span className="block text-xs text-muted-foreground">Motivo: {event.reason}</span>}
              </li>
            ))}
          </ol>
        )}
      </Card>

      <SuspendTenantDialog
        open={suspending}
        tenantName={tenant.name}
        loading={suspend.isPending}
        error={actionError}
        onConfirm={(reason) => !suspend.isPending && suspend.mutate(reason)}
        onClose={() => setSuspending(false)}
      />
      <ConfirmDialog
        open={reactivating}
        title={`Reativar ${tenant.name}`}
        description="Os usuários deste restaurante voltam a entrar com as mesmas senhas, e todos os dados continuam como estavam."
        confirmLabel="Reativar"
        loading={reactivate.isPending}
        onConfirm={() => !reactivate.isPending && reactivate.mutate()}
        onClose={() => (reactivate.isPending ? undefined : setReactivating(false))}
      />
    </Page>
  );
}
