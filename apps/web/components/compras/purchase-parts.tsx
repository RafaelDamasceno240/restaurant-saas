'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { PackageCheck } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { formatCents } from '@/lib/cash-api';
import { PURCHASE_STATUS_LABEL, purchasesApi, PurchaseStatus } from '@/lib/purchases-api';
import { Badge, BadgeTone } from '@/components/ds/Badge';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { Field, Textarea } from '@/components/ds/Input';
import { Alert } from '@/components/ds/States';
import { useToast } from '@/components/ds/Toast';
import { useErrorMessage, useRefreshInventory } from '@/components/estoque/use-inventory';

const STATUS_TONE: Record<PurchaseStatus, BadgeTone> = {
  DRAFT: 'warning',
  RECEIVED: 'success',
  CANCELLED: 'danger',
};

export function PurchaseStatusBadge({ status }: { status: PurchaseStatus }) {
  return (
    <Badge tone={STATUS_TONE[status]} dot>
      {PURCHASE_STATUS_LABEL[status]}
    </Badge>
  );
}

export interface PurchaseRef {
  id: string;
  purchaseNumber: string;
  status: PurchaseStatus;
  supplierName: string;
  branchName: string;
  itemCount: number;
  totalCents: number;
}

function SummaryList({ purchase }: { purchase: PurchaseRef }) {
  const rows: [string, string][] = [
    ['Compra', purchase.purchaseNumber],
    ['Fornecedor', purchase.supplierName],
    ['Unidade', purchase.branchName],
    ['Itens', String(purchase.itemCount)],
    ['Valor', formatCents(purchase.totalCents)],
  ];
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-ctl border border-line bg-surface-2 p-3 text-sm">
      {rows.map(([label, value]) => (
        <div key={label} className="contents">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-right font-medium text-foreground">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

interface ActionDialogProps {
  purchase: PurchaseRef | null;
  onClose: () => void;
  onDone: () => void;
}

export function ReceiveDialog({ purchase, onClose, onDone }: ActionDialogProps) {
  const { accessToken } = useAuth();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const refresh = useRefreshInventory();
  const [error, setError] = useState<string | null>(null);
  // Synchronous guard: `isPending` is React state and does not change between
  // clicks fired in the same tick, so it cannot stop a double click on its own.
  const inFlight = useRef(false);

  useEffect(() => setError(null), [purchase?.id]);

  const receive = useMutation({
    mutationFn: () => purchasesApi.receive(accessToken as string, (purchase as PurchaseRef).id),
    onSuccess: (result) => {
      toast.success(
        result.idempotentReplay
          ? `${result.purchaseNumber} já estava recebida.`
          : `${result.purchaseNumber} recebida. Estoque atualizado.`,
      );
      void refresh();
      onDone();
      onClose();
    },
    onError: (err) => setError(errorMessage(err, 'Não foi possível receber a compra.')),
    onSettled: () => {
      inFlight.current = false;
    },
  });

  return (
    <Dialog
      open={purchase !== null}
      onClose={() => (receive.isPending ? undefined : onClose())}
      title="Receber compra"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={receive.isPending}>
            Cancelar
          </Button>
          <Button
            icon={<PackageCheck className="h-4 w-4" aria-hidden />}
            loading={receive.isPending}
            disabled={receive.isPending}
            onClick={() => {
              if (inFlight.current) return;
              inFlight.current = true;
              receive.mutate();
            }}
          >
            Receber e atualizar estoque
          </Button>
        </>
      }
    >
      {purchase && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Receber esta compra irá adicionar os itens ao estoque da unidade selecionada.
          </p>
          <SummaryList purchase={purchase} />
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      )}
    </Dialog>
  );
}

export function CancelDialog({ purchase, onClose, onDone }: ActionDialogProps) {
  const { accessToken } = useAuth();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const refresh = useRefreshInventory();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const received = purchase?.status === 'RECEIVED';
  const inFlight = useRef(false);

  useEffect(() => {
    setReason('');
    setError(null);
  }, [purchase?.id]);

  const cancel = useMutation({
    mutationFn: () => {
      const trimmed = reason.trim();
      if (received && trimmed.length < 3) throw new Error('Informe o motivo do cancelamento (mínimo 3 caracteres).');
      return purchasesApi.cancel(accessToken as string, (purchase as PurchaseRef).id, trimmed || undefined);
    },
    onSuccess: (result) => {
      toast.success(`${result.purchaseNumber} cancelada.`);
      void refresh();
      onDone();
      onClose();
    },
    onError: (err) => setError(errorMessage(err, 'Não foi possível cancelar a compra.')),
    onSettled: () => {
      inFlight.current = false;
    },
  });

  return (
    <Dialog
      open={purchase !== null}
      onClose={() => (cancel.isPending ? undefined : onClose())}
      title="Cancelar compra"
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={cancel.isPending}>
            Voltar
          </Button>
          <Button
            variant="danger"
            loading={cancel.isPending}
            disabled={cancel.isPending}
            onClick={() => {
              if (inFlight.current) return;
              inFlight.current = true;
              setError(null);
              cancel.mutate();
            }}
          >
            Cancelar compra
          </Button>
        </>
      }
    >
      {purchase && (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {received
              ? 'Esta compra já foi recebida. Cancelá-la vai estornar a entrada de estoque de cada item. Se o estoque já foi consumido, o estorno é recusado.'
              : 'A compra será marcada como cancelada. Nenhum estoque é alterado.'}
          </p>
          <SummaryList purchase={purchase} />
          <Field label={received ? 'Motivo (obrigatório)' : 'Motivo (opcional)'}>
            <Textarea value={reason} maxLength={300} rows={3} onChange={(event) => setReason(event.target.value)} />
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      )}
    </Dialog>
  );
}
