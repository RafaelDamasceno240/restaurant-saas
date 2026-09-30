'use client';

import { useDeferredValue, useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Contact, Plus, Search } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { formatCents } from '@/lib/cash-api';
import { CustomerDetail, CustomerRecord, CustomerStatusFilter, customersApi } from '@/lib/customers-api';
import {
  CUSTOMER_STATUS_TONE,
  CUSTOMER_TAB_LABEL,
  CUSTOMER_TABS,
  formatPhone,
  isFiltering,
  lastOrderLabel,
} from '@/lib/customers-logic';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Card } from '@/components/ds/Card';
import { SearchInput } from '@/components/ds/Input';
import { Page, PageHeader } from '@/components/ds/PageHeader';
import { EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { Tabs } from '@/components/ds/Tabs';
import { CustomerDetailDialog } from '@/components/customers/CustomerDetailDialog';
import { CustomerFormDialog } from '@/components/customers/CustomerFormDialog';

// The API decides who may do what (customers.read/create/update); these only hide controls
// the caller would be refused anyway. CASHIER reads and creates (PDV); editing is management.
const MANAGEMENT = ['OWNER', 'ADMIN', 'MANAGER'];
const CAN_READ = [...MANAGEMENT, 'CASHIER'];

type FormState = { customer: CustomerRecord | null } | null;

export default function CustomersPage() {
  const { user, accessToken } = useAuth();
  const roles = user?.roles ?? [];
  const canRead = roles.some((role) => CAN_READ.includes(role));
  const canUpdate = roles.some((role) => MANAGEMENT.includes(role));

  const [status, setStatus] = useState<CustomerStatusFilter>('active');
  const [searchText, setSearchText] = useState('');
  const [page, setPage] = useState(1);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(null);
  const search = useDeferredValue(searchText.trim());

  useEffect(() => setPage(1), [status, search]);

  const query = useQuery({
    queryKey: ['customers', 'list', status, search, page],
    queryFn: () => customersApi.list(accessToken as string, { status, search: search || undefined, page }),
    enabled: !!accessToken && canRead,
    placeholderData: (previous) => previous,
  });

  function clearFilters() {
    setSearchText('');
    setStatus('active');
  }

  function editFromDetail(customer: CustomerDetail) {
    setDetailId(null);
    setForm({
      customer: {
        id: customer.id,
        name: customer.name,
        phone: customer.phone,
        email: customer.email,
        cpf: customer.cpf,
        notes: customer.notes,
        active: customer.active,
        createdAt: customer.createdAt,
        updatedAt: customer.updatedAt,
      },
    });
  }

  if (!canRead) {
    return (
      <Page>
        <EmptyState
          icon={<Contact />}
          title="Sem acesso a Clientes"
          description="Somente proprietários, administradores, gerentes e caixas acessam o cadastro de clientes."
        />
      </Page>
    );
  }

  const data = query.data;
  const rows = data?.data ?? [];
  const filtering = isFiltering(search, status);
  const tabCount = (key: CustomerStatusFilter) =>
    data ? (key === 'all' ? data.summary.active + data.summary.inactive : data.summary[key]) : undefined;

  return (
    <Page wide>
      <PageHeader
        title="Clientes"
        description="Cadastro de clientes do restaurante, com histórico e métricas de pedidos."
        actions={
          <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setForm({ customer: null })}>
            Novo cliente
          </Button>
        }
      />

      <Tabs
        variant="pill"
        value={status}
        onChange={setStatus}
        items={CUSTOMER_TABS.map((key) => ({ key, label: CUSTOMER_TAB_LABEL[key], count: tabCount(key) }))}
      />

      <Card className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_auto]">
        <SearchInput
          placeholder="Buscar por nome, telefone, e-mail ou CPF..."
          aria-label="Buscar clientes"
          maxLength={120}
          value={searchText}
          onChange={(event) => setSearchText(event.target.value)}
        />
        <Button variant="ghost" onClick={clearFilters} disabled={!filtering && searchText === ''}>
          Limpar filtros
        </Button>
      </Card>

      {query.isPending ? (
        <LoadingState label="Carregando clientes..." />
      ) : query.isError ? (
        <ErrorState message="Não foi possível carregar os clientes." onRetry={() => void query.refetch()} />
      ) : rows.length === 0 ? (
        <EmptyState
          icon={filtering ? <Search /> : <Contact />}
          title={filtering ? 'Nenhum cliente encontrado' : 'Nenhum cliente cadastrado'}
          description={
            filtering
              ? 'Ajuste a busca ou os filtros, ou limpe-os para ver todos.'
              : 'Cadastre o primeiro cliente para acompanhar pedidos e gastos.'
          }
          action={
            filtering ? (
              <Button variant="outline" onClick={clearFilters}>
                Limpar filtros
              </Button>
            ) : (
              <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setForm({ customer: null })}>
                Novo cliente
              </Button>
            )
          }
        />
      ) : (
        <Card className="overflow-hidden">
          <TableWrap>
            <Table className="min-w-[760px]">
              <THead>
                <Tr className="hover:bg-transparent">
                  <Th>Cliente</Th>
                  <Th>E-mail</Th>
                  <Th className="text-right">Pedidos</Th>
                  <Th className="text-right">Total gasto</Th>
                  <Th>Última compra</Th>
                  <Th>Situação</Th>
                  <Th className="relative">
                    <span className="sr-only">Ações</span>
                  </Th>
                </Tr>
              </THead>
              <TBody>
                {rows.map((customer) => (
                  <Tr key={customer.id}>
                    <Td>
                      <div className="font-semibold text-foreground">{customer.name}</div>
                      <div className="text-xs tabular-nums text-muted-foreground">{formatPhone(customer.phone)}</div>
                    </Td>
                    <Td className="max-w-[16rem]">
                      <span className="block truncate text-muted-foreground" title={customer.email ?? undefined}>
                        {customer.email ?? '—'}
                      </span>
                    </Td>
                    <Td className="text-right tabular-nums">{customer.ordersCount}</Td>
                    <Td className="text-right tabular-nums">{formatCents(customer.totalSpentCents)}</Td>
                    <Td className="text-muted-foreground">{lastOrderLabel(customer.lastOrderAt)}</Td>
                    <Td>
                      <Badge tone={CUSTOMER_STATUS_TONE[customer.active ? 'active' : 'inactive']} dot>
                        {customer.active ? 'Ativo' : 'Inativo'}
                      </Badge>
                    </Td>
                    <Td className="text-right">
                      <Button size="sm" variant="outline" aria-label={`Ver cliente ${customer.name}`} onClick={() => setDetailId(customer.id)}>
                        Ver
                      </Button>
                    </Td>
                  </Tr>
                ))}
              </TBody>
            </Table>
          </TableWrap>
          {data && data.meta.totalPages > 1 && (
            <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-muted-foreground">
              <span>
                Página {data.meta.page} de {data.meta.totalPages} · {data.meta.total} clientes
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

      <CustomerDetailDialog customerId={detailId} canUpdate={canUpdate} onClose={() => setDetailId(null)} onEdit={editFromDetail} />
      <CustomerFormDialog
        open={form !== null}
        customer={form?.customer ?? null}
        onClose={() => setForm(null)}
        onSaved={(saved) => setDetailId(saved.id)}
      />
    </Page>
  );
}
