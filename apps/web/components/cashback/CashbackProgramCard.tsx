'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { formatCents } from '@/lib/cash-api';
import { cashbackApi } from '@/lib/cashback-api';
import {
  cashbackErrorMessage,
  describeProgram,
  draftToProgram,
  isProgramDirty,
  ProgramDraft,
  toProgramDraft,
  validateProgramDraft,
} from '@/lib/cashback-logic';
import { Button } from '@/components/ds/Button';
import { Card, CardHeader } from '@/components/ds/Card';
import { Field, Input } from '@/components/ds/Input';
import { Alert, ErrorState, LoadingState } from '@/components/ds/States';
import { Switch } from '@/components/ds/Switch';
import { useToast } from '@/components/ds/Toast';

const messageOf = (error: unknown, fallback: string) =>
  cashbackErrorMessage(error instanceof ApiError ? error.code : undefined, error instanceof Error && error.message ? error.message : fallback);

const INITIAL: ProgramDraft = { enabled: false, rate: '5', expireDays: '' };

// Cashback settings of the restaurant. `canConfigure` only hides the controls: the API refuses
// a change from anyone without cashback.configure.
export function CashbackProgramCard({ canConfigure }: { canConfigure: boolean }) {
  const { accessToken } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ProgramDraft>(INITIAL);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const expiring = useRef(false);

  const program = useQuery({
    queryKey: ['cashback', 'program'],
    queryFn: () => cashbackApi.getProgram(accessToken as string),
    enabled: !!accessToken,
  });

  // The form starts from what the API has; it is only a draft until "Salvar".
  useEffect(() => {
    if (program.data) setDraft(toProgramDraft(program.data));
  }, [program.data]);

  const save = useMutation({
    mutationFn: () => {
      const problem = validateProgramDraft(draft);
      if (problem) throw new Error(problem);
      return cashbackApi.updateProgram(accessToken as string, draftToProgram(draft));
    },
    onSuccess: async (saved) => {
      setError(null);
      toast.success(saved.enabled ? 'Cashback ativado.' : 'Cashback desativado.');
      await queryClient.invalidateQueries({ queryKey: ['cashback'] });
    },
    onError: (err) => setError(messageOf(err, 'Não foi possível salvar o cashback.')),
    onSettled: () => {
      saving.current = false;
    },
  });

  const expire = useMutation({
    mutationFn: () => cashbackApi.expireIdle(accessToken as string),
    onSuccess: async (result) => {
      toast.success(
        result.expiredAccounts === 0
          ? 'Nenhum saldo expirado para baixar.'
          : `${result.expiredAccounts} saldo(s) expirado(s) baixado(s): ${formatCents(result.expiredCents)}.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['cashback'] });
    },
    onError: (err) => toast.error(messageOf(err, 'Não foi possível baixar os saldos expirados.')),
    onSettled: () => {
      expiring.current = false;
    },
  });

  function submit(event: FormEvent) {
    event.preventDefault();
    if (saving.current) return; // synchronous guard against a double click
    saving.current = true;
    setError(null);
    save.mutate();
  }

  function runExpire() {
    if (expiring.current) return;
    expiring.current = true;
    expire.mutate();
  }

  const stored = program.data;
  const valid = validateProgramDraft(draft) === null;
  const dirty = stored && valid ? isProgramDirty(draft, stored) : !!stored && !valid;
  const busy = save.isPending;

  return (
    <Card>
      <CardHeader
        title="Cashback"
        description="Parte do valor pago volta como saldo para o cliente usar em compras futuras."
      />
      {program.isPending ? (
        <LoadingState label="Carregando cashback..." />
      ) : program.isError || !stored ? (
        <ErrorState message="Não foi possível carregar o cashback." onRetry={() => void program.refetch()} />
      ) : (
        <form onSubmit={submit} className="space-y-4 p-4" noValidate>
          <div className="flex flex-wrap items-center gap-3">
            <Switch
              checked={draft.enabled}
              onChange={(enabled) => setDraft({ ...draft, enabled })}
              disabled={!canConfigure || busy}
              label="Cashback ativo"
            />
            <div>
              <p className="text-sm font-medium text-foreground">{draft.enabled ? 'Cashback ativo' : 'Cashback desativado'}</p>
              <p className="text-xs text-muted-foreground">
                {draft.enabled
                  ? 'Compras concluídas de clientes cadastrados geram saldo.'
                  : 'Nenhuma compra gera saldo e o saldo existente não pode ser usado.'}
              </p>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Percentual de cashback (%)" hint="De 0,01 a 50, até duas casas decimais">
              <Input
                inputMode="decimal"
                maxLength={5}
                value={draft.rate}
                disabled={!canConfigure || busy}
                onChange={(event) => setDraft({ ...draft, rate: event.target.value })}
              />
            </Field>
            <Field label="Expira após (dias sem compra nem uso)" hint="Deixe em branco para o saldo não expirar">
              <Input
                inputMode="numeric"
                maxLength={4}
                value={draft.expireDays}
                disabled={!canConfigure || busy}
                onChange={(event) => setDraft({ ...draft, expireDays: event.target.value })}
              />
            </Field>
          </div>
          <p className="text-sm text-muted-foreground">
            {valid ? `${describeProgram(draftToProgram(draft))}. ` : ''}
            O cashback incide sobre os itens já com o desconto do cupom e sem a parte paga com cashback; a taxa de entrega não gera
            saldo. Pedido cancelado devolve ao cliente o cashback que usou.
          </p>
          {error && <Alert tone="danger">{error}</Alert>}
          {canConfigure ? (
            <div className="flex flex-wrap justify-end gap-2">
              {stored.expireAfterDays !== null && (
                <Button variant="ghost" loading={expire.isPending} disabled={expire.isPending || busy} onClick={runExpire}>
                  Baixar saldos expirados
                </Button>
              )}
              <Button type="submit" loading={busy} disabled={!dirty || busy}>
                Salvar cashback
              </Button>
            </div>
          ) : (
            <p className="text-xs text-subtle">Somente proprietários e administradores alteram o cashback.</p>
          )}
        </form>
      )}
    </Card>
  );
}
