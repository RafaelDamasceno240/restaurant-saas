'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Undo2 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { loyaltyApi, LoyaltyEntry } from '@/lib/loyalty-api';
import {
  AdjustDraft,
  adjustPoints,
  canAfford,
  describeEntry,
  describeRate,
  EMPTY_ADJUST,
  formatPoints,
  formatSignedPoints,
  isReversible,
  LOYALTY_ENTRY_LABEL,
  LOYALTY_ENTRY_TONE,
  loyaltyErrorMessage,
  MAX_REASON,
  validateAdjust,
  validateReason,
} from '@/lib/loyalty-logic';
import { useActiveBranch } from '@/lib/use-active-branch';
import { useKeyedAction } from '@/lib/use-keyed-action';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Field, Input, Select } from '@/components/ds/Input';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { StatCard } from '@/components/ds/StatCard';
import { useToast } from '@/components/ds/Toast';

// The API decides (loyalty.read/redeem/adjust); these only hide what would be refused.
const CAN_REDEEM = ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'];
const CAN_ADJUST = ['OWNER', 'ADMIN', 'MANAGER'];

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
}

const messageOf = (error: unknown, fallback: string) =>
  loyaltyErrorMessage(error instanceof ApiError ? error.code : undefined, error instanceof Error && error.message ? error.message : fallback);

