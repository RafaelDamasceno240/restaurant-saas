'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { Building2, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { platformApi } from '@/lib/platform-api';
import { formatDate, pageRangeLabel, PLATFORM_PAGE_SIZE, STATUS_LABEL, STATUS_TONE } from '@/lib/platform-logic';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Card } from '@/components/ds/Card';
import { SearchInput } from '@/components/ds/Input';
import { Page, PageHeader } from '@/components/ds/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { useToast } from '@/components/ds/Toast';
import { NewTenantDialog } from '@/components/platform/NewTenantDialog';

const SEARCH_DELAY_MS = 300;

// Every restaurant of the platform, a page at a time (the API pages; the database may hold
// thousands). Search by name, slug or the OWNER's e-mail.
export default function PlatformTenantsPage() {
  const { accessToken } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [typed, setTyped] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [creating, setCreating] = useState(false);

  // The request waits until the typing stops; a new search starts at page 1. Only a CHANGED
  // search does that: otherwise the timer armed when the page opens would send back to page 1 a
  // page chosen in the first moments.
  useEffect(() => {
    const next = typed.trim();
    if (next === search) return;
    const timer = setTimeout(() => {
      setSearch(next);
      setPage(1);
    }, SEARCH_DELAY_MS);
    return () => clearTimeout(timer);
  }, [typed, search]);

  const list = useQuery({
    queryKey: ['platform', 'tenants', search, page],
    queryFn: () => platformApi.list(accessToken as string, { search, page, pageSize: PLATFORM_PAGE_SIZE }),
    enabled: !!accessToken,
    placeholderData: keepPreviousData,
  });
  const rows = list.data?.items ?? [];
  const meta = list.data?.meta;

  return (
    <Page wide>
      <PageHeader
        title="Restaurantes"
        description="Todos os restaurantes da plataforma."
        actions={
          <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setCreating(true)}>
            Novo restaurante
          </Button>
        }
      />

      <div className="max-w-md">
        <SearchInput
          aria-label="Buscar restaurante"
          placeholder="Buscar por nome, slug ou e-mail do proprietário"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
        />
      </div>

      {list.isPending ? (
        <LoadingState label="Carregando restaurantes..." />
      ) : list.isError ? (
        <ErrorState message="Não foi possível carregar os restaurantes." onRetry={() => void list.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={<Building2 />}
          title={search ? 'Nenhum restaurante encontrado' : 'Nenhum restaurante ainda'}
          description={search ? `Nada corresponde a "${search}".` : 'Crie o primeiro em "Novo restaurante".'}
        />
      ) : (
        <>
          {/* Phone: one card per restaurant. */}
          <ul className="space-y-2 md:hidden" aria-label="Restaurantes">
            {rows.map((row) => (
              <li key={row.id}>
                <Link href={`/super-admin/restaurantes/${row.id}`} className="block">
                  <Card className="space-y-1 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="min-w-0 truncate font-semibold text-foreground">{row.name}</span>
                      <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                    </div>
                    <p className="truncate text-xs text-muted-foreground">/{row.slug}</p>
                    <p className="truncate text-xs text-muted-foreground">{row.ownerEmail ?? 'Sem OWNER'}</p>
                    <p className="text-2xs text-subtle">
                      Criado em {formatDate(row.createdAt)} · {row.branchCount} {row.branchCount === 1 ? 'unidade' : 'unidades'}
                    </p>
                  </Card>
                </Link>
              </li>
            ))}
          </ul>

          {/* Wider screens: a table. */}
          <Card className="hidden overflow-hidden md:block">
            <TableWrap>
              <Table className="min-w-[860px]">
                <THead>
                  <Tr className="hover:bg-transparent">
                    <Th>Restaurante</Th>
                    <Th>Slug</Th>
                    <Th>Situação</Th>
                    <Th>Criado em</Th>
                    <Th className="text-right">Unidades</Th>
                    <Th>E-mail do OWNER</Th>
                  </Tr>
                </THead>
                <TBody>
                  {rows.map((row) => (
                    <Tr key={row.id} className="cursor-pointer" onClick={() => router.push(`/super-admin/restaurantes/${row.id}`)}>
                      <Td>
                        <Link
                          href={`/super-admin/restaurantes/${row.id}`}
                          className="font-semibold text-foreground hover:underline"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {row.name}
                        </Link>
                      </Td>
                      <Td className="text-muted-foreground">{row.slug}</Td>
                      <Td>
                        <Badge tone={STATUS_TONE[row.status]}>{STATUS_LABEL[row.status]}</Badge>
                      </Td>
                      <Td className="tabular-nums text-muted-foreground">{formatDate(row.createdAt)}</Td>
                      <Td className="text-right tabular-nums">{row.branchCount}</Td>
                      <Td className="max-w-[16rem] truncate text-muted-foreground" title={row.ownerEmail ?? undefined}>
                        {row.ownerEmail ?? '—'}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </Card>
        </>
      )}

      {meta && meta.total > 0 && (
        <nav className="flex flex-wrap items-center justify-between gap-2" aria-label="Paginação">
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {pageRangeLabel(meta)} · página {meta.page} de {meta.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={<ChevronLeft className="h-4 w-4" aria-hidden />}
              disabled={meta.page <= 1 || list.isFetching}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Anterior
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={meta.page >= meta.totalPages || list.isFetching}
              onClick={() => setPage((p) => p + 1)}
            >
              Próxima
              <ChevronRight className="h-4 w-4" aria-hidden />
            </Button>
          </div>
        </nav>
      )}

      <NewTenantDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(tenant) => {
          setCreating(false);
          toast.success(`${tenant.name} criado. Entregue o e-mail e a senha inicial ao proprietário.`);
          router.push(`/super-admin/restaurantes/${tenant.id}`);
        }}
      />
    </Page>
  );
}
