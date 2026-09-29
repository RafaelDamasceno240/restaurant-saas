'use client';

import { ReactNode, useEffect, useState } from 'react';
import Image from 'next/image';
import clsx from 'clsx';
import {
  Banknote,
  Bike,
  CalendarClock,
  ChefHat,
  Globe,
  AtSign,
  LayoutGrid,
  Mail,
  MapPin,
  MessageCircle,
  Pencil,
  Phone,
  ShoppingBag,
  Store,
  Wallet,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { Badge, BadgeTone, Button, Card, CardHeader, Page, StatCard } from '@/components/ds';
import { computeOpenStatus, OperationStatus, ProfileChannel, RestaurantProfile } from '@/lib/restaurant-profile';
import { EditProfileDialog } from './EditProfileDialog';

const OPERATION_ICON: Record<string, LucideIcon> = {
  online: Globe,
  delivery: Bike,
  pickup: ShoppingBag,
  counter: Store,
  tables: LayoutGrid,
  pos: Store,
  kds: ChefHat,
  cash: Wallet,
};

const CHANNEL_ICON: Record<ProfileChannel['key'], LucideIcon> = {
  whatsapp: MessageCircle,
  instagram: AtSign,
  phone: Phone,
  menu: Globe,
};

const OPERATION_BADGE: Record<OperationStatus, { tone: BadgeTone; label: string }> = {
  active: { tone: 'success', label: 'ATIVO' },
  not_configured: { tone: 'neutral', label: 'NÃO CONFIGURADO' },
  soon: { tone: 'info', label: 'EM BREVE' },
};

function DemoTag() {
  return (
    <Badge tone="brand" className="shrink-0">
      Dados demonstrativos
    </Badge>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon?: LucideIcon; label: string; value: ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      {Icon && (
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-surface-hover text-accent [&>svg]:h-4 [&>svg]:w-4">
          <Icon aria-hidden />
        </span>
      )}
      <div className="min-w-0">
        <dt className="text-2xs font-medium uppercase tracking-wide text-subtle">{label}</dt>
        <dd className="mt-0.5 break-words text-sm text-foreground">{value}</dd>
      </div>
    </div>
  );
}

export function RestaurantProfileView({
  profile: initialProfile,
  editable,
  metricsLoading,
  computeStatus,
}: {
  profile: RestaurantProfile;
  editable: boolean;
  metricsLoading?: boolean;
  computeStatus?: boolean;
}) {
  const [override, setOverride] = useState<RestaurantProfile | null>(null);
  const [editing, setEditing] = useState(false);
  const [computedStatus, setComputedStatus] = useState<RestaurantProfile['status']>(null);

  const profile = override ?? initialProfile;

  useEffect(() => {
    if (computeStatus) setComputedStatus(computeOpenStatus(profile.hours, new Date()));
  }, [computeStatus, profile.hours]);

  const status = computeStatus ? computedStatus : profile.status;
  const { address } = profile;

  return (
    <Page wide>
      <Card className="overflow-hidden">
        <div className="h-24 bg-gradient-to-r from-primary/50 via-accent/15 to-transparent sm:h-28" aria-hidden />
        <div className="flex flex-col gap-4 px-4 pb-5 sm:flex-row sm:items-end sm:px-6">
          <span className="relative -mt-12 block h-24 w-24 shrink-0 overflow-hidden rounded-full bg-background ring-2 ring-accent/60 sm:-mt-14 sm:h-28 sm:w-28">
            <Image
              src="/brand/doce-logo.png"
              alt="Logo do Do'cê Hamburgueria e Confeitaria"
              fill
              sizes="112px"
              priority
              className="scale-[1.28] object-contain"
            />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{profile.name}</h1>
            <p className="mt-1 text-sm text-accent">{profile.category}</p>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              {status && (
                <Badge tone={status === 'open' ? 'success' : 'danger'} dot>
                  {status === 'open' ? 'Aberto agora' : 'Fechado'}
                </Badge>
              )}
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" aria-hidden />
                {profile.location}
              </span>
              {profile.demo.profile && <DemoTag />}
            </div>
          </div>
          <Button variant="outline" icon={<Pencil className="h-4 w-4" aria-hidden />} onClick={() => setEditing(true)}>
            Editar perfil
          </Button>
        </div>
      </Card>

      <section aria-labelledby="metrics-title" className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 id="metrics-title" className="text-lg font-semibold text-foreground">
            Visão rápida
          </h2>
          {profile.demo.metrics && <DemoTag />}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {profile.metrics.map((metric) => (
            <StatCard
              key={metric.key}
              label={metric.label}
              value={metric.value ?? '—'}
              hint={metric.value === null && !metricsLoading ? 'Indisponível nesta fase' : metric.hint}
              loading={metricsLoading && metric.value === null}
              featured={metric.key === 'sales'}
            />
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title="Informações do restaurante" action={profile.demo.profile ? <DemoTag /> : undefined} />
            <div className="space-y-4 p-4">
              <p className="text-sm leading-relaxed text-muted-foreground">{profile.description}</p>
              <dl className="grid gap-4 sm:grid-cols-2">
                <InfoRow icon={Store} label="Nome fantasia" value={profile.name} />
                <InfoRow icon={Store} label="Razão social" value={profile.legalName} />
                <InfoRow icon={Banknote} label="Documento" value={profile.document} />
                <InfoRow icon={Globe} label="Slug" value={profile.slug} />
                <InfoRow icon={Phone} label="Telefone" value={profile.phone} />
                <InfoRow icon={Mail} label="E-mail" value={profile.email} />
              </dl>
            </div>
          </Card>

          <Card>
            <CardHeader title="Localização" action={profile.demo.address ? <DemoTag /> : undefined} />
            <div className="grid gap-4 p-4 sm:grid-cols-[1fr_auto]">
              <dl className="space-y-3">
                <InfoRow icon={MapPin} label="Endereço" value={address.street} />
                <InfoRow label="Bairro" value={address.district} />
                <InfoRow label="Cidade / Estado" value={address.region} />
              </dl>
              <div
                className="flex h-28 items-center justify-center rounded-ctl border border-line bg-surface-2 sm:w-56"
                aria-hidden
              >
                <MapPin className="h-8 w-8 text-primary" />
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Horário de funcionamento" action={profile.demo.hours ? <DemoTag /> : undefined} />
            <ul className="divide-y divide-line">
              {profile.hours.map((h) => (
                <li key={h.day} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="inline-flex items-center gap-2 text-foreground">
                    <CalendarClock className="h-4 w-4 text-subtle" aria-hidden />
                    {h.day}
                  </span>
                  <span className={clsx('tabular-nums', h.label === 'Fechado' ? 'text-danger' : 'text-muted-foreground')}>
                    {h.label}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader title="Canais de atendimento" action={profile.demo.channels ? <DemoTag /> : undefined} />
            <ul className="divide-y divide-line">
              {profile.channels.map((channel) => {
                const Icon = CHANNEL_ICON[channel.key];
                return (
                  <li key={channel.key} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                    <span className="inline-flex items-center gap-2 text-foreground">
                      <Icon className="h-4 w-4 text-accent" aria-hidden />
                      {channel.label}
                    </span>
                    {channel.value ? (
                      <span className="truncate text-muted-foreground">{channel.value}</span>
                    ) : (
                      <span className="text-muted-foreground">Não configurado</span>
                    )}
                  </li>
                );
              })}
            </ul>
          </Card>
        </div>
      </div>

      <section aria-labelledby="operations-title" className="space-y-3">
        <h2 id="operations-title" className="text-lg font-semibold text-foreground">
          Operação
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {profile.operations.map((operation) => {
            const Icon = OPERATION_ICON[operation.key] ?? Store;
            const badge = OPERATION_BADGE[operation.status];
            return (
              <Card key={operation.key} className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-md bg-primary/20 text-accent">
                    <Icon className="h-5 w-5" aria-hidden />
                  </span>
                  <Badge tone={badge.tone} dot>
                    {badge.label}
                  </Badge>
                </div>
                <h3 className="mt-3 text-base font-semibold text-foreground">{operation.label}</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">{operation.description}</p>
              </Card>
            );
          })}
        </div>
      </section>

      <EditProfileDialog
        key={editing ? 'open' : 'closed'}
        open={editing}
        onClose={() => setEditing(false)}
        profile={profile}
        editable={editable}
        onSave={setOverride}
      />
    </Page>
  );
}
