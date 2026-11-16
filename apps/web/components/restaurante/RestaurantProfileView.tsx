'use client';

import { ReactNode, useState } from 'react';
import clsx from 'clsx';
import {
  Banknote,
  Palette,
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
import { OperationStatus, ProfileChannel, RestaurantProfile } from '@/lib/restaurant-profile';
import { BrandMark } from '@/components/shell/BrandMark';
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

function InfoRow({
  icon: Icon,
  label,
  value,
}: {
  icon?: LucideIcon;
  label: string;
  value: ReactNode;
}) {
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

// `editable` is the demonstration: "Editar perfil" changes only this page's state. In real mode
// the page passes `onEdit` (it owns the form that saves to the server) or nothing, for someone
// who may only read the profile.
export function RestaurantProfileView({
  profile: initialProfile,
  logoUrl,
  logoImageClassName,
  coverUrl,
  editable,
  metricsLoading,
  onEdit,
  onEditBranding,
}: {
  profile: RestaurantProfile;
  /** The restaurant's own logo (null: its initials). */
  logoUrl?: string | null;
  /** Zoom for a badge-shaped logo with margins (the demonstration's artwork). */
  logoImageClassName?: string;
  /** The cover of the public menu, shown as the banner (none: a gradient). */
  coverUrl?: string | null;
  editable: boolean;
  metricsLoading?: boolean;
  onEdit?: () => void;
  /** Opens the logo / cover / color editor (only for who may change them). */
  onEditBranding?: () => void;
}) {
  const [override, setOverride] = useState<RestaurantProfile | null>(null);
  const [editing, setEditing] = useState(false);

  const profile = override ?? initialProfile;
  const { address, status } = profile;
  const demoEditing = editable && !onEdit;

  return (
    <Page wide>
      <Card className="overflow-hidden">
        {coverUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={coverUrl} alt="" className="h-24 w-full object-cover sm:h-28" />
        ) : (
          <div
            className="h-24 bg-gradient-to-r from-primary/50 via-accent/15 to-transparent sm:h-28"
            aria-hidden
          />
        )}
        <div className="flex flex-col gap-4 px-4 pb-5 sm:flex-row sm:items-end sm:px-6">
          <BrandMark
            name={profile.name}
            logoUrl={logoUrl}
            imageClassName={logoImageClassName}
            className="-mt-12 h-24 w-24 text-3xl ring-2 ring-accent/60 sm:-mt-14 sm:h-28 sm:w-28"
            decorative
          />
          <div className="min-w-0 flex-1">
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
              {profile.name}
            </h1>
            {profile.category && <p className="mt-1 text-sm text-accent">{profile.category}</p>}
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
          {(onEdit || demoEditing) && (
            <Button
              variant="outline"
              icon={<Pencil className="h-4 w-4" aria-hidden />}
              onClick={() => (onEdit ? onEdit() : setEditing(true))}
            >
              Editar perfil
            </Button>
          )}
          {onEditBranding && (
            <Button
              variant="outline"
              icon={<Palette className="h-4 w-4" aria-hidden />}
              onClick={onEditBranding}
            >
              Identidade visual
            </Button>
          )}
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
              hint={
                metric.value === null && !metricsLoading ? 'Indisponível nesta fase' : metric.hint
              }
              loading={metricsLoading && metric.value === null}
              featured={metric.key === 'sales'}
            />
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader
              title="Informações do restaurante"
              action={profile.demo.profile ? <DemoTag /> : undefined}
            />
            <div className="space-y-4 p-4">
              <p className="text-sm leading-relaxed text-muted-foreground">
                {profile.description || 'Nenhuma descrição informada.'}
              </p>
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
            <CardHeader
              title="Localização"
              action={profile.demo.address ? <DemoTag /> : undefined}
            />
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
            <CardHeader
              title="Horário de funcionamento"
              action={profile.demo.hours ? <DemoTag /> : undefined}
            />
            <ul className="divide-y divide-line">
              {profile.hours.map((h) => (
                <li
                  key={h.day}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                >
                  <span className="inline-flex items-center gap-2 text-foreground">
                    <CalendarClock className="h-4 w-4 text-subtle" aria-hidden />
                    {h.day}
                  </span>
                  <span
                    className={clsx(
                      'tabular-nums',
                      h.label === 'Fechado' ? 'text-danger' : 'text-muted-foreground',
                    )}
                  >
                    {h.label}
                  </span>
                </li>
              ))}
            </ul>
          </Card>

          <Card>
            <CardHeader
              title="Canais de atendimento"
              action={profile.demo.channels ? <DemoTag /> : undefined}
            />
            <ul className="divide-y divide-line">
              {profile.channels.map((channel) => {
                const Icon = CHANNEL_ICON[channel.key];
                return (
                  <li
                    key={channel.key}
                    className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm"
                  >
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

      {demoEditing && (
        <EditProfileDialog
          key={editing ? 'open' : 'closed'}
          open={editing}
          onClose={() => setEditing(false)}
          profile={profile}
          editable
          onSave={setOverride}
        />
      )}
    </Page>
  );
}
