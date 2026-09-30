import type { BadgeTone } from '@/components/ds/Badge';
import type { CustomerInput, CustomerRecord, CustomerStatusFilter } from './customers-api';

// Presentation and form rules for the customers screen. The API is the authority (it
// normalizes and validates again); these only give fast feedback and readable output.

export const CUSTOMER_TABS: CustomerStatusFilter[] = ['active', 'inactive', 'all'];

export const CUSTOMER_TAB_LABEL: Record<CustomerStatusFilter, string> = {
  active: 'Ativos',
  inactive: 'Inativos',
  all: 'Todos',
};

export const MAX_NOTES = 500;

// Same rule as the API: digits only; a Brazilian number typed with the country code
// (12 or 13 digits starting with 55) is reduced to the national number.
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2);
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

// "11987654321" -> "(11) 98765-4321"; "1134567890" -> "(11) 3456-7890". Anything that is
// not a 10/11 digit national number is shown as stored.
export function formatPhone(phone: string): string {
  if (/^\d{11}$/.test(phone)) return `(${phone.slice(0, 2)}) ${phone.slice(2, 7)}-${phone.slice(7)}`;
  if (/^\d{10}$/.test(phone)) return `(${phone.slice(0, 2)}) ${phone.slice(2, 6)}-${phone.slice(6)}`;
  return phone;
}

export function isValidCpf(raw: string): boolean {
  const digits = raw.replace(/\D/g, '');
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  const check = (length: number) => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(digits[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

export function formatCpf(cpf: string): string {
  return /^\d{11}$/.test(cpf) ? `${cpf.slice(0, 3)}.${cpf.slice(3, 6)}.${cpf.slice(6, 9)}-${cpf.slice(9)}` : cpf;
}

export interface CustomerDraft {
  name: string;
  phone: string;
  email: string;
  cpf: string;
  notes: string;
}

export const EMPTY_DRAFT: CustomerDraft = { name: '', phone: '', email: '', cpf: '', notes: '' };

export function toDraft(customer: CustomerRecord): CustomerDraft {
  return {
    name: customer.name,
    phone: formatPhone(customer.phone),
    email: customer.email ?? '',
    cpf: customer.cpf ? formatCpf(customer.cpf) : '',
    notes: customer.notes ?? '',
  };
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// First problem found, in form order; null when the draft can be submitted.
export function validateDraft(draft: CustomerDraft): string | null {
  if (draft.name.trim().length < 2) return 'Informe o nome do cliente (mínimo 2 caracteres).';
  if (normalizePhone(draft.phone) === null) return 'Informe um telefone válido (8 a 15 dígitos).';
  if (draft.email.trim() !== '' && !EMAIL.test(draft.email.trim())) return 'Informe um e-mail válido.';
  if (draft.cpf.trim() !== '' && !isValidCpf(draft.cpf)) return 'CPF inválido.';
  if (draft.notes.length > MAX_NOTES) return `As observações aceitam até ${MAX_NOTES} caracteres.`;
  return null;
}

// Creating sends only what was filled in. Editing sends ONLY the fields that changed, so an
// untouched customer produces an empty patch (nothing to save) and a cleared optional field
// is sent as null.
export function draftToInput(draft: CustomerDraft): CustomerInput {
  const input: CustomerInput = { name: draft.name.trim(), phone: draft.phone.trim() };
  if (draft.email.trim()) input.email = draft.email.trim();
  if (draft.cpf.trim()) input.cpf = draft.cpf.trim();
  if (draft.notes.trim()) input.notes = draft.notes.trim();
  return input;
}

export function draftToPatch(draft: CustomerDraft, original: CustomerRecord): CustomerInput {
  const patch: CustomerInput = {};
  if (draft.name.trim() !== original.name) patch.name = draft.name.trim();
  if (normalizePhone(draft.phone) !== original.phone) patch.phone = draft.phone.trim();
  if (draft.email.trim().toLowerCase() !== (original.email ?? '')) patch.email = draft.email.trim() || null;
  const cpfDigits = draft.cpf.replace(/\D/g, '');
  if (cpfDigits !== (original.cpf ?? '')) patch.cpf = draft.cpf.trim() || null;
  if (draft.notes.trim() !== (original.notes ?? '')) patch.notes = draft.notes.trim() || null;
  return patch;
}

export function isEmptyPatch(patch: CustomerInput): boolean {
  return Object.keys(patch).length === 0;
}

// Friendly text for the API error codes of this screen; unknown codes keep the API message.
export function customerErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'CUSTOMER_PHONE_TAKEN':
      return 'Já existe um cliente ativo com este telefone.';
    case 'CUSTOMER_CPF_TAKEN':
      return 'Já existe um cliente com este CPF.';
    case 'CUSTOMER_NOT_FOUND':
      return 'Cliente não encontrado. Atualize a lista.';
    default:
      return fallback;
  }
}

// "Sem pedidos" instead of an invented date.
export function lastOrderLabel(iso: string | null): string {
  if (!iso) return 'Sem pedidos';
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export const CUSTOMER_STATUS_TONE: Record<'active' | 'inactive', BadgeTone> = { active: 'success', inactive: 'neutral' };

// When the list must tell "no customers yet" from "nothing matches the filters".
export function isFiltering(search: string, status: CustomerStatusFilter): boolean {
  return search.trim() !== '' || status !== 'active';
}
