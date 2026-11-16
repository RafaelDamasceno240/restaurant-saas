'use client';

import { useEffect, useRef, useState } from 'react';
import { Dialog } from '@/components/ds/Dialog';
import { Button } from '@/components/ds/Button';
import { Field, Textarea } from '@/components/ds/Input';
import { Alert } from '@/components/ds/States';
import { CANCEL_REASON_MAX, cancelReasonProblem } from '@/lib/cancel-order-logic';

// B5 (piloto 2026-10-23): the one way to cancel an order on screen (order detail and Delivery).
// Nothing happens until "Confirmar cancelamento" is pressed with a reason; Esc, the backdrop,
// "Voltar" and the X close it without cancelling. One click sends one request: the button is off
// while it runs, and a second click before React re-renders is ignored too.
export function CancelOrderDialog({
  open,
  orderNumber,
  effects,
  error,
  onClose,
  onConfirm,
}: {
  open: boolean;
  orderNumber: string;
  effects: string[];
  // Refusal from the API (e.g. no open drawer to give the cash back), shown inside the dialog.
  error?: string | null;
  onClose: () => void;
  // Resolves true when the order was cancelled (the dialog then closes itself).
  onConfirm: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [touched, setTouched] = useState(false);
  const sending = useRef(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
    }
  }, [open]);

  const problem = cancelReasonProblem(reason);

  async function confirm() {
    setTouched(true);
    if (problem || sending.current) return;
    sending.current = true;
    setBusy(true);
    try {
      if (await onConfirm(reason.trim())) onClose();
    } finally {
      sending.current = false;
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={() => (sending.current ? undefined : onClose())}
      title="Cancelar pedido"
      description={`Pedido #${orderNumber}`}
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
        <p className="text-sm font-medium text-foreground">Tem certeza que deseja cancelar este pedido?</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          {effects.map((effect) => (
            <li key={effect}>{effect}</li>
          ))}
        </ul>
        <Field
          label="Motivo do cancelamento"
          hint={touched && problem ? problem : `Obrigatório. ${reason.trim().length}/${CANCEL_REASON_MAX}`}
        >
          <Textarea
            id="cancel-reason"
            rows={3}
            maxLength={CANCEL_REASON_MAX}
            value={reason}
            placeholder="Ex.: cliente desistiu, pedido lançado em duplicidade..."
            onChange={(event) => setReason(event.target.value)}
            onBlur={() => setTouched(true)}
          />
        </Field>
        {error && <Alert tone="danger">{error}</Alert>}
      </div>
    </Dialog>
  );
}
