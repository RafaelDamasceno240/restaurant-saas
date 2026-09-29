'use client';

import { FormEvent, ReactNode, useEffect, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDownCircle, ArrowUpCircle, CheckCircle2, LockKeyhole, Wallet } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { useActiveBranch } from '@/lib/use-active-branch';
import {
  CashSession,
  addMovement,
  closeSession,
  formatCents,
  getCurrentSession,
  openSession,
  parseBRLToCents,
} from '@/lib/cash-api';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Card, CardHeader } from '@/components/ds/Card';
import { Field, Input } from '@/components/ds/Input';
import { Page, PageHeader } from '@/components/ds/PageHeader';
import { StatCard } from '@/components/ds/StatCard';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { useToast } from '@/components/ds/Toast';

type Panel = null | 'SUPPLY' | 'WITHDRAWAL' | 'CLOSE';

const TYPE_LABEL: Record<string, string> = { SALE: 'Venda', SUPPLY: 'Suprimento', WITHDRAWAL: 'Sangria' };
const TYPE_TONE = { SALE: 'success', SUPPLY: 'info', WITHDRAWAL: 'danger' } as const;

const PANEL_TITLE = { SUPPLY: 'Suprimento', WITHDRAWAL: 'Sangria', CLOSE: 'Fechar caixa' } as const;
const PANEL_CONFIRM = { SUPPLY: 'Confirmar suprimento', WITHDRAWAL: 'Confirmar sangria', CLOSE: 'Fechar caixa' } as const;

