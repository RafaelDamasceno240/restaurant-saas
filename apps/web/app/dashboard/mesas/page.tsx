'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { LayoutGrid, Plus, QrCode, Receipt } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { DiningTable, tablesApi } from '@/lib/tables-api';
import { formatCentsAsBRL } from '@/lib/money';
import { useActiveBranch } from '@/lib/use-active-branch';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Card } from '@/components/ds/Card';
import { Dialog } from '@/components/ds/Dialog';
import { Field, Input, SearchInput } from '@/components/ds/Input';
import { Page, PageHeader } from '@/components/ds/PageHeader';
import { Tabs } from '@/components/ds/Tabs';
import { Tooltip } from '@/components/ds/Tooltip';
import { useToast } from '@/components/ds/Toast';

type View = 'mesas' | 'comandas';
type StatusFilter = 'ALL' | 'OCCUPIED' | 'AVAILABLE';

// Salão screen — every table's occupied/available status and open-tab total
// are always what the backend just returned, never computed here. Polling
// (same 15s cadence as /dashboard/pedidos) is enough for a shared screen a
// few staff members glance at; no WebSocket needed yet.
//
// A "comanda" is the open tab of an occupied table, so the Comandas view is
// derived from the same list — there is no separate tabs-listing endpoint.
export default function MesasPage() {
  const router = useRouter();
  const { accessToken } = useAuth();
  const { branchId } = useActiveBranch();
  const queryClient = useQueryClient();
  const toast = useToast();

  const [view, setView] = useState<View>('mesas');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [number, setNumber] = useState('');
  const [name, setName] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const tablesQuery = useQuery({
    queryKey: ['tables', branchId],
    queryFn: () => tablesApi.list(accessToken as string, branchId as string),
    enabled: !!accessToken && !!branchId,
    refetchInterval: 15_000,
  });

  const tables = tablesQuery.data ?? [];
  const occupied = tables.filter((t) => t.status === 'OCCUPIED');
  const term = search.trim();

  const filtered = tables.filter(
    (t) =>
      (statusFilter === 'ALL' || t.status === statusFilter) &&
      (!term || String(t.number).includes(term) || (t.name ?? '').toLowerCase().includes(term.toLowerCase())),
  );
  const filteredTabs = occupied.filter(
    (t) => !term || String(t.number).includes(term) || (t.name ?? '').toLowerCase().includes(term.toLowerCase()),
  );

  function closeForm() {
    setShowForm(false);
    setError(null);
  }

  async function handleCreate(event: FormEvent) {
    event.preventDefault();
    if (!accessToken || !branchId) return;
    const parsedNumber = Number(number);
    if (!Number.isInteger(parsedNumber) || parsedNumber < 1) {
      setError('Informe um número de mesa válido.');
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await tablesApi.create(accessToken, { branchId, number: parsedNumber, name: name.trim() || undefined });
      setShowForm(false);
      setNumber('');
      setName('');
      toast.success(`Mesa ${parsedNumber} cadastrada.`);
      await queryClient.invalidateQueries({ queryKey: ['tables', branchId] });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Não foi possível criar a mesa.');
    } finally {
      setIsSaving(false);
    }
  }

  function open(table: DiningTable) {
    router.push(`/dashboard/mesas/${table.id}`);
  }

  return (
    <Page>
      <PageHeader
        title="Mesas e Comandas"
        description="Gerencie mesas e comandas e controle pedidos."
        actions={
          <>
            <Tooltip label="Em breve" side="bottom">
              <Button variant="outline" icon={<QrCode className="h-4 w-4" />} disabled>
                Mostrar atalhos QR
              </Button>
            </Tooltip>
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setShowForm(true)} disabled={!branchId}>
              Cadastrar mesas
            </Button>
          </>
        }
      />

      <Tabs
        items={[
          { key: 'mesas', label: 'Mesas', count: tables.length },
          { key: 'comandas', label: 'Comandas', count: occupied.length },
        ]}
        value={view}
        onChange={setView}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="w-full sm:w-72">
          <SearchInput
            placeholder="Buscar mesa por número"
            aria-label="Buscar mesa por número"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        {view === 'mesas' && (
          <Tabs
            variant="pill"
            value={statusFilter}
            onChange={setStatusFilter}
            items={[
              { key: 'ALL', label: 'Todas' },
              { key: 'OCCUPIED', label: 'Em uso', count: occupied.length },
              { key: 'AVAILABLE', label: 'Disponíveis', count: tables.length - occupied.length },
            ]}
          />
        )}
      </div>

      {!branchId ? (
        <LoadingState label="Carregando unidade..." />
      ) : tablesQuery.isLoading ? (
        <LoadingState label="Carregando mesas..." />
      ) : tablesQuery.isError ? (
        <ErrorState message="Não foi possível carregar as mesas." onRetry={() => tablesQuery.refetch()} />
      ) : tables.length === 0 ? (
        <EmptyState
          icon={<LayoutGrid />}
          title="Nenhuma mesa cadastrada ainda"
          description="Cadastre as mesas do salão para abrir comandas e lançar pedidos."
          action={
            <Button icon={<Plus className="h-4 w-4" />} onClick={() => setShowForm(true)}>
              Cadastrar mesas
            </Button>
          }
        />
      ) : view === 'mesas' ? (
        filtered.length === 0 ? (
          <EmptyState icon={<LayoutGrid />} title="Nenhuma mesa encontrada" description="Ajuste a busca ou o filtro." />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {filtered.map((table) => {
              const isOccupied = table.status === 'OCCUPIED';
              return (
                <button
                  key={table.id}
                  type="button"
                  onClick={() => open(table)}
                  disabled={!table.active}
                  className={clsx(
                    'group flex min-h-[7.5rem] flex-col items-start gap-1 rounded-card border p-4 text-left transition-all',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 active:scale-[0.98]',
                    'disabled:cursor-not-allowed disabled:opacity-40',
                    isOccupied
                      ? 'border-warning/40 bg-warning/5 hover:border-warning/70'
                      : 'border-success/30 bg-success/5 hover:border-success/60',
                  )}
                >
                  <span className="text-lg font-bold text-foreground">Mesa {table.number}</span>
                  {table.name && <span className="text-xs text-muted-foreground">{table.name}</span>}
                  <span className="mt-auto flex w-full flex-col items-start gap-1.5 pt-2">
                    <Badge tone={isOccupied ? 'warning' : 'success'} dot>
                      {isOccupied ? 'Em uso' : 'Disponível'}
                    </Badge>
                    {isOccupied && (
                      <span className="text-sm font-semibold text-foreground">
                        {table.openTabItemCount} item(s) · {formatCentsAsBRL(table.openTabTotalCents ?? 0)}
                      </span>
                    )}
                    {!table.active && <span className="text-xs text-subtle">Inativa</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )
      ) : filteredTabs.length === 0 ? (
        <EmptyState
          icon={<Receipt />}
          title="Nenhuma comanda aberta"
          description="Abra uma mesa disponível para iniciar uma comanda."
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filteredTabs.map((table) => (
            <button
              key={table.id}
              type="button"
              onClick={() => open(table)}
              className="text-left focus-visible:outline-none"
            >
              <Card className="flex items-center justify-between gap-3 p-4 transition-colors hover:bg-surface-hover">
                <div>
                  <p className="text-sm font-semibold text-foreground">Comanda · Mesa {table.number}</p>
                  <p className="text-xs text-muted-foreground">
                    {table.name ? `${table.name} · ` : ''}
                    {table.openTabItemCount} item(s)
                  </p>
                </div>
                <span className="text-base font-bold text-foreground">{formatCentsAsBRL(table.openTabTotalCents ?? 0)}</span>
              </Card>
            </button>
          ))}
        </div>
      )}

      <Dialog
        open={showForm}
        onClose={closeForm}
        title="Cadastrar mesa"
        footer={
          <>
            <Button variant="ghost" onClick={closeForm} disabled={isSaving}>
              Cancelar
            </Button>
            <Button type="submit" form="table-form" loading={isSaving}>
              Criar
            </Button>
          </>
        }
      >
        <form id="table-form" onSubmit={handleCreate} className="space-y-3">
          {error && <Alert>{error}</Alert>}
          <Field label="Número">
            <Input type="number" min={1} autoFocus value={number} onChange={(e) => setNumber(e.target.value)} required />
          </Field>
          <Field label="Nome (opcional)">
            <Input value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
        </form>
      </Dialog>
    </Page>
  );
}
