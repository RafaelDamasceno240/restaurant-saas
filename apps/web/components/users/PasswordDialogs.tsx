'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { StaffUser, usersApi } from '@/lib/users-api';
import { PASSWORD_MAX, PASSWORD_MIN, userErrorMessage, validatePassword } from '@/lib/users-logic';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { Field, Input } from '@/components/ds/Input';
import { Alert } from '@/components/ds/States';
import { useToast } from '@/components/ds/Toast';

const messageOf = (err: unknown, fallback: string) =>
  userErrorMessage(err instanceof ApiError ? err.code : undefined, err instanceof Error ? err.message : fallback);

// The manager types a new password for someone else. There is no e-mail flow: the manager
// tells the person the new password.
export function ResetPasswordDialog({ user, onClose }: { user: StaffUser | null; onClose: () => void }) {
  const { accessToken } = useAuth();
  const toast = useToast();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (user) {
      setPassword('');
      setConfirmation('');
      setError(null);
      saving.current = false;
    }
  }, [user]);

  const reset = useMutation({
    mutationFn: () => {
      const problem = validatePassword(password);
      if (problem) throw new Error(problem);
      if (password !== confirmation) throw new Error('As duas senhas não são iguais.');
      return usersApi.resetPassword(accessToken as string, (user as StaffUser).id, password);
    },
    onSuccess: () => {
      toast.success(`Senha de ${user?.name} redefinida. As sessões abertas foram encerradas.`);
      onClose();
    },
    onError: (err) => setError(messageOf(err, 'Não foi possível redefinir a senha.')),
    onSettled: () => {
      saving.current = false;
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setError(null);
    reset.mutate();
  }

  const busy = reset.isPending;
  return (
    <Dialog
      open={!!user}
      onClose={() => (busy ? undefined : onClose())}
      title="Redefinir senha"
      description={user ? `Nova senha para ${user.name}. Todas as sessões abertas desta pessoa serão encerradas.` : undefined}
      size="sm"
    >
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field label="Nova senha" hint={`Ao menos ${PASSWORD_MIN} caracteres.`}>
          <Input
            type="password"
            value={password}
            maxLength={PASSWORD_MAX}
            autoFocus
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Repita a nova senha">
          <Input
            type="password"
            value={confirmation}
            maxLength={PASSWORD_MAX}
            autoComplete="new-password"
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy} disabled={busy}>
            Redefinir senha
          </Button>
        </div>
      </form>
    </Dialog>
  );
}

// Anyone changes their own password, proving they know the current one. The API ends every
// session of the account with it, so `onChanged` is where the caller signs the person out.
export function ChangeOwnPasswordDialog({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged: () => void;
}) {
  const { accessToken } = useAuth();
  const [current, setCurrent] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (open) {
      setCurrent('');
      setPassword('');
      setConfirmation('');
      setError(null);
      saving.current = false;
    }
  }, [open]);

  const change = useMutation({
    mutationFn: () => {
      if (!current) throw new Error('Informe a senha atual.');
      const problem = validatePassword(password);
      if (problem) throw new Error(problem);
      if (password !== confirmation) throw new Error('As duas senhas não são iguais.');
      if (password === current) throw new Error('A nova senha precisa ser diferente da atual.');
      return usersApi.changeOwnPassword(accessToken as string, current, password);
    },
    onSuccess: () => onChanged(),
    onError: (err) => setError(messageOf(err, 'Não foi possível trocar a senha.')),
    onSettled: () => {
      saving.current = false;
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setError(null);
    change.mutate();
  }

  const busy = change.isPending;
  return (
    <Dialog
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      title="Trocar minha senha"
      description="Depois da troca você entra de novo com a senha nova, neste e nos outros aparelhos."
      size="sm"
    >
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field label="Senha atual">
          <Input
            type="password"
            value={current}
            maxLength={PASSWORD_MAX}
            autoFocus
            autoComplete="current-password"
            onChange={(e) => setCurrent(e.target.value)}
          />
        </Field>
        <Field label="Nova senha" hint={`Ao menos ${PASSWORD_MIN} caracteres.`}>
          <Input
            type="password"
            value={password}
            maxLength={PASSWORD_MAX}
            autoComplete="new-password"
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        <Field label="Repita a nova senha">
          <Input
            type="password"
            value={confirmation}
            maxLength={PASSWORD_MAX}
            autoComplete="new-password"
            onChange={(e) => setConfirmation(e.target.value)}
          />
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy} disabled={busy}>
            Trocar senha
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