export default function CaixaPage() {
  const { accessToken } = useAuth();
  const { branches, branchId, isLoading: branchesLoading } = useActiveBranch();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [panel, setPanel] = useState<Panel>(null);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [closedSummary, setClosedSummary] = useState<CashSession | null>(null);

  const currentQuery = useQuery({
    queryKey: ['cash-current', branchId],
    queryFn: () => getCurrentSession(accessToken as string, branchId as string),
    enabled: !!accessToken && !!branchId,
    refetchInterval: 15_000, // picks up PDV cash sales made on another screen
  });
  const session = currentQuery.data?.session ?? null;

  function resetForm() {
    setPanel(null);
    setAmount('');
    setReason('');
    setFormError(null);
  }

  // The unit is picked in the topbar now; switching it must not leave a
  // half-filled form or the previous unit's closing summary on screen.
  useEffect(() => {
    setClosedSummary(null);
    setPanel(null);
    setAmount('');
    setReason('');
    setFormError(null);
  }, [branchId]);

  const mutation = useMutation({
    mutationFn: async (action: Panel | 'OPEN') => {
      const cents = parseBRLToCents(amount);
      if (cents === null) throw new Error('Informe um valor válido (ex.: 50,00).');
      if (action === 'OPEN') return openSession(accessToken as string, branchId as string, cents);
      if (!session) throw new Error('Nenhum caixa aberto.');
      if (action === 'CLOSE') return closeSession(accessToken as string, session.id, cents);
      if (cents <= 0) throw new Error('O valor deve ser maior que zero.');
      if (action === 'WITHDRAWAL' && reason.trim().length < 3) throw new Error('Informe o motivo da sangria.');
      return addMovement(accessToken as string, session.id, {
        type: action as 'SUPPLY' | 'WITHDRAWAL',
        amountCents: cents,
        reason: reason.trim() || undefined,
      });
    },
    onSuccess: (result, action) => {
      if (action === 'CLOSE') setClosedSummary(result);
      toast.success(
        action === 'OPEN'
          ? 'Caixa aberto.'
          : action === 'CLOSE'
            ? 'Caixa fechado.'
            : action === 'SUPPLY'
              ? 'Suprimento registrado.'
              : 'Sangria registrada.',
      );
      resetForm();
      queryClient.invalidateQueries({ queryKey: ['cash-current'] });
    },
    onError: (err) => setFormError(err instanceof Error ? err.message : 'Operação não concluída.'),
  });

  function submit(action: Panel | 'OPEN') {
    return (e: FormEvent) => {
      e.preventDefault();
      setFormError(null);
      mutation.mutate(action);
    };
  }

  if (branchesLoading) {
    return <LoadingState label="Carregando..." className="py-24" />;
  }
  if (branches.length === 0) {
    return (
      <Page>
        <EmptyState icon={<Wallet />} title="Sem acesso a unidades" description="Você não tem acesso a nenhuma unidade." />
      </Page>
    );
  }

  return (
    <Page>
      <PageHeader
        title="Caixa"
        description="Abertura, suprimentos, sangrias e fechamento do caixa da unidade."
        actions={
          session ? (
            <Badge tone="success" dot>
              Aberto
            </Badge>
          ) : currentQuery.data ? (
            <Badge tone="neutral" dot>
              Fechado
            </Badge>
          ) : undefined
        }
      />

      {closedSummary && (
        <Card className="animate-fade-in border-success/30">
          <CardHeader
            title={
              <span className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
                Caixa fechado
              </span>
            }
            description="Sessões fechadas não podem ser reabertas nem alteradas."
          />
          <div className="grid grid-cols-1 gap-3 p-4 sm:grid-cols-3">
            <Stat label="Saldo esperado" value={formatCents(closedSummary.expectedBalanceCents)} featured />
            <Stat label="Valor contado" value={formatCents(closedSummary.countedClosingBalanceCents)} featured />
            <Stat
              label="Diferença"
              value={formatCents(closedSummary.differenceCents)}
              highlight={closedSummary.differenceCents ?? 0}
            />
          </div>
        </Card>
      )}

      {currentQuery.isLoading ? (
        <LoadingState label="Carregando caixa..." />
      ) : currentQuery.isError ? (
        <ErrorState message="Não foi possível carregar o caixa." onRetry={() => currentQuery.refetch()} />
      ) : !session ? (
        <Card className="mx-auto max-w-md">
          <form onSubmit={submit('OPEN')} className="space-y-4 p-5">
            <div className="flex items-center gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-surface-hover text-muted-foreground">
                <LockKeyhole className="h-5 w-5" aria-hidden />
              </span>
              <div>
                <p className="text-sm font-semibold text-foreground">Nenhum caixa aberto</p>
                <p className="text-xs text-muted-foreground">Informe o saldo inicial para começar a operar nesta unidade.</p>
              </div>
            </div>
            <Field label="Saldo inicial (R$)">
              <Input inputMode="decimal" placeholder="0,00" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            {formError && <Alert>{formError}</Alert>}
            <Button type="submit" size="lg" fullWidth loading={mutation.isPending}>
              {mutation.isPending ? 'Abrindo...' : 'Abrir caixa'}
            </Button>
          </form>
        </Card>
      ) : (
        <>
          <section aria-label="Resumo do caixa" className="space-y-3">
            <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
              <StatCard label="Saldo inicial" value={formatCents(session.openingBalanceCents)} />
              <StatCard label="Vendas em dinheiro" value={formatCents(session.totals.salesCents)} tone="success" />
              <StatCard label="Suprimentos" value={formatCents(session.totals.suppliesCents)} tone="info" />
              <StatCard label="Sangrias" value={formatCents(session.totals.withdrawalsCents)} tone="danger" />
              <StatCard label="Saldo esperado" value={formatCents(session.expectedBalanceCents)} featured />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">
                Aberto desde {new Date(session.openedAt).toLocaleString('pt-BR')} · {session.openedBy.name}
              </p>
              <div className="flex flex-wrap gap-2">
                <ActionButton
                  icon={<ArrowDownCircle className="h-4 w-4" />}
                  onClick={() => {
                    resetForm();
                    setPanel('SUPPLY');
                  }}
                >
                  Suprimento
                </ActionButton>
                <ActionButton
                  icon={<ArrowUpCircle className="h-4 w-4" />}
                  onClick={() => {
                    resetForm();
                    setPanel('WITHDRAWAL');
                  }}
                >
                  Sangria
                </ActionButton>
                <ActionButton
                  danger
                  icon={<LockKeyhole className="h-4 w-4" />}
                  onClick={() => {
                    resetForm();
                    setPanel('CLOSE');
                  }}
                >
                  Fechar caixa
                </ActionButton>
              </div>
            </div>
          </section>

          {panel && (
            <Card className="animate-pop-in">
              <form onSubmit={submit(panel)} className="space-y-3 p-5">
                <h2 className="text-sm font-semibold text-foreground">{PANEL_TITLE[panel]}</h2>
                {panel === 'CLOSE' && (
                  <Alert tone="info">
                    Saldo esperado: <strong>{formatCents(session.expectedBalanceCents)}</strong>. Conte o dinheiro da
                    gaveta e informe o valor — a diferença é calculada pelo sistema.
                  </Alert>
                )}
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label={panel === 'CLOSE' ? 'Valor contado (R$)' : 'Valor (R$)'}>
                    <Input
                      autoFocus
                      inputMode="decimal"
                      placeholder="0,00"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                    />
                  </Field>
                  {panel !== 'CLOSE' && (
                    <Field label={`Motivo ${panel === 'WITHDRAWAL' ? '(obrigatório)' : '(opcional)'}`}>
                      <Input value={reason} maxLength={200} onChange={(e) => setReason(e.target.value)} />
                    </Field>
                  )}
                </div>
                {formError && <Alert>{formError}</Alert>}
                <div className="flex gap-2">
                  <Button type="submit" variant={panel === 'CLOSE' ? 'danger' : 'primary'} loading={mutation.isPending}>
                    {mutation.isPending ? 'Enviando...' : PANEL_CONFIRM[panel]}
                  </Button>
                  <Button type="button" variant="ghost" onClick={resetForm}>
                    Cancelar
                  </Button>
                </div>
              </form>
            </Card>
          )}

          <Card>
            <CardHeader title="Movimentações" description="Vendas em dinheiro, suprimentos e sangrias da sessão" />
            {session.movements.length === 0 ? (
              <p className="px-4 py-8 text-center text-sm text-muted-foreground">Nenhuma movimentação ainda.</p>
            ) : (
              <TableWrap>
                <Table>
                  <THead>
                    <tr>
                      <Th>Hora</Th>
                      <Th>Tipo</Th>
                      <Th className="text-right">Valor</Th>
                      <Th>Motivo</Th>
                      <Th>Usuário</Th>
                      <Th>Pedido</Th>
                    </tr>
                  </THead>
                  <TBody>
                    {session.movements.map((m) => (
                      <Tr key={m.id}>
                        <Td className="whitespace-nowrap text-muted-foreground">
                          {new Date(m.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                        </Td>
                        <Td>
                          <Badge tone={TYPE_TONE[m.type] ?? 'neutral'}>{TYPE_LABEL[m.type] ?? m.type}</Badge>
                        </Td>
                        <Td
                          className={`whitespace-nowrap text-right font-semibold ${
                            m.type === 'WITHDRAWAL' ? 'text-danger' : 'text-success'
                          }`}
                        >
                          {m.type === 'WITHDRAWAL' ? '−' : '+'}
                          {formatCents(m.amountCents)}
                        </Td>
                        <Td className="text-muted-foreground">{m.reason ?? '—'}</Td>
                        <Td className="text-muted-foreground">{m.createdBy.name}</Td>
                        <Td>
                          {m.orderNumber ? (
                            <Link className="font-medium text-accent hover:underline" href={`/dashboard/pedidos/${m.orderId}`}>
                              #{m.orderNumber}
                            </Link>
                          ) : (
                            <span className="text-subtle">—</span>
                          )}
                        </Td>
                      </Tr>
                    ))}
                  </TBody>
                </Table>
              </TableWrap>
            )}
          </Card>
        </>
      )}
    </Page>
  );
}

function Stat({
  label,
  value,
  highlight,
  featured,
}: {
  label: string;
  value: string;
  highlight?: number;
  featured?: boolean;
}) {
  const color =
    highlight === undefined ? (featured ? 'text-accent' : 'text-foreground') : highlight < 0 ? 'text-danger' : highlight > 0 ? 'text-warning' : 'text-success';
  return (
    <div className="rounded-ctl bg-surface-2 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-0.5 text-lg font-semibold ${color}`}>{value}</p>
    </div>
  );
}

function ActionButton({
  children,
  onClick,
  danger,
  icon,
}: {
  children: ReactNode;
  onClick: () => void;
  danger?: boolean;
  icon?: ReactNode;
}) {
  return (
    <Button variant={danger ? 'danger-ghost' : 'outline'} icon={icon} onClick={onClick}>
      {children}
    </Button>
  );
}
