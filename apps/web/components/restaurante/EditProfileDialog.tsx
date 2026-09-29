'use client';

import { useState } from 'react';
import { Button, Dialog, Field, Input, Textarea } from '@/components/ds';
import type { RestaurantProfile } from '@/lib/restaurant-profile';

interface Draft {
  name: string;
  description: string;
  phone: string;
  email: string;
  street: string;
  district: string;
  region: string;
  instagram: string;
  whatsapp: string;
  hours: string[];
}

function channelValue(profile: RestaurantProfile, key: 'instagram' | 'whatsapp'): string {
  return profile.channels.find((c) => c.key === key)?.value ?? '';
}

function toDraft(profile: RestaurantProfile): Draft {
  return {
    name: profile.name,
    description: profile.description,
    phone: profile.phone,
    email: profile.email === 'Não informado' ? '' : profile.email,
    street: profile.address.street,
    district: profile.address.district,
    region: profile.address.region,
    instagram: channelValue(profile, 'instagram'),
    whatsapp: channelValue(profile, 'whatsapp'),
    hours: profile.hours.map((h) => h.label),
  };
}

function orNull(value: string): string | null {
  return value.trim() || null;
}

function applyDraft(profile: RestaurantProfile, draft: Draft): RestaurantProfile {
  return {
    ...profile,
    name: draft.name.trim() || profile.name,
    description: draft.description.trim() || profile.description,
    phone: draft.phone.trim() || profile.phone,
    email: draft.email.trim() || 'Não informado',
    address: { street: draft.street.trim(), district: draft.district.trim(), region: draft.region.trim() },
    hours: profile.hours.map((h, i) => ({ ...h, label: draft.hours[i]?.trim() || 'Fechado' })),
    channels: profile.channels.map((c) => {
      if (c.key === 'instagram') return { ...c, value: orNull(draft.instagram) };
      if (c.key === 'whatsapp') return { ...c, value: orNull(draft.whatsapp) };
      if (c.key === 'phone') return { ...c, value: orNull(draft.phone) ?? c.value };
      return c;
    }),
  };
}

export function EditProfileDialog({
  open,
  onClose,
  profile,
  editable,
  onSave,
}: {
  open: boolean;
  onClose: () => void;
  profile: RestaurantProfile;
  editable: boolean;
  onSave: (next: RestaurantProfile) => void;
}) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(profile));

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Editar perfil"
      description={
        editable
          ? 'As alterações valem apenas nesta apresentação e não são gravadas.'
          : 'A edição do perfil ainda não possui integração com o servidor.'
      }
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {editable ? 'Cancelar' : 'Fechar'}
          </Button>
          {editable && (
            <Button
              onClick={() => {
                onSave(applyDraft(profile, draft));
                onClose();
              }}
            >
              Aplicar na apresentação
            </Button>
          )}
        </>
      }
    >
      <fieldset disabled={!editable} className="min-w-0 space-y-4">
        {!editable && (
          <p className="rounded-ctl border border-line bg-surface-2 px-3 py-2 text-xs text-muted-foreground">
            Formulário em modo somente leitura. Nenhum dado é simulado ou salvo fora do modo demonstração.
          </p>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nome" className="sm:col-span-2">
            <Input value={draft.name} onChange={(e) => update('name', e.target.value)} />
          </Field>
          <Field label="Descrição" className="sm:col-span-2">
            <Textarea value={draft.description} onChange={(e) => update('description', e.target.value)} rows={4} />
          </Field>
          <Field label="Telefone">
            <Input value={draft.phone} onChange={(e) => update('phone', e.target.value)} />
          </Field>
          <Field label="E-mail">
            <Input type="email" value={draft.email} onChange={(e) => update('email', e.target.value)} />
          </Field>
          <Field label="WhatsApp">
            <Input value={draft.whatsapp} onChange={(e) => update('whatsapp', e.target.value)} placeholder="Não configurado" />
          </Field>
          <Field label="Instagram">
            <Input value={draft.instagram} onChange={(e) => update('instagram', e.target.value)} placeholder="Não configurado" />
          </Field>
          <Field label="Endereço" className="sm:col-span-2">
            <Input value={draft.street} onChange={(e) => update('street', e.target.value)} />
          </Field>
          <Field label="Bairro">
            <Input value={draft.district} onChange={(e) => update('district', e.target.value)} />
          </Field>
          <Field label="Cidade / Estado">
            <Input value={draft.region} onChange={(e) => update('region', e.target.value)} />
          </Field>
        </div>
        <div>
          <p className="mb-2 text-xs font-medium text-muted-foreground">Horário de funcionamento</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {profile.hours.map((h, i) => (
              <Field key={h.day} label={h.day}>
                <Input
                  value={draft.hours[i] ?? ''}
                  onChange={(e) => update('hours', draft.hours.map((v, j) => (j === i ? e.target.value : v)))}
                />
              </Field>
            ))}
          </div>
        </div>
      </fieldset>
    </Dialog>
  );
}
