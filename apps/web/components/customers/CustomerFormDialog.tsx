'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { CustomerRecord, customersApi } from '@/lib/customers-api';
import {
  CustomerDraft,
  customerErrorMessage,
  draftToInput,
  draftToPatch,
  EMPTY_DRAFT,
  isEmptyPatch,
  MAX_NOTES,
  toDraft,
  validateDraft,
} from '@/lib/customers-logic';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { Field, Input, Textarea } from '@/components/ds/Input';
import { Alert } from '@/components/ds/States';
import { useToast } from '@/components/ds/Toast';

// Create (customer = null) or edit. The request is one mutation guarded by a synchronous ref:
// React state does not change between two clicks of the same tick, so `isPending` alone cannot
// stop a repeated submit. On failure the dialog stays open with the server's message.
export function CustomerFormDialog({
  open,
  customer,
  onClose,
  onSaved,
}: {
  open: boolean;
  customer: CustomerRecord | null;
  onClose: () => void;
  onSaved?: (customer: CustomerRecord) => void;
}) {
  const { accessToken } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<CustomerDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (open) {
      setDraft(customer ? toDraft(customer) : EMPTY_DRAFT);
      setError(null);
      saving.current = false;
    }
  }, [open, customer]);

  const save = useMutation({
    mutationFn: () => {
      const problem = validateDraft(draft);
      if (problem) throw new Error(problem);
      if (!customer) return customersApi.create(accessToken as string, draftToInput(draft));
      const patch = draftToPatch(draft, customer);
      if (isEmptyPatch(patch)) return Promise.resolve(customer);
      return customersApi.update(accessToken as string, customer.id, patch);
    },
    onSuccess: async (saved) => {
      toast.success(customer ? `Cliente ${saved.name} atualizado.` : `Cliente ${saved.name} cadastrado.`);
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
      onSaved?.(saved);
      onClose();
    },
    onError: (err) => {
      const code = err instanceof ApiError ? err.code : undefined;
      setError(customerErrorMessage(code, err instanceof Error ? err.message : 'Não foi possível salvar o cliente.'));
    },
    onSettled: () => {
      saving.current = false;
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setError(null);
    save.mutate();
  }

  const set = <K extends keyof CustomerDraft>(key: K, value: string) => setDraft((current) => ({ ...current, [key]: value }));
  const busy = save.isPending;

  return (
    <Dialog
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      title={customer ? 'Editar cliente' : 'Novo cliente'}
      description={customer ? undefined : 'Nome e telefone são obrigatórios. Os pedidos antigos não são alterados.'}
      size="md"
    >
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome" className="sm:col-span-2">
            <Input value={draft.name} maxLength={120} autoFocus autoComplete="off" onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Telefone" hint="Com DDD. Ex.: (11) 98765-4321">
            <Input value={draft.phone} maxLength={25} inputMode="tel" autoComplete="off" onChange={(e) => set('phone', e.target.value)} />
          </Field>
          <Field label="CPF (opcional)">
            <Input value={draft.cpf} maxLength={14} inputMode="numeric" autoComplete="off" onChange={(e) => set('cpf', e.target.value)} />
          </Field>
          <Field label="E-mail (opcional)" className="sm:col-span-2">
            <Input type="email" value={draft.email} maxLength={120} autoComplete="off" onChange={(e) => set('email', e.target.value)} />
          </Field>
          <Field label="Observações (opcional)" hint={`${draft.notes.length}/${MAX_NOTES}`} className="sm:col-span-2">
            <Textarea value={draft.notes} rows={3} maxLength={MAX_NOTES} onChange={(e) => set('notes', e.target.value)} />
          </Field>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy} disabled={busy}>
            {customer ? 'Salvar alterações' : 'Cadastrar cliente'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
