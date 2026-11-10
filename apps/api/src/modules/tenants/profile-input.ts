// Pure normalization of the restaurant profile fields. Shared by the DTO validators and the
// service, like customers/customer-input.ts (whose phone rule is reused here as is).

export { normalizePhone, PHONE_INPUT_PATTERN } from '../customers/customer-input';

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
] as const;

// "@doce.burger" and "doce.burger" are the same account; stored without the "@". Instagram
// handles are letters, digits, dots and underscores, up to 30 characters.
export function normalizeInstagram(raw: string): string | null {
  const handle = raw.trim().replace(/^@/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(handle) ? handle : null;
}

// "01310-100" -> "01310100".
export function normalizeZipCode(raw: string): string | null {
  const trimmed = raw.trim();
  return /^\d{5}-?\d{3}$/.test(trimmed) ? trimmed.replace('-', '') : null;
}

export function normalizeState(raw: string): string | null {
  const state = raw.trim().toUpperCase();
  return (BRAZILIAN_STATES as readonly string[]).includes(state) ? state : null;
}
