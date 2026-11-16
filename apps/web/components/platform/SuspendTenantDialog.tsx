'use client';

import { FormEvent, useEffect, useState } from 'react';
import { SUSPEND_WARNING, SUSPENSION_REASON_MAX, validateSuspensionReason } from '@/lib/platform-logic';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { Textarea } from '@/components/ds/Input';
import { Alert } from '@/components/ds/States';

// Suspending asks for two things on purpose: a reason (kept in the platform's audit) and an
// explicit "I understand" on the consequence. Nothing of the restaurant is deleted.
export function SuspendTenantDialog({
  open,
  tenantName,
  loading,
  error,
  onConfirm,
  onClose,
}: {
  open: boolean;
  tenantName: string;
  loading: boolean;
  error: string | null;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setReason('');
      setUnderstood(false);
      setProblem(null);
    }
  }, [open]);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (loading) return;
    const found = validateSuspensionReason(reason);
    setProblem(found);
    if (found || !understood) return;
    onConfirm(reason.trim());
  }

  return (
    <Dialog
      open={open}
      onClose={() => (loading ? undefined : onClose())}
      title={`Suspender ${tenantName}`}
      size="md"
    >
      <form onSubmit={submit} className="space-y-4" noValidate aria-label="Suspender restaurante">
        <Alert tone="warning">
          {SUSPEND_WARNING} Os dados (pedidos, estoque, usuários e histórico) são preservados e voltam com a
          reativação.
        </Alert>
        <div className="space-y-1">
          <label htmlFor="suspend-reason" className="text-xs font-medium text-foreground">
            Motivo da suspensão
          </label>
          <Textarea
            id="suspend-reason"
            value={reason}
            maxLength={SUSPENSION_REASON_MAX}
            placeholder="Ex.: pagamento em atraso, pedido do cliente"
            aria-invalid={problem ? true : undefined}
            onChange={(e) => {
              setReason(e.target.value);
              setProblem(null);
            }}
          />
          <p className="text-2xs text-subtle">Fica registrado na auditoria da plataforma.</p>
          {problem && (
            <p className="text-2xs text-danger" role="alert">
              {problem}
            </p>
          )}
        </div>
        <label className="flex items-start gap-2 text-sm text-foreground">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4"
            checked={understood}
            onChange={(e) => setUnderstood(e.target.checked)}
          />
          Entendo que os usuários deste restaurante perdem o acesso agora.
        </label>
        {error && <Alert>{error}</Alert>}
        <div className="flex flex-col-reverse gap-2 border-t border-line pt-4 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button type="submit" variant="danger" loading={loading} disabled={!understood}>
            Suspender restaurante
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
