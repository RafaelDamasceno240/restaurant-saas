'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Gift, Pencil, Plus, Power } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { loyaltyApi, LoyaltyReward, RewardStatusFilter } from '@/lib/loyalty-api';
import {
  describeRate,
  EMPTY_REWARD,
  formatPoints,
  loyaltyErrorMessage,
  parsePositiveInt,
  RewardDraft,
  toRewardDraft,
  validateProgram,
  validateReward,
} from '@/lib/loyalty-logic';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Card, CardHeader } from '@/components/ds/Card';
import { Dialog } from '@/components/ds/Dialog';
import { Field, Input, Textarea } from '@/components/ds/Input';
import { Page, PageHeader } from '@/components/ds/PageHeader';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Switch } from '@/components/ds/Switch';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { Tabs } from '@/components/ds/Tabs';
import { useToast } from '@/components/ds/Toast';
import { CashbackProgramCard } from '@/components/cashback/CashbackProgramCard';

// The API decides (loyalty.read / loyalty.configure); these only hide what would be refused.
// Managers and cashiers see the program and the catalogue; only owners and administrators
// change the rate and the rewards.
const CAN_READ = ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER'];
const CAN_CONFIGURE = ['OWNER', 'ADMIN'];

const TABS: { key: RewardStatusFilter; label: string }[] = [
  { key: 'active', label: 'Ativas' },
  { key: 'inactive', label: 'Inativas' },
  { key: 'all', label: 'Todas' },
];

const messageOf = (error: unknown, fallback: string) =>
  loyaltyErrorMessage(error instanceof ApiError ? error.code : undefined, error instanceof Error && error.message ? error.message : fallback);

type FormState = { reward: LoyaltyReward | null } | null;

