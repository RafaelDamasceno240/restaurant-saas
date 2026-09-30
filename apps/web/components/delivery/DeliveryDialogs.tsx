'use client';

import { ReactNode, useEffect, useState } from 'react';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { Field, Textarea } from '@/components/ds/Input';
import { Alert } from '@/components/ds/States';
import { isValidFailureReason, MAX_DELIVERY_TEXT } from '@/lib/delivery-logic';

// All dialogs delegate the request to the page (`onSubmit` resolves true on success) so
// the page keeps ONE per-delivery in-flight guard for every action. They stay open on
// failure, where the page already shows the error.

export function FailDeliveryDialog({
  orderNumber,
  open,
  busy,
  onClose,
  onSubmit,
}: {
  orderNumber: string | null;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<boolean>;
}) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setReason('');
      setTouched(false);
    }
  }, [open, orderNumber]);

  const valid = isValidFailureReason(reason);

  async function submit() {
    setTouched(true);
    if (!valid || busy) return;
    if (await onSubmit(reason.trim())) onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      title="Marcar entrega como falha"
      description={orderNumber ? `Pedido ${orderNumber}` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Voltar
          </Button>
          <Button variant="danger" onClick={() => void submit()} loading={busy} disabled={busy}>
            Registrar falha
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">
          O pedido volta a &ldquo;pronto&rdquo; e continua na fila: você poderá pedir uma nova tentativa ou cancelá-lo depois.
        </p>
        <Field label="Motivo (obrigatório)" hint={`${reason.trim().length}/${MAX_DELIVERY_TEXT}`}>
          <Textarea
            value={reason}
            rows={3}
            maxLength={MAX_DELIVERY_TEXT}
            placeholder="Ex.: cliente ausente, endereço não encontrado..."
            onChange={(event) => setReason(event.target.value)}
          />
        </Field>
        {touched && !valid && <Alert tone="danger">Informe o motivo da falha (mínimo 3 caracteres).</Alert>}
      </div>
    </Dialog>
  );
}

export function DeliveryNotesDialog({
  orderNumber,
  initial,
  open,
  busy,
  onClose,
  onSubmit,
}: {
  orderNumber: string | null;
  initial: string | null;
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (notes: string | null) => Promise<boolean>;
}) {
  const [notes, setNotes] = useState('');

  useEffect(() => {
    if (open) setNotes(initial ?? '');
  }, [open, initial, orderNumber]);

  async function submit() {
    if (busy) return;
    const trimmed = notes.trim();
    if (await onSubmit(trimmed ? trimmed : null)) onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      title="Observação da entrega"
      description={orderNumber ? `Pedido ${orderNumber}` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={busy}>
            Salvar
          </Button>
        </>
      }
    >
      <Field
        label="Instruções para o entregador"
        hint={`${notes.trim().length}/${MAX_DELIVERY_TEXT} · separada da observação do pedido. Deixe em branco para remover.`}
      >
        <Textarea
          value={notes}
          rows={3}
          maxLength={MAX_DELIVERY_TEXT}
          placeholder="Ex.: portão azul, interfone 204, não tocar a campainha"
          onChange={(event) => setNotes(event.target.value)}
        />
      </Field>
    </Dialog>
  );
}

// Confirmation for actions that are hard to take back (request another attempt, cancel the order).
export function ConfirmDeliveryDialog({
  open,
  busy,
  title,
  description,
  confirmLabel,
  danger,
  children,
  onClose,
  onConfirm,
}: {
  open: boolean;
  busy: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  danger?: boolean;
  children?: ReactNode;
  onClose: () => void;
  onConfirm: () => Promise<boolean>;
}) {
  async function confirm() {
    if (busy) return;
    if (await onConfirm()) onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Voltar
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} onClick={() => void confirm()} loading={busy} disabled={busy}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Dialog>
  );
}
