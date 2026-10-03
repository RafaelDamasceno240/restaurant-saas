'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { useActiveBranch } from '@/lib/use-active-branch';
import { Coupon, couponsApi, CouponDiscountType } from '@/lib/coupons-api';
import {
  CouponDraft,
  couponErrorMessage,
  draftToCreateInput,
  draftToPatch,
  EMPTY_DRAFT,
  isEmptyPatch,
  MAX_DESCRIPTION,
  toDraft,
  validateDraft,
} from '@/lib/coupons-logic';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ds/Input';
import { Alert } from '@/components/ds/States';
import { useToast } from '@/components/ds/Toast';

// OWNER/ADMIN may create coupons that work at every branch; everyone else (a branch-limited
// manager) must pick one of their branches. The API enforces this - the form only guides.
const TENANT_WIDE = ['OWNER', 'ADMIN'];

// Create (coupon = null) or edit. The request is one mutation guarded by a synchronous ref: React
// state does not change between two clicks of the same tick, so `isPending` alone cannot stop a
// repeated submit. On failure the dialog stays open with the server's message. The code and the
// branch are fixed at creation, so editing shows them read-only.
export function CouponFormDialog({
  open,
  coupon,
  onClose,
}: {
  open: boolean;
  coupon: Coupon | null;
  onClose: () => void;
}) {
  const { user, accessToken } = useAuth();
  const { branches } = useActiveBranch();
  const toast = useToast();
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<CouponDraft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const editing = coupon !== null;
  const tenantWide = (user?.roles ?? []).some((role) => TENANT_WIDE.includes(role));

  useEffect(() => {
    if (open) {
      setDraft(coupon ? toDraft(coupon) : EMPTY_DRAFT);
      setError(null);
      saving.current = false;
    }
  }, [open, coupon]);

  const save = useMutation({
    mutationFn: () => {
      const problem = validateDraft(draft, { creating: !editing, branchRequired: !editing && !tenantWide });
      if (problem) throw new Error(problem);
      if (!coupon) return couponsApi.create(accessToken as string, draftToCreateInput(draft));
      const patch = draftToPatch(draft, coupon);
      if (isEmptyPatch(patch)) return Promise.resolve(coupon);
      return couponsApi.update(accessToken as string, coupon.id, patch);
    },
    onSuccess: async (saved) => {
      toast.success(editing ? `Cupom ${saved.code} atualizado.` : `Cupom ${saved.code} criado.`);
      await queryClient.invalidateQueries({ queryKey: ['coupons'] });
      onClose();
    },
    onError: (err) => {
      const code = err instanceof ApiError ? err.code : undefined;
      setError(couponErrorMessage(code, err instanceof Error ? err.message : 'Não foi possível salvar o cupom.'));
    },
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

  const set = <K extends keyof CouponDraft>(key: K, value: CouponDraft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const busy = save.isPending;
  const percentage = draft.discountType === 'PERCENTAGE';

  return (
    <Dialog
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      title={editing ? `Editar cupom ${coupon?.code}` : 'Novo cupom'}
      description={
        editing
          ? 'O código e a unidade não mudam depois de criados. Pedidos já feitos mantêm o desconto aplicado.'
          : 'O desconto é sempre calculado pelo servidor sobre o subtotal dos itens; a taxa de entrega não recebe desconto.'
      }
      size="lg"
    >
      <form onSubmit={submit} className="space-y-3" noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Código"
            hint={editing ? 'Não pode ser alterado' : 'Letras, números, - e _ (3 a 32). Ex.: PROMO10'}
            className="sm:col-span-2"
          >
            <Input
              value={draft.code}
              maxLength={40}
              autoFocus={!editing}
              disabled={editing}
              autoComplete="off"
              autoCapitalize="characters"
              className="font-mono uppercase"
              onChange={(e) => set('code', e.target.value)}
            />
          </Field>

          <Field label="Tipo de desconto">
            <Select value={draft.discountType} onChange={(e) => set('discountType', e.target.value as CouponDiscountType)}>
              <option value="PERCENTAGE">Percentual (%)</option>
              <option value="FIXED">Valor fixo (R$)</option>
            </Select>
          </Field>
          <Field label={percentage ? 'Percentual (1 a 100)' : 'Valor do desconto (R$)'}>
            <Input
              value={draft.value}
              inputMode={percentage ? 'numeric' : 'decimal'}
              maxLength={12}
              autoComplete="off"
              placeholder={percentage ? '10' : '5,00'}
              onChange={(e) => set('value', e.target.value)}
            />
          </Field>

          <Field label="Pedido mínimo (R$, opcional)" hint="Sobre o subtotal dos itens, antes do desconto">
            <Input value={draft.minOrder} inputMode="decimal" maxLength={12} autoComplete="off" placeholder="30,00" onChange={(e) => set('minOrder', e.target.value)} />
          </Field>
          {percentage && (
            <Field label="Teto do desconto (R$, opcional)" hint="Limita o desconto percentual">
              <Input value={draft.maxDiscount} inputMode="decimal" maxLength={12} autoComplete="off" placeholder="20,00" onChange={(e) => set('maxDiscount', e.target.value)} />
            </Field>
          )}

          <Field label="Início (opcional)">
            <Input type="datetime-local" value={draft.startsAt} onChange={(e) => set('startsAt', e.target.value)} />
          </Field>
          <Field label="Término (opcional)">
            <Input type="datetime-local" value={draft.endsAt} onChange={(e) => set('endsAt', e.target.value)} />
          </Field>

          <Field label="Limite de utilizações (opcional)" hint="Total de pedidos que podem usar o cupom">
            <Input value={draft.usageLimit} inputMode="numeric" maxLength={10} autoComplete="off" onChange={(e) => set('usageLimit', e.target.value)} />
          </Field>
          <Field label="Limite por cliente (opcional)" hint="Exige cliente cadastrado no pedido (PDV)">
            <Input value={draft.perCustomerLimit} inputMode="numeric" maxLength={10} autoComplete="off" onChange={(e) => set('perCustomerLimit', e.target.value)} />
          </Field>

          <Field
            label="Unidade"
            hint={editing ? 'Não pode ser alterada' : tenantWide ? 'Todas as unidades ou uma específica' : 'Escolha a sua unidade'}
            className="sm:col-span-2"
          >
            <Select value={draft.branchId} disabled={editing} onChange={(e) => set('branchId', e.target.value)}>
              {(tenantWide || editing) && <option value="">Todas as unidades</option>}
              {!tenantWide && !editing && <option value="">Selecione...</option>}
              {branches.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
              {editing && coupon?.branch && !branches.some((b) => b.id === coupon.branch?.id) && (
                <option value={coupon.branch.id}>{coupon.branch.name}</option>
              )}
            </Select>
          </Field>

          <Field label="Descrição (opcional)" hint={`${draft.description.length}/${MAX_DESCRIPTION}`} className="sm:col-span-2">
            <Textarea value={draft.description} rows={2} maxLength={MAX_DESCRIPTION} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>
        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy} disabled={busy}>
            {editing ? 'Salvar alterações' : 'Criar cupom'}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