export default function LoyaltyPage() {
  const { user, accessToken } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const roles = user?.roles ?? [];
  const canRead = roles.some((role) => CAN_READ.includes(role));
  const canConfigure = roles.some((role) => CAN_CONFIGURE.includes(role));

  const [status, setStatus] = useState<RewardStatusFilter>('active');
  const [form, setForm] = useState<FormState>(null);
  const [enabled, setEnabled] = useState(false);
  const [pointsPerReal, setPointsPerReal] = useState('1');
  const [programError, setProgramError] = useState<string | null>(null);
  const savingProgram = useRef(false);
  const toggling = useRef(false);

  const program = useQuery({
    queryKey: ['loyalty', 'program'],
    queryFn: () => loyaltyApi.getProgram(accessToken as string),
    enabled: !!accessToken && canRead,
  });
  const rewards = useQuery({
    queryKey: ['loyalty', 'rewards', status],
    queryFn: () => loyaltyApi.listRewards(accessToken as string, status),
    enabled: !!accessToken && canRead,
    placeholderData: (previous) => previous,
  });

  // The form starts from what the API has; it is only a draft until "Salvar".
  useEffect(() => {
    if (program.data) {
      setEnabled(program.data.enabled);
      setPointsPerReal(String(program.data.pointsPerReal));
    }
  }, [program.data]);

  const saveProgram = useMutation({
    mutationFn: () => {
      const problem = validateProgram(pointsPerReal);
      if (problem) throw new Error(problem);
      return loyaltyApi.updateProgram(accessToken as string, { enabled, pointsPerReal: parsePositiveInt(pointsPerReal) as number });
    },
    onSuccess: async (saved) => {
      setProgramError(null);
      toast.success(saved.enabled ? 'Programa de fidelidade ativado.' : 'Programa de fidelidade desativado.');
      await queryClient.invalidateQueries({ queryKey: ['loyalty'] });
    },
    onError: (err) => setProgramError(messageOf(err, 'Não foi possível salvar o programa.')),
    onSettled: () => {
      savingProgram.current = false;
    },
  });

  const toggleReward = useMutation({
    mutationFn: (reward: LoyaltyReward) => loyaltyApi.updateReward(accessToken as string, reward.id, { active: !reward.active }),
    onSuccess: async (saved) => {
      toast.success(saved.active ? `${saved.name} reativada.` : `${saved.name} desativada.`);
      await queryClient.invalidateQueries({ queryKey: ['loyalty', 'rewards'] });
    },
    onError: (err) => toast.error(messageOf(err, 'Não foi possível alterar a recompensa.')),
    onSettled: () => {
      toggling.current = false;
    },
  });

  function submitProgram(event: FormEvent) {
    event.preventDefault();
    if (savingProgram.current) return; // synchronous guard against a double click
    savingProgram.current = true;
    setProgramError(null);
    saveProgram.mutate();
  }

  function onToggle(reward: LoyaltyReward) {
    if (toggling.current) return;
    toggling.current = true;
    toggleReward.mutate(reward);
  }

  if (!canRead) {
    return (
      <Page>
        <EmptyState
          icon={<Gift />}
          title="Sem acesso a Fidelidade"
          description="Somente proprietários, administradores, gerentes e caixas acessam o programa de fidelidade."
        />
      </Page>
    );
  }

  const dirty = program.data ? program.data.enabled !== enabled || String(program.data.pointsPerReal) !== pointsPerReal.trim() : false;
  const rows = rewards.data?.data ?? [];

  return (
    <Page>
      <PageHeader
        title="Fidelidade e cashback"
        description="Pontos trocados por recompensas e cashback usado como saldo em compras futuras, para clientes cadastrados."
        actions={
          canConfigure ? (
            <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setForm({ reward: null })}>
              Nova recompensa
            </Button>
          ) : undefined
        }
      />

      <Card>
        <CardHeader
          title="Programa de pontos"
          description="Pontos são creditados quando o pedido de um cliente cadastrado é concluído ou entregue."
        />
        {program.isPending ? (
          <LoadingState label="Carregando programa..." />
        ) : program.isError ? (
          <ErrorState message="Não foi possível carregar o programa." onRetry={() => void program.refetch()} />
        ) : (
          <form onSubmit={submitProgram} className="space-y-4 p-4" noValidate>
            <div className="flex flex-wrap items-center gap-3">
              <Switch checked={enabled} onChange={setEnabled} disabled={!canConfigure || saveProgram.isPending} label="Programa de fidelidade ativo" />
              <div>
                <p className="text-sm font-medium text-foreground">{enabled ? 'Programa ativo' : 'Programa desativado'}</p>
                <p className="text-xs text-muted-foreground">
                  {enabled ? 'Compras de clientes cadastrados geram pontos.' : 'Nenhuma compra gera pontos e os resgates ficam suspensos.'}
                </p>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-[12rem_minmax(0,1fr)] sm:items-end">
              <Field label="Pontos por R$ 1,00" hint="Número inteiro, de 1 a 1000">
                <Input
                  inputMode="numeric"
                  maxLength={4}
                  value={pointsPerReal}
                  disabled={!canConfigure || saveProgram.isPending}
                  onChange={(event) => setPointsPerReal(event.target.value)}
                />
              </Field>
              <p className="pb-1 text-sm text-muted-foreground">
                {validateProgram(pointsPerReal) === null ? describeRate(parsePositiveInt(pointsPerReal) as number) : ''} sobre o valor dos itens
                já com o desconto do cupom. Taxa de entrega e centavos abaixo de R$ 1,00 não geram pontos.
              </p>
            </div>
            {programError && <Alert tone="danger">{programError}</Alert>}
            {canConfigure ? (
              <div className="flex justify-end">
                <Button type="submit" loading={saveProgram.isPending} disabled={!dirty || saveProgram.isPending}>
                  Salvar programa
                </Button>
              </div>
            ) : (
              <p className="text-xs text-subtle">Somente proprietários e administradores alteram o programa.</p>
            )}
          </form>
        )}
      </Card>

      <CashbackProgramCard canConfigure={canConfigure} />

      <div className="space-y-3">
        <h2 className="text-sm font-semibold text-foreground">Recompensas do programa de pontos</h2>
        <Tabs variant="pill" value={status} onChange={setStatus} items={TABS} />
        {rewards.isPending ? (
          <LoadingState label="Carregando recompensas..." />
        ) : rewards.isError ? (
          <ErrorState message="Não foi possível carregar as recompensas." onRetry={() => void rewards.refetch()} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<Gift />}
            title={status === 'active' ? 'Nenhuma recompensa ativa' : 'Nenhuma recompensa aqui'}
            description="Recompensas são o que o cliente recebe em troca dos pontos: uma sobremesa, uma bebida, um desconto na casa."
            action={
              canConfigure && status === 'active' ? (
                <Button icon={<Plus className="h-4 w-4" aria-hidden />} onClick={() => setForm({ reward: null })}>
                  Nova recompensa
                </Button>
              ) : undefined
            }
          />
        ) : (
          <Card className="overflow-hidden">
            <TableWrap>
              <Table className="min-w-[560px]">
                <THead>
                  <Tr className="hover:bg-transparent">
                    <Th>Recompensa</Th>
                    <Th className="text-right">Custo</Th>
                    <Th>Situação</Th>
                    <Th className="relative">
                      <span className="sr-only">Ações</span>
                    </Th>
                  </Tr>
                </THead>
                <TBody>
                  {rows.map((reward) => (
                    <Tr key={reward.id}>
                      <Td>
                        <div className="font-semibold text-foreground">{reward.name}</div>
                        {reward.description && <div className="text-xs text-muted-foreground">{reward.description}</div>}
                      </Td>
                      <Td className="text-right tabular-nums">{formatPoints(reward.pointsCost)}</Td>
                      <Td>
                        <Badge tone={reward.active ? 'success' : 'neutral'} dot>
                          {reward.active ? 'Ativa' : 'Inativa'}
                        </Badge>
                      </Td>
                      <Td className="text-right">
                        {canConfigure && (
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              icon={<Pencil className="h-4 w-4" aria-hidden />}
                              aria-label={`Editar ${reward.name}`}
                              disabled={toggleReward.isPending}
                              onClick={() => setForm({ reward })}
                            >
                              Editar
                            </Button>
                            <Button
                              size="sm"
                              variant={reward.active ? 'danger-ghost' : 'outline'}
                              icon={<Power className="h-4 w-4" aria-hidden />}
                              aria-label={`${reward.active ? 'Desativar' : 'Reativar'} ${reward.name}`}
                              disabled={toggleReward.isPending}
                              onClick={() => onToggle(reward)}
                            >
                              {reward.active ? 'Desativar' : 'Reativar'}
                            </Button>
                          </div>
                        )}
                      </Td>
                    </Tr>
                  ))}
                </TBody>
              </Table>
            </TableWrap>
          </Card>
        )}
      </div>

      <RewardFormDialog open={form !== null} reward={form?.reward ?? null} onClose={() => setForm(null)} />
    </Page>
  );
}

