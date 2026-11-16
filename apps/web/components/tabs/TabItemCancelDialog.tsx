'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@/components/ds/Dialog';
import { Button } from '@/components/ds/Button';
import { Field, Textarea } from '@/components/ds/Input';
import { Alert } from '@/components/ds/States';
import { CANCEL_REASON_MAX, cancelReasonProblem } from '@/lib/cancel-order-logic';
import { TabItem } from '@/lib/tabs-api';
import { cancelAsksStock, TAB_ITEM_STATUS_LABEL } from '@/lib/tab-round-logic';

// B9: the one way to take units of a sent item off a tab. Same rules on screen as the order
// cancellation (B5): nothing happens until "Confirmar cancelamento" with a reason; Esc, the
// backdrop, "Voltar" and the X close it without cancelling; one click sends one request.
// What happens to the ingredients follows from the item's status, said up front.
export function TabItemCancelDialog({
  item,
  error,
  onClose,
  onConfirm,
}: {
  // null = closed.
  item: TabItem | null;
  error?: string | null;
  onClose: () => void;
  // Resolves true when the units were cancelled (the dialog then closes itself).
  onConfirm: (input: { quantity: number; reason: string; returnToStock?: boolean }) => Promise<boolean>;
}) {
  const [quantity, setQuantity] = useState(1);
  const [reason, setReason] = useState('');
  const [returnToStock, setReturnToStock] = useState(false);
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const sending = useRef(false);

  useEffect(() => {
    if (item) {
      setQuantity(item.activeQuantity);
      setReason('');
      setReturnToStock(false);
      setTouched(false);
    }
  }, [item]);

  if (!item) return null;

  const problem = cancelReasonProblem(reason);
  const asksStock = cancelAsksStock(item.status);
  const stockNote =
    item.status === 'SENT'
      ? 'A cozinha ainda não começou: os ingredientes voltam ao estoque.'
      : item.status === 'SERVED'
        ? item.roundId === null
          ? 'Item lançado antes das rodadas: sai da conta, sem mexer no estoque.'
          : 'O item já foi entregue: sai da conta e conta como perda (não volta ao estoque).'
        : 'O item já está com a cozinha: por padrão conta como perda.';

  async function confirm() {
    setTouched(true);
    if (problem || sending.current || !item) return;
    sending.current = true;
    setBusy(true);
    try {
      const ok = await onConfirm({ quantity, reason: reason.trim(), ...(asksStock ? { returnToStock } : {}) });
      if (ok) onClose();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onClose={() => (sending.current ? undefined : onClose())}
      title="Cancelar item"
      description={`${item.name} · ${TAB_ITEM_STATUS_LABEL[item.status]}`}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Voltar
          </Button>
          <Button variant="danger" onClick={() => void confirm()} loading={busy} disabled={busy || !!problem}>
            Confirmar cancelamento
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm text-foreground">Quantas unidades?</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              disabled={quantity <= 1 || busy}
              aria-label="Cancelar uma unidade a menos"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-line-strong text-base font-bold disabled:opacity-40"
            >
              −
            </button>
            <span className="w-14 text-center text-sm font-semibold" aria-live="polite">
              {quantity} de {item.activeQuantity}
            </span>
            <button
              type="button"
              onClick={() => setQuantity((q) => Math.min(item.activeQuantity, q + 1))}
              disabled={quantity >= item.activeQuantity || busy}
              aria-label="Cancelar uma unidade a mais"
              className="flex h-10 w-10 items-center justify-center rounded-full border border-line-strong text-base font-bold disabled:opacity-40"
            >
              +
            </button>
          </div>
        </div>
        <p className="text-sm text-muted-foreground">{stockNote}</p>
        {asksStock && (
          <label className="flex items-start gap-2 text-sm text-foreground">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 accent-[rgb(var(--primary))]"
              checked={returnToStock}
              onChange={(event) => setReturnToStock(event.target.checked)}
              disabled={busy}
            />
            Voltou ao estoque (não foi usado)
          </label>
        )}
        <Field label="Motivo do cancelamento" hint={touched && problem ? problem : `Obrigatório. ${reason.trim().length}/${CANCEL_REASON_MAX}`}>
          <Textarea
            id="tab-item-cancel-reason"
            rows={3}
            maxLength={CANCEL_REASON_MAX}
            value={reason}
            placeholder="Ex.: cliente desistiu, lançado na mesa errada..."
            onChange={(event) => setReason(event.target.value)}
            onBlur={() => setTouched(true)}
          />
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Dialog>
  );
}
