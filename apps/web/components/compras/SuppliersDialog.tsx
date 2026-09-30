'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Pencil, Plus, Power } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { Supplier, SupplierInput, suppliersApi } from '@/lib/purchases-api';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { Field, Input, Textarea } from '@/components/ds/Input';
import { Alert, EmptyState, LoadingState } from '@/components/ds/States';
import { useToast } from '@/components/ds/Toast';
import { useErrorMessage, useRefreshInventory } from '@/components/estoque/use-inventory';
import { useSuppliers } from './use-purchases';

interface Draft {
  name: string;
  document: string;
  phone: string;
  email: string;
  notes: string;
}

const EMPTY: Draft = { name: '', document: '', phone: '', email: '', notes: '' };

function toDraft(supplier: Supplier): Draft {
  return {
    name: supplier.name,
    document: supplier.document ?? '',
    phone: supplier.phone ?? '',
    email: supplier.email ?? '',
    notes: supplier.notes ?? '',
  };
}

export function SuppliersDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { accessToken } = useAuth();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const refresh = useRefreshInventory();
  const suppliers = useSuppliers(true);
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setEditing(null);
      setError(null);
    }
  }, [open]);

  function startEdit(target: Supplier | 'new') {
    setEditing(target);
    setDraft(target === 'new' ? EMPTY : toDraft(target));
    setError(null);
  }

  const save = useMutation({
    mutationFn: () => {
      const name = draft.name.trim();
      if (name.length < 2) throw new Error('Informe o nome do fornecedor.');
      const input: SupplierInput = {
        name,
        document: draft.document,
        phone: draft.phone,
        email: draft.email,
        notes: draft.notes,
      };
      return editing === 'new' || editing === null
        ? suppliersApi.create(accessToken as string, input)
        : suppliersApi.update(accessToken as string, editing.id, input);
    },
    onSuccess: (supplier) => {
      toast.success(`Fornecedor ${supplier.name} salvo.`);
      void refresh();
      setEditing(null);
    },
    onError: (err) => setError(errorMessage(err, 'Não foi possível salvar o fornecedor.')),
  });

  const toggle = useMutation({
    mutationFn: (supplier: Supplier) => suppliersApi.update(accessToken as string, supplier.id, { active: !supplier.active }),
    onSuccess: (supplier) => {
      toast.success(supplier.active ? `${supplier.name} reativado.` : `${supplier.name} desativado.`);
      void refresh();
    },
    onError: (err) => toast.error(errorMessage(err, 'Não foi possível alterar o fornecedor.')),
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!save.isPending) save.mutate();
  }

  const set = <K extends keyof Draft>(key: K, value: string) => setDraft((current) => ({ ...current, [key]: value }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Fornecedores"
      description="Fornecedores desativados não aparecem em novas compras, mas o histórico é mantido."
      size="lg"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      {editing ? (
        <form onSubmit={submit} className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Nome" className="sm:col-span-2">
              <Input value={draft.name} maxLength={120} onChange={(e) => set('name', e.target.value)} autoFocus />
            </Field>
            <Field label="Documento (opcional)">
              <Input value={draft.document} maxLength={30} onChange={(e) => set('document', e.target.value)} />
            </Field>
            <Field label="Telefone (opcional)">
              <Input value={draft.phone} maxLength={30} onChange={(e) => set('phone', e.target.value)} />
            </Field>
            <Field label="E-mail (opcional)" className="sm:col-span-2">
              <Input type="email" value={draft.email} maxLength={120} onChange={(e) => set('email', e.target.value)} />
            </Field>
            <Field label="Observações (opcional)" className="sm:col-span-2">
              <Textarea value={draft.notes} maxLength={500} rows={2} onChange={(e) => set('notes', e.target.value)} />
            </Field>
          </div>
          {error && <Alert tone="danger">{error}</Alert>}
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setEditing(null)} disabled={save.isPending}>
              Voltar
            </Button>
            <Button type="submit" loading={save.isPending}>
              Salvar fornecedor
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <div className="flex justify-end">
            <Button size="sm" icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => startEdit('new')}>
              Novo fornecedor
            </Button>
          </div>
          {suppliers.isLoading ? (
            <LoadingState label="Carregando fornecedores..." />
          ) : (suppliers.data ?? []).length === 0 ? (
            <EmptyState title="Nenhum fornecedor cadastrado" description="Cadastre o primeiro para registrar compras." />
          ) : (
            <ul className="divide-y divide-line rounded-ctl border border-line">
              {(suppliers.data ?? []).map((supplier) => (
                <li key={supplier.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-foreground">{supplier.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {[supplier.phone, supplier.email, supplier.document].filter(Boolean).join(' · ') || 'Sem contato informado'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {!supplier.active && <Badge tone="neutral">Inativo</Badge>}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Editar ${supplier.name}`}
                      onClick={() => startEdit(supplier)}
                      icon={<Pencil className="h-4 w-4" aria-hidden />}
                    />
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={supplier.active ? `Desativar ${supplier.name}` : `Reativar ${supplier.name}`}
                      disabled={toggle.isPending}
                      onClick={() => toggle.mutate(supplier)}
                      icon={<Power className="h-4 w-4" aria-hidden />}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  );
}
