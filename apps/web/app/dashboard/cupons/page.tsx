'use client';

import { useDeferredValue, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Ticket } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { Coupon, couponsApi, CouponStatusFilter } from '@/lib/coupons-api';
import {
  AVAILABILITY_LABEL,
  AVAILABILITY_TONE,
  COUPON_TAB_LABEL,
  COUPON_TABS,
  couponErrorMessage,
  describeDiscount,
  describeUsage,
  formatWindow,
  isFiltering,
  centsToInput,
} from '@/lib/coupons-logic';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Card } from '@/components/ds/Card';
import { SearchInput } from '@/components/ds/Input';
import { Page, PageHeader } from '@/components/ds/PageHeader';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { Tabs } from '@/components/ds/Tabs';
import { useToast } from '@/components/ds/Toast';
import { CouponFormDialog } from '@/components/coupons/CouponFormDialog';

// The API decides who may do what (coupons.read/create/update); this only hides the screen from
// roles that would be refused anyway. A CASHIER applies coupons at the PDV but never lands here.
const MANAGEMENT = ['OWNER', 'ADMIN', 'MANAGER'];

type FormState = { coupon: Coupon | null } | null;

export default function CouponsPage() {
  const { user, accessToken } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const canManage = (user?.roles ?? []).some((role) => MANAGEMENT.includes(role));

  const [status, setStatus] = useState<CouponStatusFilter>('active');
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [form, setForm] = useState<FormState>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  // Synchronous guard: two clicks in the same tick cannot start two activate/deactivate calls.
  const toggling = useRef(false);
  const search = useDeferredValue(searchText.trim());

  useEffect(() => setPage(1), [status, search]);

  const query = useQuery({
    queryKey: ['coupons', 'list', status, search, page],
    queryFn: () => couponsApi.list(accessToken as string, { status, search: search || undefined, page }),
    enabled: !!accessToken && canManage,
    placeholderData: (previous) => previous,
  });

  const toggle = useMutation({
    mutationFn: (coupon: Coupon) =>
      coupon.active ? couponsApi.deactivate(accessToken as string, coupon.id) : couponsApi.activate(accessToken as string, coupon.id),
    onSuccess: async (saved) => {
      toast.success(saved.active ? `Cupom ${saved.code} ativado.` : `Cupom ${saved.code} desativado.`);
      await queryClient.invalidateQueries({ queryKey: ['coupons'] });
    },
    onError: (err) => {
      const code = err instanceof ApiError ? err.code : undefined;
      setActionError(couponErrorMessage(code, err instanceof Error ? err.message : 'Não foi possível alterar o cupom.'));
    },
    onSettled: () => {
      toggling.current = false;
      setPendingId(null);
    },
  });

  function runToggle(coupon: Coupon) {
    if (toggling.current) return;
    toggling.current = true;
    setActionError(null);
    setPendingId(coupon.id);
    toggle.mutate(coupon);
  }

  function clearFilters() {
    setSearchText('');
    setStatus('active');
  }

  if (!canManage) {
    return (
      <Page>
        <EmptyState
          icon={<Ticket />}
          title="Sem acesso a Cupons"
          description="Somente proprietários, administradores e gerentes administram cupons."
        />
      </Page>
    );
  }

  const data = query.data;
  const rows = data?.data ?? [];
  const filtering = isFiltering(search, status);
  const tabCount = (key: CouponStatusFilter) =>
    data ? (key === 'all' ? data.summary.active + data.summary.inactive : data.summary[key]) : undefined;

  return (
    <Page wide>
      <PageHeader
        title="Cupons"
        description="Descontos do restaurante. Tudo é calculado e validado pelo servidor no momento do pedido."
        actions={
          <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setForm({ coupon: null })}>
            Novo cupom
          </Button>
        }
      />

      <Tabs
        variant="pill"
        value={status}
        onChange={setStatus}
        items={COUPON_TABS.map((key) => ({ key, label: COUPON_TAB_LABEL[key], count: tabCount(key) }))}
      />

      <Card className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <SearchInput
          placeholder="Buscar por código..."
          aria-label="Buscar cupons"
          maxLength={40}
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
        <Button variant="ghost" onClick={clearFilters} disabled={!filtering && searchText === ''}>
          Limpar filtros
        </Button>
      </Card>

      {actionError && <Alert tone="danger">{actionError}</Alert>}

      {query.isPending ? (
        <LoadingState label="Carregando cupons..." />
      ) : query.isError ? (
        <ErrorState message="Não foi possível carregar os cupons." onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={filtering ? <Search /> : <Ticket />}
          title={filtering ? 'Nenhum cupom encontrado' : 'Nenhum cupom cadastrado'}
          description={
            filtering
              ? 'Ajuste a busca ou os filtros, ou limpe-os para ver todos.'
              : 'Crie o primeiro cupom para oferecer descontos no PDV e no cardápio online.'
          }
          action={
            filtering ? (
              <Button variant="outline" onClick={clearFilters}>
                Limpar filtros
              </Button>
            ) : (
              <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setForm({ coupon: null })}>
                Novo cupom
              </Button>
            )
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <TableWrap>
            <Table className="min-w-[860px]">
              <THead>
                <Tr className="hover:bg-transparent">
                  <Th>Código</Th>
                  <Th>Desconto</Th>
                  <Th>Validade</Th>
                  <Th className="text-right">Usos</Th>
                  <Th>Situação</Th>
                  <Th className="relative">
                    <span className="sr-only">Ações</span>
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map((coupon) => (
                  <Tr key={coupon.id}>
                    <Td>
                      <div className="font-mono font-semibold text-foreground">{coupon.code}</div>
                      <div className="max-w-[16rem] truncate text-xs text-muted-foreground" title={coupon.description ?? undefined}>
                        {coupon.description ?? (coupon.branch ? coupon.branch.name : 'Todas as unidades')}
                      </div>
                    </Td>
                    <Td>
                      <div className="font-medium text-foreground">{describeDiscount(coupon)}</div>
                      <div className="text-xs text-muted-foreground">
                        {coupon.minOrderCents > 0 ? `Mínimo R$ ${centsToInput(coupon.minOrderCents)}` : 'Sem mínimo'}
                        {coupon.perCustomerLimit !== null ? ` · ${coupon.perCustomerLimit}/cliente` : ''}
                      </div>
                    </Td>
                    <Td className="text-xs text-muted-foreground">{formatWindow(coupon)}</Td>
                    <Td className="text-right tabular-nums">{describeUsage(coupon)}</Td>
                    <Td>
                      <Badge tone={AVAILABILITY_TONE[coupon.availability]} dot>
                        {AVAILABILITY_LABEL[coupon.availability]}
                      </Badge>
                    </Td>
                    <Td className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button size="sm" variant="outline" aria-label={`Editar cupom ${coupon.code}`} onClick={() => setForm({ coupon })}>
                          Editar
                        </Button>
                        <Button
                          size="sm"
                          variant={coupon.active ? 'danger-ghost' : 'outline'}
                          aria-label={`${coupon.active ? 'Desativar' : 'Ativar'} cupom ${coupon.code}`}
                          loading={pendingId === coupon.id}
                          disabled={pendingId !== null}
                          onClick={() => runToggle(coupon)}
                        >
                          {coupon.active ? 'Desativar' : 'Ativar'}
                        </Button>
                      </div>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          {data && data.meta.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-muted-foreground">
              <span>
                Página {data.meta.page} de {data.meta.totalPages} · {data.meta.total} cupons
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
                  Anterior
                </Button>
                <Button size="sm" variant="outline" disabled={page >= data.meta.totalPages} onClick={() => setPage((current) => current + 1)}>
                  Próxima
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <CouponFormDialog open={form !== null} coupon={form?.coupon ?? null} onClose={() => setForm(null)} />
    </Page>
  );
}
