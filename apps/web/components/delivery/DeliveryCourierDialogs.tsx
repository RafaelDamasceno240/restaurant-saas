'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { DeliveryItem, deliveryApi } from '@/lib/delivery-api';
import { historyAttempt, historyDetail, HISTORY_KIND_LABEL } from '@/lib/delivery-logic';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { Field, Select } from '@/components/ds/Input';
import { Alert, ErrorState, LoadingState } from '@/components/ds/States';

// Like the other delivery dialogs, the request itself belongs to the page (`onSubmit`
// resolves true on success) so one per-delivery in-flight guard covers every action.

export function AssignCourierDialog({
  item,
  branchId,
  busy,
  onClose,
  onSubmit,
}: {
  item: DeliveryItem | null;
  branchId: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (courierUserId: string) => Promise<boolean>;
}) {
  const { accessToken } = useAuth();
  const open = item !== null;
  const [selected, setSelected] = useState('');

  const couriers = useQuery({
    queryKey: ['delivery', 'couriers', branchId],
    queryFn: () => deliveryApi.listCouriers(accessToken as string, branchId),
    enabled: open && !!accessToken,
  });

  useEffect(() => {
    if (item) setSelected(item.courier?.id ?? '');
  }, [item]);

  const options = couriers.data?.data ?? [];
  const unchanged = selected === (item?.courier?.id ?? '');

  async function submit() {
    if (!selected || unchanged || busy) return;
    if (await onSubmit(selected)) onClose();
  }

  return (
    <Dialog
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      title={item?.courier ? 'Reatribuir entregador' : 'Atribuir entregador'}
      description={item ? `Pedido ${item.orderNumber}` : undefined}
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button onClick={() => void submit()} loading={busy} disabled={busy || !selected || unchanged}>
            {item?.courier ? 'Reatribuir' : 'Atribuir'}
          </Button>
        </>
      }
    >
      {couriers.isPending ? (
        <LoadingState label="Carregando entregadores..." />
      ) : couriers.isError ? (
        <ErrorState message="Não foi possível carregar os entregadores." onRetry={() => void couriers.refetch()} />
      ) : options.length === 0 ? (
        <Alert tone="warning">
          Nenhum entregador disponível nesta unidade. Cadastre um usuário ativo com o papel Entregador e acesso à unidade.
        </Alert>
      ) : (
        <Field label="Entregador" hint="Somente usuários ativos com o papel Entregador e acesso a esta unidade.">
          <Select aria-label="Entregador" value={selected} onChange={(event) => setSelected(event.target.value)}>
            <option value="">Selecione...</option>
            {options.map((option) => (
              <option key={option.id} value={option.id}>
                {option.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
    </Dialog>
  );
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function DeliveryHistoryDialog({ item, onClose }: { item: DeliveryItem | null; onClose: () => void }) {
  const { accessToken } = useAuth();
  const open = item !== null;

  const history = useQuery({
    queryKey: ['delivery', 'history', item?.id, item?.attemptCount, item?.status, item?.courier?.id],
    queryFn: () => deliveryApi.history(accessToken as string, (item as DeliveryItem).id),
    enabled: open && !!accessToken,
  });

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Histórico da entrega"
      description={item ? `Pedido ${item.orderNumber}` : undefined}
      size="md"
      footer={
        <Button variant="ghost" onClick={onClose}>
          Fechar
        </Button>
      }
    >
      {history.isPending ? (
        <LoadingState label="Carregando histórico..." />
      ) : history.isError ? (
        <ErrorState message="Não foi possível carregar o histórico." onRetry={() => void history.refetch()} />
      ) : (
        <ol className="space-y-3" aria-label="Linha do tempo da entrega">
          {history.data.data.map((event) => {
            const detail = historyDetail(event);
            const attempt = historyAttempt(event);
            return (
              <li key={event.id} className="border-l-2 border-line pl-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-sm font-medium text-foreground">
                    {HISTORY_KIND_LABEL[event.kind]}
                    {attempt && <span className="ml-2 text-xs font-normal text-muted-foreground">{attempt}</span>}
                  </span>
                  <span className="text-xs tabular-nums text-muted-foreground">{formatWhen(event.at)}</span>
                </div>
                {detail && <div className="text-sm text-muted-foreground">{detail}</div>}
                {event.actor && (
                  <div className="text-xs text-muted-foreground">por {event.actor.name ?? 'usuário removido'}</div>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Dialog>
  );
}
