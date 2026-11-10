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

// What the profile screen shows (real or demonstration).
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

// Same contract as the API (modules/tenants/opening-hours.ts): weekday 0 = Sunday; a "closes"
// earlier than "opens" ends after midnight.
export interface OpeningInterval {
  weekday: number;
  opens: string;
  closes: string;
}

// GET/PATCH /tenants/current/profile. Phones and CEP come as digits; Instagram without "@".
export interface RestaurantProfileData {
  name: string;
  legalName: string;
  document: string;
  slug: string;
  timezone: string;
  description: string | null;
  instagram: string | null;
  branch: {
    id: string;
    name: string;
    phone: string | null;
    whatsapp: string | null;
    email: string | null;
    address: string | null;
    number: string | null;
    complement: string | null;
    neighborhood: string | null;
    city: string | null;
    state: string | null;
    zipCode: string | null;
    openingHours: OpeningInterval[] | null;
  };
  openNow: boolean | null;
}

// Only the keys sent change; null clears (except name and legal name).
export interface RestaurantProfilePatch {
  name?: string;
  legalName?: string;
  description?: string | null;
  instagram?: string | null;
  phone?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  address?: string | null;
  number?: string | null;
  complement?: string | null;
  neighborhood?: string | null;
  city?: string | null;
  state?: string | null;
  zipCode?: string | null;
  openingHours?: OpeningInterval[] | null;
}

export function getRestaurantProfile(accessToken: string): Promise<RestaurantProfileData> {
  return apiFetch<RestaurantProfileData>('/tenants/current/profile', { accessToken });
}

export function updateRestaurantProfile(
  accessToken: string,
  patch: RestaurantProfilePatch,
): Promise<RestaurantProfileData> {
  return apiFetch<RestaurantProfileData>('/tenants/current/profile', {
    method: 'PATCH',
    body: patch,
    accessToken,
  });
}
