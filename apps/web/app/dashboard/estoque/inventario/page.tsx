'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { CheckCircle2, ClipboardCheck, Scale } from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@/lib/auth-context';
import {
  countDifference,
  formatQuantity,
  formatSignedQuantity,
  InventoryCountResult,
  InventoryItem,
  inventoryApi,
  parseQuantity,
} from '@/lib/inventory-api';
import { Badge } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Card, CardHeader } from '@/components/ds/Card';
import { ConfirmDialog } from '@/components/ds/Dialog';
import { Input, SearchInput } from '@/components/ds/Input';
import { Alert, EmptyState, ErrorState, LoadingState } from '@/components/ds/States';
import { Table, TableWrap, TBody, Td, Th, THead, Tr } from '@/components/ds/Table';
import { useToast } from '@/components/ds/Toast';
import { useEstoque } from '@/components/estoque/EstoqueProvider';
import { INVENTORY_QUERY_ROOT, useErrorMessage } from '@/components/estoque/use-inventory';

type LineState = 'NOT_COUNTED' | 'INVALID' | 'MATCH' | 'SURPLUS' | 'SHORTAGE';

interface CountLine {
  item: InventoryItem;
  counted: number | null;
  difference: number | null;
  state: LineState;
}

const STATE_BADGE: Record<Exclude<LineState, 'NOT_COUNTED'>, { tone: 'success' | 'info' | 'danger' | 'warning'; label: string }> = {
  MATCH: { tone: 'success', label: 'Sem diferença' },
  SURPLUS: { tone: 'info', label: 'Sobra' },
  SHORTAGE: { tone: 'danger', label: 'Falta' },
  INVALID: { tone: 'warning', label: 'Valor inválido' },
};

function evaluate(item: InventoryItem, raw: string | undefined): CountLine {
  if (raw === undefined || raw.trim() === '') return { item, counted: null, difference: null, state: 'NOT_COUNTED' };
  const counted = parseQuantity(raw);
  if (counted === null) return { item, counted: null, difference: null, state: 'INVALID' };
  const difference = countDifference(item.quantity ?? 0, counted);
  const state: LineState = difference === 0 ? 'MATCH' : difference > 0 ? 'SURPLUS' : 'SHORTAGE';
  return { item, counted, difference, state };
}