// Create (reward = null) or edit. One mutation guarded by a synchronous ref; on failure the
// dialog stays open with the server's message.
function RewardFormDialog({ open, reward, onClose }: { open: boolean; reward: LoyaltyReward | null; onClose: () => void }) {
  const { accessToken } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<RewardDraft>(EMPTY_REWARD);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);

  useEffect(() => {
    if (open) {
      setDraft(reward ? toRewardDraft(reward) : EMPTY_REWARD);
      setError(null);
      saving.current = false;
    }
  }, [open, reward]);

  const save = useMutation({
    mutationFn: () => {
      const problem = validateReward(draft);
      if (problem) throw new Error(problem);
      const input = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        pointsCost: parsePositiveInt(draft.pointsCost) as number,
      };
      return reward ? loyaltyApi.updateReward(accessToken as string, reward.id, input) : loyaltyApi.createReward(accessToken as string, input);
    },
    onSuccess: async (saved) => {
      toast.success(reward ? `Recompensa ${saved.name} atualizada.` : `Recompensa ${saved.name} criada.`);
      await queryClient.invalidateQueries({ queryKey: ['loyalty', 'rewards'] });
      onClose();
    },
    onError: (err) => setError(messageOf(err, 'Não foi possível salvar a recompensa.')),
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

  const busy = save.isPending;
  return (
    <Dialog
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      title={reward ? 'Editar recompensa' : 'Nova recompensa'}
      description="Mudar o custo não altera resgates já feitos."
      size="md"
    >
      <form onSubmit={submit} className="space-y-3" noValidate>
        <Field label="Nome">
          <Input value={draft.name} maxLength={80} autoFocus autoComplete="off" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
        </Field>
        <Field label="Custo em pontos">
          <Input value={draft.pointsCost} maxLength={7} inputMode="numeric" autoComplete="off" onChange={(e) => setDraft({ ...draft, pointsCost: e.target.value })} />
        </Field>
        <Field label="Descrição (opcional)" hint={`${draft.description.length}/200`}>
          <Textarea value={draft.description} rows={2} maxLength={200} onChange={(e) => setDraft({ ...draft, description: e.target.value })} />
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy} disabled={busy}>
            {reward ? 'Salvar alterações' : 'Criar recompensa'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
