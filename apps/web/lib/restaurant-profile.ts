import { apiFetch } from './api-client';

export type OperationStatus = 'active' | 'not_configured' | 'soon';
export type OpenStatus = 'open' | 'closed';

export interface ProfileAddress {
  street: string;
  district: string;
  region: string;
}

export interface ProfileHour {
  day: string;
  label: string;
}

export interface ProfileChannel {
  key: 'whatsapp' | 'instagram' | 'phone' | 'menu';
  label: string;
  value: string | null;
}

export interface ProfileOperation {
  key: string;
  label: string;
  description: string;
  status: OperationStatus;
}

export interface ProfileMetric {
  key: string;
  label: string;
  value: string | null;
  hint: string;
}

export interface RestaurantProfile {
  name: string;
  category: string;
  location: string;
  description: string;
  legalName: string;
  document: string;
  phone: string;
  email: string;
  slug: string;
  address: ProfileAddress;
  hours: ProfileHour[];
  channels: ProfileChannel[];
  operations: ProfileOperation[];
  metrics: ProfileMetric[];
  status: OpenStatus | null;
  demo: {
    profile: boolean;
    address: boolean;
    hours: boolean;
    channels: boolean;
    metrics: boolean;
  };
}

export interface CurrentTenant {
  id: string;
  name: string;
  legalName: string | null;
  document: string | null;
  slug: string;
  status: string;
}

export function getCurrentTenant(accessToken: string): Promise<CurrentTenant> {
  return apiFetch<CurrentTenant>('/tenants/current', { accessToken });
}

function clean(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function mergeTenantIntoProfile(base: RestaurantProfile, tenant: CurrentTenant): RestaurantProfile {
  return {
    ...base,
    name: clean(tenant.name) ?? base.name,
    legalName: clean(tenant.legalName) ?? 'Não informado',
    document: clean(tenant.document) ?? 'Não informado',
    slug: clean(tenant.slug) ?? base.slug,
  };
}

const DAY_INDEX = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];

function toMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function parseRange(label: string): [number, number] | null {
  const match = label.match(/(\d{1,2}:\d{2})\s*[—–-]\s*(\d{1,2}:\d{2})/);
  if (!match) return null;
  const start = toMinutes(match[1]);
  let end = toMinutes(match[2]);
  if (end <= start) end += 24 * 60;
  return [start, end];
}

export function computeOpenStatus(hours: ProfileHour[], now: Date): OpenStatus {
  const minutes = now.getHours() * 60 + now.getMinutes();
  const today = DAY_INDEX[now.getDay()];
  const yesterday = DAY_INDEX[(now.getDay() + 6) % 7];
  const todayRange = parseRange(hours.find((h) => h.day === today)?.label ?? '');
  if (todayRange && minutes >= todayRange[0] && minutes < todayRange[1]) return 'open';
  const yesterdayRange = parseRange(hours.find((h) => h.day === yesterday)?.label ?? '');
  if (yesterdayRange && yesterdayRange[1] > 24 * 60 && minutes + 24 * 60 < yesterdayRange[1]) return 'open';
  return 'closed';
}
