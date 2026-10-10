'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { AccessibleBranch } from '@/lib/branches-api';
import { StaffRole, StaffUser, usersApi } from '@/lib/users-api';
import {
  assignableRoles,
  draftToInput,
  draftToPatch,
  EMPTY_DRAFT,
  isEmptyPatch,
  PASSWORD_MAX,
  PASSWORD_MIN,
  ROLE_HINT,
  ROLE_LABEL,
  roleNeedsBranch,
  toDraft,
  UserDraft,
  userErrorMessage,
  validateDraft,
} from '@/lib/users-logic';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { Field, Input, Select } from '@/components/ds/Input';
import { Alert } from '@/components/ds/States';
import { useToast } from '@/components/ds/Toast';

// Create (user = null) or edit. E-mail and password are only set at creation: the e-mail is the
// login, and the password has its own dialog. Same submit guard as the other forms: a
// synchronous ref, because `isPending` does not change between two clicks of the same tick.
export function UserFormDialog({
  open,
  user,
  branches,
  onClose,
}: {
  open: boolean;
  user: StaffUser | null;
  branches: AccessibleBranch[];
  onClose: () => void;
}) {
  const { accessToken, user: me } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<UserDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (open) {
      setDraft(user ? toDraft(user) : EMPTY_DRAFT);
      setError(null);
      saving.current = false;
    }
  }, [open, user]);

  const mode = user ? 'edit' : 'create';
  const roles = assignableRoles(me?.roles ?? []);
  const showBranches = !!draft.role && roleNeedsBranch(draft.role) && branches.length > 1;

  const save = useMutation({
    mutationFn: () => {
      const problem = validateDraft(draft, mode, branches.length);
      if (problem) throw new Error(problem);
      if (!user) return usersApi.create(accessToken as string, draftToInput(draft, branches.length));
      const patch = draftToPatch(draft, user, branches.length);
      if (isEmptyPatch(patch)) return Promise.resolve(user);
      return usersApi.update(accessToken as string, user.id, patch);
    },
    onSuccess: async (saved) => {
      toast.success(user ? `${saved.name} atualizado.` : `${saved.name} cadastrado. Entregue o e-mail e a senha à pessoa.`);
      await queryClient.invalidateQueries({ queryKey: ['users'] });
      onClose();
    },
    onError: (err) => {
      const code = err instanceof ApiError ? err.code : undefined;
      setError(userErrorMessage(code, err instanceof Error ? err.message : 'Não foi possível salvar.'));
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

  const toggleBranch = (id: string) =>
    setDraft((current) => ({
      ...current,
      branchIds: current.branchIds.includes(id) ? current.branchIds.filter((b) => b !== id) : [...current.branchIds, id],
    }));
  const busy = save.isPending;

  return (
    <Dialog
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      title={user ? 'Editar funcionário' : 'Novo funcionário'}
      description={
        user
          ? 'Mudar o papel encerra as sessões abertas desta pessoa; ela entra de novo com a mesma senha.'
          : 'A pessoa entra com o e-mail e a senha que você definir aqui.'
      }
      size="md"
    >
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Nome" className="sm:col-span-2">
            <Input
              value={draft.name}
              maxLength={120}
              autoFocus
              autoComplete="off"
              onChange={(e) => setDraft((current) => ({ ...current, name: e.target.value }))}
            />
          </Field>
          {user ? (
            <Field label="E-mail (login)" hint="O e-mail não pode ser alterado." className="sm:col-span-2">
              <Input value={draft.email} disabled readOnly />
            </Field>
          ) : (
            <>
              <Field label="E-mail (login)">
                <Input
                  type="email"
                  inputMode="email"
                  autoCapitalize="none"
                  value={draft.email}
                  maxLength={254}
                  autoComplete="off"
                  onChange={(e) => setDraft((current) => ({ ...current, email: e.target.value }))}
                />
              </Field>
              <Field label="Senha inicial" hint={`Ao menos ${PASSWORD_MIN} caracteres.`}>
                <Input
                  type="password"
                  value={draft.password}
                  maxLength={PASSWORD_MAX}
                  autoComplete="new-password"
                  onChange={(e) => setDraft((current) => ({ ...current, password: e.target.value }))}
                />
              </Field>
            </>
          )}
          <Field label="Papel" hint={draft.role ? ROLE_HINT[draft.role] : undefined} className="sm:col-span-2">
            <Select
              value={draft.role}
              onChange={(e) => setDraft((current) => ({ ...current, role: e.target.value as StaffRole | '' }))}
            >
              <option value="">Escolha...</option>
              {/* A role the caller cannot hand out is still shown when it is the current one. */}
              {draft.role && !roles.includes(draft.role) && <option value={draft.role}>{ROLE_LABEL[draft.role]}</option>}
              {roles.map((role) => (
                <option key={role} value={role}>
                  {ROLE_LABEL[role]}
                </option>
              ))}
            </Select>
          </Field>
          {showBranches && (
            <fieldset className="space-y-1 sm:col-span-2">
              <legend className="text-xs font-medium text-muted-foreground">Unidades em que trabalha</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {branches.map((branch) => (
                  <label
                    key={branch.id}
                    className="flex items-center gap-2 rounded-ctl border border-line bg-surface-2 px-3 py-2 text-sm text-foreground touch:py-3"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 accent-accent"
                      checked={draft.branchIds.includes(branch.id)}
                      onChange={() => toggleBranch(branch.id)}
                    />
                    <span className="min-w-0 truncate">{branch.name}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          )}
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy} disabled={busy}>
            {user ? 'Salvar alterações' : 'Cadastrar funcionário'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