export default function InventarioPage() {
  const { accessToken } = useAuth();
  const { branchId, canManage, refresh } = useEstoque();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [search, setSearch] = useState('');
  const [notes, setNotes] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [result, setResult] = useState<InventoryCountResult | null>(null);

  const query = useQuery({
    queryKey: [INVENTORY_QUERY_ROOT, 'balances', branchId],
    queryFn: () => inventoryApi.balances(accessToken as string, branchId as string),
    enabled: !!accessToken && !!branchId,
  });

  const lines = useMemo(() => (query.data ?? []).map((item) => evaluate(item, counts[item.id])), [query.data, counts]);
  const term = search.trim().toLowerCase();
  const visible = lines.filter((line) => !term || line.item.name.toLowerCase().includes(term));
  const counted = lines.filter((line) => line.counted !== null);
  const withDifference = counted.filter((line) => line.state !== 'MATCH');
  const invalid = lines.some((line) => line.state === 'INVALID');

  const submit = useMutation({
    mutationFn: () =>
      inventoryApi.createCount(accessToken as string, {
        branchId: branchId as string,
        notes: notes.trim() || undefined,
        items: counted.map((line) => ({ inventoryItemId: line.item.id, countedQuantity: line.counted! })),
      }),
    onSuccess: (count) => {
      setConfirming(false);
      setResult(count);
      setCounts({});
      setNotes('');
      toast.success(
        count.adjustedCount
          ? `Inventário registrado: ${count.adjustedCount} ajuste(s) gerado(s).`
          : 'Inventário registrado: nenhuma diferença encontrada.',
      );
      refresh();
    },
    onError: (err) => {
      setConfirming(false);
      toast.error(errorMessage(err, 'Não foi possível registrar o inventário.'));
    },
  });

  if (query.isLoading) return <LoadingState label="Carregando saldos..." />;
  if (query.isError) return <ErrorState message="Não foi possível carregar os saldos." onRetry={() => query.refetch()} />;
  if (lines.length === 0) {
    return <EmptyState icon={<Scale />} title="Nenhum insumo ativo" description="Cadastre insumos para fazer a contagem física." />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Inventário físico</h2>
          <p className="text-sm text-muted-foreground">
            Informe a contagem física. O sistema gera um ajuste auditável para cada diferença — o saldo nunca é editado diretamente.
          </p>
        </div>
        {canManage && (
          <Button
            icon={<ClipboardCheck className="h-4 w-4" />}
            disabled={counted.length === 0 || invalid}
            onClick={() => setConfirming(true)}
          >
            Ajustar estoque
          </Button>
        )}
      </div>

      {!canManage && <Alert tone="info">Você pode consultar os saldos, mas não registrar inventário.</Alert>}
      {invalid && <Alert tone="warning">Corrija as contagens inválidas (use até 3 casas decimais).</Alert>}

      {result && <CountResultCard result={result} onDismiss={() => setResult(null)} />}

      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-[14rem] flex-1 sm:max-w-sm">
          <SearchInput placeholder="Buscar insumo..." aria-label="Buscar insumo" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="min-w-[14rem] flex-1 sm:max-w-sm">
          <Input
            placeholder="Observação da contagem (opcional)"
            aria-label="Observação da contagem"
            maxLength={300}
            value={notes}
            disabled={!canManage}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <p className="ml-auto text-xs text-muted-foreground">
          {counted.length} contado(s) · {withDifference.length} com diferença
        </p>
      </div>

      <Card className="overflow-hidden">
        <TableWrap>
          <Table>
            <THead>
              <tr>
                <Th>Insumo</Th>
                <Th className="text-right">Estoque sistema</Th>
                <Th className="w-44">Contagem física</Th>
                <Th className="text-right">Diferença</Th>
                <Th>Status</Th>
              </tr>
            </THead>
            <TBody>
              {visible.map((line) => (
                <Tr key={line.item.id}>
                  <Td className="font-medium text-foreground">{line.item.name}</Td>
                  <Td className="whitespace-nowrap text-right text-muted-foreground">
                    {formatQuantity(line.item.quantity ?? 0, line.item.unit)}
                  </Td>
                  <Td>
                    <Input
                      inputMode="decimal"
                      aria-label={`Contagem de ${line.item.name}`}
                      placeholder="—"
                      disabled={!canManage}
                      className={clsx('h-8 text-right', line.state === 'INVALID' && 'border-warning')}
                      value={counts[line.item.id] ?? ''}
                      onChange={(e) => setCounts((current) => ({ ...current, [line.item.id]: e.target.value }))}
                    />
                  </Td>
                  <Td
                    className={clsx(
                      'whitespace-nowrap text-right font-semibold',
                      line.difference === null || line.difference === 0
                        ? 'text-muted-foreground'
                        : line.difference > 0
                          ? 'text-info'
                          : 'text-danger',
                    )}
                  >
                    {line.difference === null ? '—' : formatSignedQuantity(line.difference, line.item.unit)}
                  </Td>
                  <Td>
                    {line.state === 'NOT_COUNTED' ? (
                      <span className="text-xs text-subtle">Não contado</span>
                    ) : (
                      <Badge tone={STATE_BADGE[line.state].tone} dot>
                        {STATE_BADGE[line.state].label}
                      </Badge>
                    )}
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </TableWrap>
      </Card>
      <p className="text-2xs text-subtle">
        A diferença exibida é uma prévia. Ao confirmar, o sistema recalcula a partir do saldo no momento do ajuste.
      </p>

      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title="Confirmar inventário?"
        description={
          withDifference.length
            ? `${counted.length} insumo(s) contado(s). Serão gerados ${withDifference.length} ajuste(s): ${withDifference
                .slice(0, 5)
                .map((line) => `${line.item.name} ${formatSignedQuantity(line.difference!, line.item.unit)}`)
                .join(', ')}${withDifference.length > 5 ? '…' : ''}.`
            : `${counted.length} insumo(s) contado(s) sem diferença. O inventário será registrado sem ajustes.`
        }
        confirmLabel="Ajustar estoque"
        loading={submit.isPending}
        onConfirm={() => submit.mutate()}
      />
    </div>
  );
}

function CountResultCard({ result, onDismiss }: { result: InventoryCountResult; onDismiss: () => void }) {
  const adjusted = result.items.filter((line) => line.stockMovementId);
  return (
    <Card className="animate-fade-in border-success/30">
      <CardHeader
        title={
          <span className="flex items-center gap-2">
            <CheckCircle2 className="h-4 w-4 text-success" aria-hidden />
            Inventário registrado
          </span>
        }
        description={`${new Date(result.createdAt).toLocaleString('pt-BR')} · ${result.items.length} insumo(s) contado(s)`}
        action={
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Fechar
          </Button>
        }
      />
      {adjusted.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">Nenhuma diferença: nenhum ajuste foi necessário.</p>
      ) : (
        <ul className="divide-y divide-line">
          {adjusted.map((line) => (
            <li key={line.inventoryItemId} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <span className="text-foreground">{line.name}</span>
              <span className="text-muted-foreground">
                {formatQuantity(line.systemQuantity, line.unit)} → {formatQuantity(line.countedQuantity, line.unit)}{' '}
                <span className={line.difference < 0 ? 'font-semibold text-danger' : 'font-semibold text-info'}>
                  ({formatSignedQuantity(line.difference, line.unit)})
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
