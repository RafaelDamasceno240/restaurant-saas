'use client';

import { useDeferredValue, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { UserRound, UserRoundPlus, X } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { customersApi } from '@/lib/customers-api';
import { formatPhone } from '@/lib/customers-logic';
import { Button } from '@/components/ds/Button';
import { SearchInput } from '@/components/ds/Input';
import { CustomerFormDialog } from './CustomerFormDialog';

export interface PickedCustomer {
  id: string;
  name: string;
  phone: string;
}

const MIN_SEARCH = 2;
const MAX_RESULTS = 6;

// Finds a customer of the registry (name, phone or CPF) or registers a new one on the spot, for
// every screen that attaches a customer to a sale. It only ever hands back the customer's ID
// and what to show: whether that customer may really be linked is decided by the API when the
// sale is sent (same tenant, active, customers.read).
export function CustomerPicker({
  value,
  onChange,
  disabled,
  label = 'Cliente cadastrado',
}: {
  value: PickedCustomer | null;
  onChange: (customer: PickedCustomer | null) => void;
  disabled?: boolean;
  label?: string;
}) {
  const { accessToken } = useAuth();
  const [text, setText] = useState('');
  const [creating, setCreating] = useState(false);
  const search = useDeferredValue(text.trim());
  const searching = search.length >= MIN_SEARCH;

  const results = useQuery({
    queryKey: ['customers', 'picker', search],
    queryFn: () => customersApi.list(accessToken as string, { search, status: 'active', pageSize: MAX_RESULTS }),
    enabled: !!accessToken && searching && value === null,
    staleTime: 15_000,
  });

  function pick(customer: PickedCustomer) {
    setText('');
    onChange(customer);
  }

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-ctl border border-accent/40 bg-accent/5 px-3 py-2">
        <UserRound className="h-4 w-4 shrink-0 text-accent" aria-hidden />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-foreground">{value.name}</p>
          <p className="text-xs tabular-nums text-muted-foreground">{formatPhone(value.phone)}</p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remover cliente ${value.name}`}
          disabled={disabled}
          onClick={() => onChange(null)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  const rows = results.data?.data ?? [];
  return (
    <div className="space-y-1.5">
      <div className="flex gap-2">
        <div className="min-w-0 flex-1">
          <SearchInput
            placeholder={`${label}: nome, telefone ou CPF`}
            aria-label={label}
            maxLength={120}
            autoComplete="off"
            value={text}
            disabled={disabled}
            onChange={(event) => setText(event.target.value)}
          />
        </div>
        <Button
          variant="outline"
          size="icon"
          aria-label="Cadastrar novo cliente"
          title="Cadastrar novo cliente"
          disabled={disabled}
          onClick={() => setCreating(true)}
        >
          <UserRoundPlus className="h-4 w-4" />
        </Button>
      </div>

      {searching && (
        <div className="rounded-ctl border border-line bg-surface-2" role="listbox" aria-label="Clientes encontrados">
          {results.isPending ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Buscando...</p>
          ) : results.isError ? (
            <p className="px-3 py-2 text-xs text-danger">
              Não foi possível buscar clientes.{' '}
              <button type="button" className="underline" onClick={() => void results.refetch()}>
                Tentar novamente
              </button>
            </p>
          ) : rows.length === 0 ? (
            <p className="px-3 py-2 text-xs text-muted-foreground">Nenhum cliente ativo encontrado.</p>
          ) : (
            <ul className="max-h-48 divide-y divide-line overflow-y-auto">
              {rows.map((customer) => (
                <li key={customer.id}>
                  <button
                    type="button"
                    role="option"
                    aria-selected={false}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none"
                    onClick={() => pick({ id: customer.id, name: customer.name, phone: customer.phone })}
                  >
                    <span className="min-w-0 truncate font-medium text-foreground">{customer.name}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatPhone(customer.phone)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <CustomerFormDialog
        open={creating}
        customer={null}
        onClose={() => setCreating(false)}
        onSaved={(saved) => pick({ id: saved.id, name: saved.name, phone: saved.phone })}
      />
    </div>
  );
}
