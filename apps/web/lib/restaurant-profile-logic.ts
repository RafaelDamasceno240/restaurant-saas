// Pure logic of the restaurant profile: how the stored data is shown (dashboard and public
// menu), and the edit form (draft, validation, patch with only what changed). The rules mirror
// the API (modules/tenants); the API re-validates everything and has the last word, including
// on overlapping hours, which only it checks.

import { formatCpf, formatPhone, normalizePhone } from './customers-logic';
import type {
  OpeningInterval,
  RestaurantProfile,
  RestaurantProfileData,
  RestaurantProfilePatch,
} from './restaurant-profile';

export const MAX_DESCRIPTION = 500;
export const MAX_SHIFTS_PER_DAY = 3;

// Display order: the week as a restaurant reads it, Monday first. `weekday` is the API's
// (0 = Sunday).
export const WEEK: { weekday: number; label: string }[] = [
  { weekday: 1, label: 'Segunda' },
  { weekday: 2, label: 'Terça' },
  { weekday: 3, label: 'Quarta' },
  { weekday: 4, label: 'Quinta' },
  { weekday: 5, label: 'Sexta' },
  { weekday: 6, label: 'Sábado' },
  { weekday: 0, label: 'Domingo' },
];

export const BRAZILIAN_STATES = [
  'AC',
  'AL',
  'AP',
  'AM',
  'BA',
  'CE',
  'DF',
  'ES',
  'GO',
  'MA',
  'MT',
  'MS',
  'MG',
  'PA',
  'PB',
  'PR',
  'PE',
  'PI',
  'RJ',
  'RN',
  'RS',
  'RO',
  'RR',
  'SC',
  'SP',
  'SE',
  'TO',
];

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INSTAGRAM = /^[A-Za-z0-9._]{1,30}$/;
const ZIP = /^\d{5}-?\d{3}$/;
const NOT_INFORMED = 'Não informado';

// ---------------------------------------------------------------------------
// Showing
// ---------------------------------------------------------------------------

export interface AddressParts {
  street: string | null;
  number: string | null;
  complement: string | null;
  neighborhood: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
}

export function formatZipCode(zip: string): string {
  return /^\d{8}$/.test(zip) ? `${zip.slice(0, 5)}-${zip.slice(5)}` : zip;
}

export function formatDocument(document: string): string {
  if (/^\d{14}$/.test(document)) {
    return `${document.slice(0, 2)}.${document.slice(2, 5)}.${document.slice(5, 8)}/${document.slice(8, 12)}-${document.slice(12)}`;
  }
  return formatCpf(document);
}

// "Rua das Flores, 120 - Loja 2"
export function formatStreetLine(address: AddressParts): string | null {
  if (!address.street) return null;
  let line = address.street;
  if (address.number) line += `, ${address.number}`;
  if (address.complement) line += ` - ${address.complement}`;
  return line;
}

// "Belo Horizonte/MG"
export function formatCityLine(address: AddressParts): string | null {
  if (address.city && address.state) return `${address.city}/${address.state}`;
  return address.city ?? address.state ?? null;
}

// One line for the public menu: "Rua das Flores, 120 - Loja 2 · Centro · Belo Horizonte/MG".
export function formatFullAddress(address: AddressParts): string | null {
  const parts = [formatStreetLine(address), address.neighborhood, formatCityLine(address)].filter(
    Boolean,
  );
  return parts.length ? parts.join(' · ') : null;
}

export function mapsUrl(address: AddressParts): string | null {
  const query = [
    formatStreetLine(address),
    address.neighborhood,
    formatCityLine(address),
    address.zipCode && formatZipCode(address.zipCode),
  ]
    .filter(Boolean)
    .join(', ');
  return address.street
    ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`
    : null;
}

// A national number (10 or 11 digits) gets the Brazilian country code.
export function whatsappUrl(digits: string): string {
  return `https://wa.me/${/^\d{10,11}$/.test(digits) ? `55${digits}` : digits}`;
}

export function instagramUrl(handle: string): string {
  return `https://www.instagram.com/${encodeURIComponent(handle)}/`;
}

export function telUrl(digits: string): string {
  return `tel:${digits}`;
}

// "11:00 — 15:00 · 18:00 — 23:00", or "Fechado" for a day with no interval.
export function formatDayHours(intervals: OpeningInterval[], weekday: number): string {
  const day = intervals
    .filter((i) => i.weekday === weekday)
    .sort((a, b) => a.opens.localeCompare(b.opens));
  return day.length ? day.map((i) => `${i.opens} — ${i.closes}`).join(' · ') : 'Fechado';
}

