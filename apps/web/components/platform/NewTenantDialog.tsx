'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { platformApi, PlatformTenantDetail } from '@/lib/platform-api';
import {
  EMPTY_NEW_TENANT,
  NEW_TENANT_FIELDS,
  NewTenantDraft,
  NewTenantField,
  newTenantError,
  PASSWORD_MIN,
  suggestSlug,
  toNewTenantInput,
  validateNewTenant,
} from '@/lib/platform-logic';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { Input } from '@/components/ds/Input';
import { Alert } from '@/components/ds/States';

// "Novo restaurante": the same creation as `pnpm tenant:provision` (the API calls
// TenantProvisioningService). The slug follows the name until the administrator edits it; the
// API has the final word on every field. The password never leaves this form except in the
// request body, and the confirmation is not even sent.
export function NewTenantDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (tenant: PlatformTenantDetail) => void;
}) {
  const { accessToken } = useAuth();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<NewTenantDraft>(EMPTY_NEW_TENANT);
  const [slugEdited, setSlugEdited] = useState(false);
  const [problems, setProblems] = useState<Partial<Record<NewTenantField, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (open) {
      setDraft(EMPTY_NEW_TENANT);
      setSlugEdited(false);
      setProblems({});
      setError(null);
      saving.current = false;
    }
  }, [open]);

  const create = useMutation({
    mutationFn: () => platformApi.create(accessToken as string, toNewTenantInput(draft)),
    onSuccess: async (tenant) => {
      setDraft(EMPTY_NEW_TENANT);
      await queryClient.invalidateQueries({ queryKey: ['platform'] });
      onCreated(tenant);
    },
    onError: (err) => {
      const { field, message } = newTenantError(
        err instanceof ApiError ? err.code : undefined,
        err instanceof Error ? err.message : 'Não foi possível criar o restaurante.',
      );
      if (field) setProblems({ [field]: message });
      else setError(message);
    },
    onSettled: () => {
      saving.current = false;
    },
  });

  function change(key: NewTenantField, value: string) {
    setDraft((current) => {
      const next = { ...current, [key]: value };
      if (key === 'tenantName' && !slugEdited) next.slug = suggestSlug(value);
      return next;
    });
    if (key === 'slug') setSlugEdited(true);
    setProblems((current) => ({ ...current, [key]: undefined }));
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    setError(null);
    const found = validateNewTenant(draft);
    setProblems(found);
    if (Object.values(found).some(Boolean)) return;
    saving.current = true;
    create.mutate();
  }

  const busy = create.isPending;
  const field = (key: NewTenantField, label: string, hint: string, example: string | null, input: JSX.Element) => (
    <div key={key} className="space-y-1">
      <label htmlFor={`new-tenant-${key}`} className="text-xs font-medium text-foreground">
        {label}
      </label>
      <p className="text-2xs text-muted-foreground">{hint}</p>
      {input}
      {example && <p className="text-2xs text-subtle">Exemplo: {example}</p>}
      {problems[key] && (
        <p className="text-2xs text-danger" role="alert">
          {problems[key]}
        </p>
      )}
    </div>
  );

  return (
    <Dialog
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      title="Novo restaurante"
      description="Cria o restaurante, a unidade principal e a conta do proprietário (OWNER). O delivery começa desligado."
      size="lg"
    >
      <form onSubmit={submit} className="space-y-4" noValidate aria-label="Novo restaurante">
        <div className="grid gap-4 sm:grid-cols-2">
          {NEW_TENANT_FIELDS.map((f) =>
            field(
              f.key,
              f.label,
              f.hint,
              f.example,
              <Input
                id={`new-tenant-${f.key}`}
                name={f.key}
                value={draft[f.key]}
                autoComplete="off"
                autoCapitalize={f.key === 'email' || f.key === 'slug' ? 'none' : undefined}
                inputMode={f.key === 'document' ? 'numeric' : f.key === 'email' ? 'email' : undefined}
                type={f.key === 'email' ? 'email' : 'text'}
                aria-invalid={problems[f.key] ? true : undefined}
                autoFocus={f.key === 'tenantName'}
                onChange={(e) => change(f.key, e.target.value)}
              />,
            ),
          )}
          {field(
            'password',
            'Senha inicial',
            `Senha temporária/inicial do OWNER. Ao menos ${PASSWORD_MIN} caracteres; entregue-a por um canal seguro.`,
            'use uma senha forte com letras, números e símbolos',
            <Input
              id="new-tenant-password"
              name="password"
              type="password"
              autoComplete="new-password"
              value={draft.password}
              aria-invalid={problems.password ? true : undefined}
              onChange={(e) => change('password', e.target.value)}
            />,
          )}
          {field(
            'passwordConfirmation',
            'Confirmar senha',
            'Digite a mesma senha de novo.',
            null,
            <Input
              id="new-tenant-passwordConfirmation"
              name="passwordConfirmation"
              type="password"
              autoComplete="new-password"
              value={draft.passwordConfirmation}
              aria-invalid={problems.passwordConfirmation ? true : undefined}
              onChange={(e) => change('passwordConfirmation', e.target.value)}
            />,
          )}
        </div>

        {error && <Alert>{error}</Alert>}

        <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy}>
            Criar restaurante
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