// Points of one customer: balance, redemption of a reward, manual adjustment and the statement.
// Every number shown comes from the API; this component computes nothing about the balance.
export function CustomerLoyaltyPanel({ customerId, customerActive }: { customerId: string; customerActive: boolean }) {
  const { accessToken, user } = useAuth();
  const { branchId } = useActiveBranch();
  const toast = useToast();
  const queryClient = useQueryClient();
  const roles = user?.roles ?? [];
  const canRedeem = roles.some((role) => CAN_REDEEM.includes(role));
  const canAdjust = roles.some((role) => CAN_ADJUST.includes(role));

  const [page, setPage] = useState(1);
  const [rewardId, setRewardId] = useState('');
  const [adjust, setAdjust] = useState<AdjustDraft>(EMPTY_ADJUST);
  const [reversing, setReversing] = useState<{ entry: LoyaltyEntry; reason: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPage(1);
    setRewardId('');
    setAdjust(EMPTY_ADJUST);
    setReversing(null);
    setError(null);
  }, [customerId]);

  const account = useQuery({
    queryKey: ['loyalty', 'account', customerId],
    queryFn: () => loyaltyApi.getAccount(accessToken as string, customerId),
    enabled: !!accessToken,
  });
  const rewards = useQuery({
    queryKey: ['loyalty', 'rewards', 'active'],
    queryFn: () => loyaltyApi.listRewards(accessToken as string, 'active'),
    enabled: !!accessToken && canRedeem,
  });
  const entries = useQuery({
    queryKey: ['loyalty', 'entries', customerId, page],
    queryFn: () => loyaltyApi.listEntries(accessToken as string, customerId, page),
    enabled: !!accessToken,
    placeholderData: (previous) => previous,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['loyalty'] });

  const redeem = useKeyedAction((input: { rewardId: string; branchId: string }, idempotencyKey) =>
    loyaltyApi.redeem(accessToken as string, customerId, { ...input, idempotencyKey }),
  );
  const adjustAction = useKeyedAction((input: { points: number; reason: string }, idempotencyKey) =>
    loyaltyApi.adjust(accessToken as string, customerId, { ...input, idempotencyKey }),
  );
  const reverseAction = useKeyedAction((input: { entryId: string; reason: string }, idempotencyKey) =>
    loyaltyApi.reverse(accessToken as string, input.entryId, { reason: input.reason, idempotencyKey }),
  );
  const busy = redeem.busy || adjustAction.busy || reverseAction.busy;

  async function onRedeem() {
    if (!rewardId || !branchId) return;
    setError(null);
    try {
      const entry = await redeem.run({ rewardId, branchId });
      if (!entry) return;
      toast.success(`Resgate registrado: ${entry.reward?.name ?? 'recompensa'} (${formatPoints(entry.points)}).`);
      setRewardId('');
      await refresh();
    } catch (err) {
      setError(messageOf(err, 'Não foi possível registrar o resgate.'));
      await refresh();
    }
  }

  async function onAdjust(event: FormEvent) {
    event.preventDefault();
    const problem = validateAdjust(adjust, account.data?.balancePoints ?? 0);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      const entry = await adjustAction.run({ points: adjustPoints(adjust), reason: adjust.reason.trim() });
      if (!entry) return;
      toast.success(`Ajuste lançado: ${formatSignedPoints(entry.points)} pontos.`);
      setAdjust(EMPTY_ADJUST);
      await refresh();
    } catch (err) {
      setError(messageOf(err, 'Não foi possível lançar o ajuste.'));
      await refresh();
    }
  }

  async function onReverse(event: FormEvent) {
    event.preventDefault();
    if (!reversing) return;
    const problem = validateReason(reversing.reason);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    try {
      const entry = await reverseAction.run({ entryId: reversing.entry.id, reason: reversing.reason.trim() });
      if (!entry) return;
      toast.success('Movimentação estornada.');
      setReversing(null);
      await refresh();
    } catch (err) {
      setError(messageOf(err, 'Não foi possível estornar a movimentação.'));
      await refresh();
    }
  }

  if (account.isPending) return <LoadingState label="Carregando pontos..." />;
  if (account.isError || !account.data) {
    return <ErrorState message="Não foi possível carregar os pontos do cliente." onRetry={() => void account.refetch()} />;
  }

  const { balancePoints, program } = account.data;
  const rewardRows = rewards.data?.data ?? [];
  const selected = rewardRows.find((reward) => reward.id === rewardId);

  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard label="Saldo de pontos" value={balancePoints.toLocaleString('pt-BR')} featured />
        <StatCard
          label="Programa"
          value={<span className="text-lg">{program.enabled ? 'Ativo' : 'Desativado'}</span>}
          hint={program.enabled ? describeRate(program.pointsPerReal) : 'Compras não geram pontos'}
        />
      </div>

      {!program.enabled && (
        <Alert tone="info">O programa de fidelidade está desativado: compras não geram pontos e resgates ficam suspensos.</Alert>
      )}
      {error && <Alert tone="danger">{error}</Alert>}

      {canRedeem && program.enabled && (
        <section aria-label="Resgatar recompensa" className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Resgatar recompensa</h3>
          {rewards.isPending ? (
            <LoadingState label="Carregando recompensas..." />
          ) : rewards.isError ? (
            <ErrorState message="Não foi possível carregar as recompensas." onRetry={() => void rewards.refetch()} />
          ) : rewardRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhuma recompensa ativa. Cadastre em Fidelidade.</p>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row">
              <div className="min-w-0 flex-1">
                <Select
                  aria-label="Recompensa"
                  value={rewardId}
                  disabled={busy || !customerActive}
                  onChange={(event) => {
                    setRewardId(event.target.value);
                    redeem.reset();
                  }}
                >
                  <option value="">Escolha a recompensa...</option>
                  {rewardRows.map((reward) => (
                    <option key={reward.id} value={reward.id} disabled={!canAfford(reward, balancePoints)}>
                      {reward.name} — {formatPoints(reward.pointsCost)}
                      {canAfford(reward, balancePoints) ? '' : ' (saldo insuficiente)'}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                icon={<Gift className="h-4 w-4" aria-hidden />}
                loading={redeem.busy}
                disabled={busy || !selected || !branchId || !customerActive || !canAfford(selected, balancePoints)}
                onClick={onRedeem}
              >
                Resgatar
              </Button>
            </div>
          )}
          {!customerActive && <p className="text-xs text-warning">Cliente inativo: resgates suspensos.</p>}
          {!branchId && <p className="text-xs text-warning">Selecione a unidade para registrar o resgate.</p>}
        </section>
      )}

      {canAdjust && (
        <section aria-label="Ajuste manual" className="space-y-2">
          <h3 className="text-sm font-semibold text-foreground">Ajuste manual</h3>
          <form onSubmit={onAdjust} className="grid gap-2 sm:grid-cols-[9rem_7rem_minmax(0,1fr)_auto]" noValidate>
            <Select
              aria-label="Tipo de ajuste"
              value={adjust.direction}
              disabled={busy}
              onChange={(event) => {
                setAdjust({ ...adjust, direction: event.target.value as AdjustDraft['direction'] });
                adjustAction.reset();
              }}
            >
              <option value="credit">Creditar</option>
              <option value="debit">Debitar</option>
            </Select>
            <Input
              aria-label="Pontos"
              placeholder="Pontos"
              inputMode="numeric"
              maxLength={7}
              value={adjust.points}
              disabled={busy}
              onChange={(event) => {
                setAdjust({ ...adjust, points: event.target.value });
                adjustAction.reset();
              }}
            />
            <Input
              aria-label="Motivo do ajuste"
              placeholder="Motivo (obrigatório)"
              maxLength={MAX_REASON}
              value={adjust.reason}
              disabled={busy}
              onChange={(event) => {
                setAdjust({ ...adjust, reason: event.target.value });
                adjustAction.reset();
              }}
            />
            <Button type="submit" variant="outline" loading={adjustAction.busy} disabled={busy}>
              Lançar
            </Button>
          </form>
        </section>
      )}

      <section aria-label="Extrato de pontos" className="space-y-2">
        <h3 className="text-sm font-semibold text-foreground">Extrato</h3>
        {entries.isPending ? (
          <LoadingState label="Carregando extrato..." />
        ) : entries.isError ? (
          <ErrorState message="Não foi possível carregar o extrato." onRetry={() => void entries.refetch()} />
        ) : entries.data.data.length === 0 ? (
          <EmptyState title="Nenhuma movimentação" description="Pontos de compras, resgates e ajustes aparecem aqui." />
        ) : (
          <>
            <ul className="divide-y divide-line rounded-ctl border border-line">
              {entries.data.data.map((entry) => (
                <li key={entry.id} className="space-y-2 px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge tone={LOYALTY_ENTRY_TONE[entry.type]}>{LOYALTY_ENTRY_LABEL[entry.type]}</Badge>
                        <span className={entry.reversed ? 'text-sm text-muted-foreground line-through' : 'text-sm text-foreground'}>
                          {describeEntry(entry)}
                        </span>
                        {entry.reversed && <Badge tone="neutral">Estornado</Badge>}
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {formatDateTime(entry.createdAt)}
                        {entry.createdBy ? ` · ${entry.createdBy.name}` : ''} · saldo {entry.balanceAfter.toLocaleString('pt-BR')}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={entry.points > 0 ? 'text-sm font-semibold tabular-nums text-success' : 'text-sm font-semibold tabular-nums text-foreground'}>
                        {formatSignedPoints(entry.points)}
                      </span>
                      {canAdjust && isReversible(entry) && reversing?.entry.id !== entry.id && (
                        <Button
                          size="sm"
                          variant="ghost"
                          icon={<Undo2 className="h-4 w-4" aria-hidden />}
                          disabled={busy}
                          aria-label={`Estornar ${LOYALTY_ENTRY_LABEL[entry.type].toLowerCase()} de ${formatPoints(entry.points)}`}
                          onClick={() => {
                            reverseAction.reset();
                            setError(null);
                            setReversing({ entry, reason: '' });
                          }}
                        >
                          Estornar
                        </Button>
                      )}
                    </div>
                  </div>
                  {reversing?.entry.id === entry.id && (
                    <form onSubmit={onReverse} className="flex flex-col gap-2 sm:flex-row" noValidate>
                      <div className="min-w-0 flex-1">
                        <Field label="Motivo do estorno">
                          <Input
                            autoFocus
                            maxLength={MAX_REASON}
                            value={reversing.reason}
                            disabled={busy}
                            onChange={(event) => setReversing({ entry, reason: event.target.value })}
                          />
                        </Field>
                      </div>
                      <div className="flex items-end gap-2">
                        <Button type="submit" variant="danger" size="sm" loading={reverseAction.busy} disabled={busy}>
                          Confirmar estorno
                        </Button>
                        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setReversing(null)}>
                          Cancelar
                        </Button>
                      </div>
                    </form>
                  )}
                </li>
              ))}
            </ul>
            {entries.data.meta.totalPages > 1 && (
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>
                  Página {entries.data.meta.page} de {entries.data.meta.totalPages} · {entries.data.meta.total} movimentações
                </span>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                    Anterior
                  </Button>
                  <Button size="sm" variant="outline" disabled={page >= entries.data.meta.totalPages} onClick={() => setPage((p) => p + 1)}>
                    Próxima
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