export function weekHours(intervals: OpeningInterval[] | null): { day: string; label: string }[] {
  return WEEK.map(({ weekday, label }) => ({
    day: label,
    label: intervals === null ? NOT_INFORMED : formatDayHours(intervals, weekday),
  }));
}

function branchAddress(data: RestaurantProfileData): AddressParts {
  const { address: street, number, complement, neighborhood, city, state, zipCode } = data.branch;
  return { street, number, complement, neighborhood, city, state, zipCode };
}

// The profile screen in real mode: everything comes from the server. `base` only provides the
// operation cards and the metric labels, which are not profile data.
export function toProfileView(
  data: RestaurantProfileData,
  base: RestaurantProfile,
): RestaurantProfile {
  const address = branchAddress(data);
  const { branch } = data;
  const region = [
    formatCityLine(address),
    address.zipCode && `CEP ${formatZipCode(address.zipCode)}`,
  ]
    .filter(Boolean)
    .join(' · ');
  return {
    ...base,
    name: data.name,
    category: '',
    location: formatCityLine(address) ?? 'Endereço não informado',
    description: data.description ?? '',
    legalName: data.legalName,
    document: formatDocument(data.document),
    phone: branch.phone ? formatPhone(branch.phone) : NOT_INFORMED,
    email: branch.email ?? NOT_INFORMED,
    slug: data.slug,
    address: {
      street: formatStreetLine(address) ?? NOT_INFORMED,
      district: address.neighborhood ?? NOT_INFORMED,
      region: region || NOT_INFORMED,
    },
    hours: weekHours(branch.openingHours),
    channels: [
      {
        key: 'whatsapp',
        label: 'WhatsApp',
        value: branch.whatsapp ? formatPhone(branch.whatsapp) : null,
      },
      { key: 'instagram', label: 'Instagram', value: data.instagram ? `@${data.instagram}` : null },
      { key: 'phone', label: 'Telefone', value: branch.phone ? formatPhone(branch.phone) : null },
      { key: 'menu', label: 'Site / Cardápio', value: `/menu/${data.slug}` },
    ],
    status: data.openNow === null ? null : data.openNow ? 'open' : 'closed',
    demo: { profile: false, address: false, hours: false, channels: false, metrics: false },
  };
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

export interface ShiftDraft {
  opens: string;
  closes: string;
}

export interface DayDraft {
  weekday: number;
  label: string;
  open: boolean;
  // At least one entry, so opening a closed day shows a ready shift to fill in.
  shifts: ShiftDraft[];
}

export interface ProfileDraft {
  name: string;
  legalName: string;
  description: string;
  instagram: string;
  phone: string;
  whatsapp: string;
  email: string;
  address: string;
  number: string;
  complement: string;
  neighborhood: string;
  city: string;
  state: string;
  zipCode: string;
  // false = "hours not informed" (the API stores null and the menu says nothing about them).
  hoursEnabled: boolean;
  days: DayDraft[];
}

export const DEFAULT_SHIFT: ShiftDraft = { opens: '18:00', closes: '23:00' };

export function toProfileDraft(data: RestaurantProfileData): ProfileDraft {
  const { branch } = data;
  const hours = branch.openingHours ?? [];
  return {
    name: data.name,
    legalName: data.legalName,
    description: data.description ?? '',
    instagram: data.instagram ? `@${data.instagram}` : '',
    phone: branch.phone ? formatPhone(branch.phone) : '',
    whatsapp: branch.whatsapp ? formatPhone(branch.whatsapp) : '',
    email: branch.email ?? '',
    address: branch.address ?? '',
    number: branch.number ?? '',
    complement: branch.complement ?? '',
    neighborhood: branch.neighborhood ?? '',
    city: branch.city ?? '',
    state: branch.state ?? '',
    zipCode: branch.zipCode ? formatZipCode(branch.zipCode) : '',
    hoursEnabled: branch.openingHours !== null,
    days: WEEK.map(({ weekday, label }) => {
      const shifts = hours
        .filter((i) => i.weekday === weekday)
        .sort((a, b) => a.opens.localeCompare(b.opens))
        .map(({ opens, closes }) => ({ opens, closes }));
      return {
        weekday,
        label,
        open: shifts.length > 0,
        shifts: shifts.length ? shifts : [{ ...DEFAULT_SHIFT }],
      };
    }),
  };
}

// The week the draft describes, in the API's order (weekday, then opening time).
export function draftIntervals(days: DayDraft[]): OpeningInterval[] {
  return days
    .filter((day) => day.open)
    .flatMap((day) =>
      day.shifts.map((shift) => ({
        weekday: day.weekday,
        opens: shift.opens,
        closes: shift.closes,
      })),
    )
    .sort((a, b) => a.weekday - b.weekday || a.opens.localeCompare(b.opens));
}

const instagramHandle = (raw: string) => raw.trim().replace(/^@/, '');

// First problem found, in form order; null when the draft can be sent.
export function validateProfileDraft(draft: ProfileDraft): string | null {
  const name = draft.name.trim();
  if (name.length < 2 || name.length > 120)
    return 'Informe o nome do restaurante (2 a 120 caracteres).';
  const legalName = draft.legalName.trim();
  if (legalName.length < 2 || legalName.length > 160)
    return 'Informe a razão social (2 a 160 caracteres).';
  if (draft.description.trim().length > MAX_DESCRIPTION)
    return `A descrição aceita até ${MAX_DESCRIPTION} caracteres.`;
  if (draft.phone.trim() && normalizePhone(draft.phone) === null)
    return 'Telefone inválido: informe com DDD.';
  if (draft.whatsapp.trim() && normalizePhone(draft.whatsapp) === null)
    return 'WhatsApp inválido: informe com DDD.';
  if (draft.instagram.trim() && !INSTAGRAM.test(instagramHandle(draft.instagram))) {
    return 'Instagram: informe só o nome da conta (letras, números, ponto e sublinhado).';
  }
  if (draft.email.trim() && !EMAIL.test(draft.email.trim())) return 'Informe um e-mail válido.';
  if (draft.state.trim() && !BRAZILIAN_STATES.includes(draft.state.trim().toUpperCase()))
    return 'UF inválida.';
  if (draft.zipCode.trim() && !ZIP.test(draft.zipCode.trim()))
    return 'CEP inválido: use 8 dígitos.';
  if (draft.hoursEnabled) {
    for (const day of draft.days) {
      if (!day.open) continue;
      if (day.shifts.length > MAX_SHIFTS_PER_DAY)
        return `${day.label}: no máximo ${MAX_SHIFTS_PER_DAY} turnos.`;
      for (const shift of day.shifts) {
        if (!TIME.test(shift.opens) || !TIME.test(shift.closes))
          return `${day.label}: preencha abertura e fechamento.`;
        if (shift.opens === shift.closes)
          return `${day.label}: abertura e fechamento não podem ser iguais.`;
      }
    }
  }
  return null;
}

// Fields as the API stores them, to compare with what came from it. Run after
// validateProfileDraft: a phone that is filled in always normalizes.
const text = (raw: string) => raw.trim() || null;
const phoneDigits = (raw: string) => (raw.trim() ? normalizePhone(raw) : null);

// Only the fields that differ from what the server holds, so an untouched form sends nothing.
export function profileDraftToPatch(
  draft: ProfileDraft,
  data: RestaurantProfileData,
): RestaurantProfilePatch {
  const patch: RestaurantProfilePatch = {};
  const { branch } = data;
  if (draft.name.trim() !== data.name) patch.name = draft.name.trim();
  if (draft.legalName.trim() !== data.legalName) patch.legalName = draft.legalName.trim();
  if (text(draft.description) !== data.description) patch.description = text(draft.description);
  const instagram = text(instagramHandle(draft.instagram));
  if (instagram !== data.instagram) patch.instagram = instagram;
  if (phoneDigits(draft.phone) !== branch.phone) patch.phone = text(draft.phone);
  if (phoneDigits(draft.whatsapp) !== branch.whatsapp) patch.whatsapp = text(draft.whatsapp);
  if ((text(draft.email)?.toLowerCase() ?? null) !== branch.email) patch.email = text(draft.email);
  for (const field of ['address', 'number', 'complement', 'neighborhood', 'city'] as const) {
    if (text(draft[field]) !== branch[field]) patch[field] = text(draft[field]);
  }
  if ((text(draft.state)?.toUpperCase() ?? null) !== branch.state)
    patch.state = text(draft.state)?.toUpperCase() ?? null;
  if ((text(draft.zipCode)?.replace('-', '') ?? null) !== branch.zipCode)
    patch.zipCode = text(draft.zipCode);
  const hours = draft.hoursEnabled ? draftIntervals(draft.days) : null;
  if (JSON.stringify(hours) !== JSON.stringify(branch.openingHours)) patch.openingHours = hours;
  return patch;
}

export function isEmptyPatch(patch: RestaurantProfilePatch): boolean {
  return Object.keys(patch).length === 0;
}
