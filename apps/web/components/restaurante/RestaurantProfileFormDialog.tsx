'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { ApiError } from '@/lib/api-client';
import { RestaurantProfileData, updateRestaurantProfile } from '@/lib/restaurant-profile';
import {
  BRAZILIAN_STATES,
  DayDraft,
  DEFAULT_SHIFT,
  isEmptyPatch,
  MAX_DESCRIPTION,
  MAX_SHIFTS_PER_DAY,
  ProfileDraft,
  profileDraftToPatch,
  toProfileDraft,
  validateProfileDraft,
} from '@/lib/restaurant-profile-logic';
import { Button } from '@/components/ds/Button';
import { Dialog } from '@/components/ds/Dialog';
import { Field, Input, Select, Textarea } from '@/components/ds/Input';
import { Alert } from '@/components/ds/States';
import { Switch } from '@/components/ds/Switch';
import { useToast } from '@/components/ds/Toast';

type TextField = Exclude<keyof ProfileDraft, 'hoursEnabled' | 'days'>;

// Saves the restaurant profile: the brand and the contact, address and hours of the branch that
// receives online orders. Sends only what changed. The request is guarded by a synchronous ref
// (two clicks in the same tick see the same state); on failure the dialog stays open with the
// server's message.
export function RestaurantProfileFormDialog({
  open,
  profile,
  onClose,
}: {
  open: boolean;
  profile: RestaurantProfileData;
  onClose: () => void;
}) {
  const { accessToken, refreshUser } = useAuth();
  const toast = useToast();
  const queryClient = useQueryClient();
  // The profile as it was when the dialog opened. A background refetch while the form is open
  // neither resets what is being typed nor makes the patch send fields nobody touched here
  // (which would undo a change someone else saved meanwhile).
  const [baseline, setBaseline] = useState<RestaurantProfileData>(profile);
  const [draft, setDraft] = useState<ProfileDraft>(() => toProfileDraft(profile));
  const [error, setError] = useState<string | null>(null);
  const saving = useRef(false);
  const latest = useRef(profile);
  latest.current = profile;

  useEffect(() => {
    if (open) {
      setBaseline(latest.current);
      setDraft(toProfileDraft(latest.current));
      setError(null);
      saving.current = false;
    }
  }, [open]);

  const save = useMutation({
    mutationFn: () => {
      const problem = validateProfileDraft(draft);
      if (problem) throw new Error(problem);
      const patch = profileDraftToPatch(draft, baseline);
      if (isEmptyPatch(patch)) return Promise.resolve(latest.current);
      return updateRestaurantProfile(accessToken as string, patch);
    },
    onSuccess: async (saved) => {
      queryClient.setQueryData(['restaurant-profile'], saved);
      if (saved.name !== baseline.name) await refreshUser().catch(() => undefined);
      toast.success('Perfil do restaurante salvo.');
      onClose();
    },
    onError: (err) => {
      if (err instanceof ApiError && err.statusCode === 403) {
        setError('Somente o proprietário ou um administrador pode alterar o perfil.');
        return;
      }
      setError(err instanceof Error ? err.message : 'Não foi possível salvar o perfil.');
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

  const set = (key: TextField, value: string) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const setDay = (weekday: number, change: (day: DayDraft) => DayDraft) =>
    setDraft((current) => ({
      ...current,
      days: current.days.map((day) => (day.weekday === weekday ? change(day) : day)),
    }));
  const busy = save.isPending;

  return (
    <Dialog
      open={open}
      onClose={() => (busy ? undefined : onClose())}
      title="Editar perfil do restaurante"
      description="Nome, descrição, contato, endereço e horários aparecem no cardápio público. O e-mail e a razão social ficam só aqui."
      size="lg"
    >
      <form onSubmit={submit} className="min-w-0 space-y-5" noValidate>
        <fieldset className="grid min-w-0 gap-3 sm:grid-cols-2" disabled={busy}>
          <legend className="mb-2 text-sm font-semibold text-foreground">Restaurante</legend>
          <Field label="Nome no cardápio">
            <Input
              value={draft.name}
              maxLength={120}
              autoComplete="off"
              onChange={(e) => set('name', e.target.value)}
            />
          </Field>
          <Field label="Razão social">
            <Input
              value={draft.legalName}
              maxLength={160}
              autoComplete="off"
              onChange={(e) => set('legalName', e.target.value)}
            />
          </Field>
          <Field
            label="Descrição (opcional)"
            hint={`${draft.description.length}/${MAX_DESCRIPTION}`}
            className="sm:col-span-2"
          >
            <Textarea
              value={draft.description}
              rows={3}
              maxLength={MAX_DESCRIPTION}
              placeholder="O que o restaurante serve, em poucas palavras."
              onChange={(e) => set('description', e.target.value)}
            />
          </Field>
        </fieldset>

        <fieldset className="grid min-w-0 gap-3 sm:grid-cols-2" disabled={busy}>
          <legend className="mb-2 text-sm font-semibold text-foreground">Contato</legend>
          <Field label="Telefone" hint="Com DDD">
            <Input
              value={draft.phone}
              maxLength={25}
              inputMode="tel"
              autoComplete="off"
              onChange={(e) => set('phone', e.target.value)}
            />
          </Field>
          <Field label="WhatsApp" hint="Com DDD; vira um link no cardápio">
            <Input
              value={draft.whatsapp}
              maxLength={25}
              inputMode="tel"
              autoComplete="off"
              onChange={(e) => set('whatsapp', e.target.value)}
            />
          </Field>
          <Field label="Instagram" hint="Só o nome da conta, ex.: @seurestaurante">
            <Input
              value={draft.instagram}
              maxLength={31}
              autoComplete="off"
              onChange={(e) => set('instagram', e.target.value)}
            />
          </Field>
          <Field label="E-mail" hint="Não aparece no cardápio">
            <Input
              type="email"
              value={draft.email}
              maxLength={120}
              autoComplete="off"
              onChange={(e) => set('email', e.target.value)}
            />
          </Field>
        </fieldset>

        <fieldset className="grid min-w-0 gap-3 sm:grid-cols-6" disabled={busy}>
          <legend className="mb-2 text-sm font-semibold text-foreground">Endereço</legend>
          <Field label="Rua" className="sm:col-span-4">
            <Input
              value={draft.address}
              maxLength={200}
              autoComplete="off"
              onChange={(e) => set('address', e.target.value)}
            />
          </Field>
          <Field label="Número" className="sm:col-span-2">
            <Input
              value={draft.number}
              maxLength={20}
              autoComplete="off"
              onChange={(e) => set('number', e.target.value)}
            />
          </Field>
          <Field label="Complemento" className="sm:col-span-3">
            <Input
              value={draft.complement}
              maxLength={120}
              autoComplete="off"
              onChange={(e) => set('complement', e.target.value)}
            />
          </Field>
          <Field label="Bairro" className="sm:col-span-3">
            <Input
              value={draft.neighborhood}
              maxLength={120}
              autoComplete="off"
              onChange={(e) => set('neighborhood', e.target.value)}
            />
          </Field>
          <Field label="Cidade" className="sm:col-span-3">
            <Input
              value={draft.city}
              maxLength={120}
              autoComplete="off"
              onChange={(e) => set('city', e.target.value)}
            />
          </Field>
          <Field label="UF" className="sm:col-span-1">
            <Select
              value={draft.state}
              onChange={(e) => set('state', e.target.value)}
              aria-label="UF"
            >
              <option value="">—</option>
              {BRAZILIAN_STATES.map((uf) => (
                <option key={uf} value={uf}>
                  {uf}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="CEP" className="sm:col-span-2">
            <Input
              value={draft.zipCode}
              maxLength={9}
              inputMode="numeric"
              autoComplete="off"
              onChange={(e) => set('zipCode', e.target.value)}
            />
          </Field>
        </fieldset>

        <fieldset className="min-w-0 space-y-3" disabled={busy}>
          <legend className="mb-2 text-sm font-semibold text-foreground">
            Horário de funcionamento
          </legend>
          <div className="flex items-center justify-between gap-3 rounded-ctl border border-line bg-surface-2 px-3 py-2">
            <span className="text-sm text-foreground">Informar horários no cardápio</span>
            <Switch
              checked={draft.hoursEnabled}
              onChange={(checked) => setDraft((current) => ({ ...current, hoursEnabled: checked }))}
              label="Informar horários no cardápio"
              disabled={busy}
            />
          </div>
          {draft.hoursEnabled ? (
            <>
              <p className="text-2xs text-subtle">
                Fechamento antes da abertura (ex.: 18:00 às 02:00) vale até a madrugada do dia
                seguinte. &quot;Aberto agora&quot; segue o fuso do restaurante.
              </p>
              <ul className="divide-y divide-line rounded-ctl border border-line">
                {draft.days.map((day) => (
                  <li
                    key={day.weekday}
                    className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-start"
                  >
                    <div className="flex w-full items-center justify-between gap-3 sm:w-40 sm:shrink-0 sm:pt-1.5">
                      <span className="text-sm font-medium text-foreground">{day.label}</span>
                      <Switch
                        checked={day.open}
                        onChange={(checked) =>
                          setDay(day.weekday, (d) => ({ ...d, open: checked }))
                        }
                        label={`${day.label}: aberto`}
                        disabled={busy}
                      />
                    </div>
                    {day.open ? (
                      <div className="min-w-0 flex-1 space-y-2">
                        {day.shifts.map((shift, index) => (
                          <div key={index} className="flex items-center gap-2">
                            <Input
                              type="time"
                              value={shift.opens}
                              aria-label={`${day.label}: abre`}
                              className="min-w-0 flex-1"
                              onChange={(e) =>
                                setDay(day.weekday, (d) => ({
                                  ...d,
                                  shifts: d.shifts.map((s, i) =>
                                    i === index ? { ...s, opens: e.target.value } : s,
                                  ),
                                }))
                              }
                            />
                            <span className="text-xs text-muted-foreground">às</span>
                            <Input
                              type="time"
                              value={shift.closes}
                              aria-label={`${day.label}: fecha`}
                              className="min-w-0 flex-1"
                              onChange={(e) =>
                                setDay(day.weekday, (d) => ({
                                  ...d,
                                  shifts: d.shifts.map((s, i) =>
                                    i === index ? { ...s, closes: e.target.value } : s,
                                  ),
                                }))
                              }
                            />
                            {day.shifts.length > 1 && (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`${day.label}: remover turno`}
                                icon={<X className="h-4 w-4" aria-hidden />}
                                onClick={() =>
                                  setDay(day.weekday, (d) => ({
                                    ...d,
                                    shifts: d.shifts.filter((_, i) => i !== index),
                                  }))
                                }
                              />
                            )}
                          </div>
                        ))}
                        {day.shifts.length < MAX_SHIFTS_PER_DAY && (
                          <Button
                            variant="ghost"
                            size="sm"
                            icon={<Plus className="h-4 w-4" aria-hidden />}
                            onClick={() =>
                              setDay(day.weekday, (d) => ({
                                ...d,
                                shifts: [...d.shifts, { ...DEFAULT_SHIFT }],
                              }))
                            }
                          >
                            Outro turno
                          </Button>
                        )}
                      </div>
                    ) : (
                      <span className="text-sm text-danger sm:pt-1.5">Fechado</span>
                    )}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              O cardápio não mostra horários nem &quot;aberto agora&quot;.
            </p>
          )}
        </fieldset>

        {error && <Alert tone="danger">{error}</Alert>}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            Cancelar
          </Button>
          <Button type="submit" loading={busy} disabled={busy}>
            Salvar perfil
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
