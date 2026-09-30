'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { deliveryApi } from '@/lib/delivery-api';
import { centsToInput } from '@/lib/delivery-logic';
import { costToCents } from '@/lib/purchases-logic';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { Field, Input } from '@/components/ds/Input';
import { Alert, LoadingState } from '@/components/ds/States';
import { Switch } from '@/components/ds/Switch';
import { useToast } from '@/components/ds/Toast';
import { useErrorMessage } from '@/components/estoque/use-inventory';

// Branch delivery terms. The fee and minimum are applied ONLY by the server when
// an order is created; this dialog just edits the stored settings.
export function DeliverySettingsDialog({
  open,
  onClose,
  branchId,
}: {
  open: boolean;
  onClose: () => void;
  branchId: string | null;
}) {
  const { accessToken } = useAuth();
  const toast = useToast();
  const errorMessage = useErrorMessage();
  const queryClient = useQueryClient();
  const saving = useRef(false);
  const [enabled, setEnabled] = useState(true);
  const [fee, setFee] = useState('0,00');
  const [minOrder, setMinOrder] = useState('0,00');
  const [error, setError] = useState<string | null>(null);

  const settings = useQuery({
    queryKey: ['delivery', 'settings', branchId],
    queryFn: () => deliveryApi.getSettings(accessToken as string, branchId as string),
    enabled: open && !!accessToken && !!branchId,
  });

  useEffect(() => {
    if (!open || !settings.data) return;
    setEnabled(settings.data.enabled);
    setFee(centsToInput(settings.data.feeCents));
    setMinOrder(centsToInput(settings.data.minOrderCents));
    setError(null);
  }, [open, settings.data]);

  const save = useMutation({
    mutationFn: () => {
      const feeCents = costToCents(fee);
      const minOrderCents = costToCents(minOrder);
      if (feeCents === null || minOrderCents === null) throw new Error('Informe valores válidos, por exemplo 5,00.');
      return deliveryApi.updateSettings(accessToken as string, {
        branchId: branchId as string,
        enabled,
        feeCents,
        minOrderCents,
      });
    },
    onSuccess: () => {
      toast.success('Configurações de entrega salvas.');
      void queryClient.invalidateQueries({ queryKey: ['delivery'] });
      onClose();
    },
    onError: (err) => setError(errorMessage(err, 'Não foi possível salvar as configurações.')),
    onSettled: () => {
      saving.current = false;
    },
  });

  function submit() {
    if (saving.current) return;
    saving.current = true;
    setError(null);
    save.mutate();
  }

  return (
    <Dialog
      open={open}
      onClose={() => (save.isPending ? undefined : onClose())}
      title="Configurações de entrega"
      description="Valem para pedidos novos da unidade. Pedidos já feitos mantêm a taxa que foi cobrada."
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={save.isPending}>
            Cancelar
          </Button>
          <Button onClick={submit} loading={save.isPending} disabled={save.isPending || !settings.data}>
            Salvar
          </Button>
        </>
      }
    >
      {settings.isPending ? (
        <LoadingState label="Carregando configurações..." />
      ) : settings.isError ? (
        <Alert tone="danger">Não foi possível carregar as configurações.</Alert>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-foreground">Aceitar pedidos para entrega</p>
              <p className="text-xs text-muted-foreground">Desligado, o cardápio online só aceita retirada.</p>
            </div>
            <Switch checked={enabled} onChange={setEnabled} label="Aceitar pedidos para entrega" />
          </div>
          <Field label="Taxa de entrega (R$)">
            <Input inputMode="decimal" value={fee} onChange={(event) => setFee(event.target.value)} placeholder="0,00" />
          </Field>
          <Field label="Pedido mínimo (R$)" hint="Soma dos itens, sem contar a taxa.">
            <Input
              inputMode="decimal"
              value={minOrder}
              onChange={(event) => setMinOrder(event.target.value)}
              placeholder="0,00"
            />
          </Field>
          {error && <Alert tone="danger">{error}</Alert>}
        </div>
      )}
    </Dialog>
  );
}
