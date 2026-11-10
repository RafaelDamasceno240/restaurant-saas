import type { BadgeTone } from '@/components/ds/Badge';
import type { NewTenantInput, TenantStatus } from './platform-api';

// Pure rules of /super-admin. The API validates everything again (ProvisionTenantDto and the
// provisioning service); what is here only spares the administrator a round trip and suggests.

export const PLATFORM_PAGE_SIZE = 20;
export const PASSWORD_MIN = 8;
export const SUSPENSION_REASON_MIN = 5;
export const SUSPENSION_REASON_MAX = 500;

export const SUSPEND_WARNING =
  'Suspender este restaurante impedirá o uso do sistema pelos usuários deste estabelecimento.';

export const STATUS_LABEL: Record<TenantStatus, string> = {
  ACTIVE: 'Ativo',
  TRIAL: 'Em teste (trial)',
  SUSPENDED: 'Suspenso',
  CANCELLED: 'Cancelado',
};

export const STATUS_TONE: Record<TenantStatus, BadgeTone> = {
  ACTIVE: 'success',
  TRIAL: 'info',
  SUSPENDED: 'danger',
  CANCELLED: 'neutral',
};

export const HISTORY_LABEL: Record<string, string> = {
  TENANT_PROVISIONED: 'Restaurante criado',
  PLATFORM_TENANT_CREATED: 'Criado pelo painel da plataforma',
  PLATFORM_TENANT_SUSPENDED: 'Suspenso',
  PLATFORM_TENANT_REACTIVATED: 'Reativado',
};

// "Restaurante Central" -> "restaurante-central": lower case, no accents, spaces to hyphens,
// anything else dropped, no repeated or edge hyphens. Only a suggestion the administrator edits.
export function suggestSlug(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    // An apostrophe joins the word ("Do’cê" -> "doce"), it does not split it.
    .replace(/['’‘`´]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
    .replace(/-$/, '');
}

export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function documentDigits(value: string): string {
  return value.replace(/\D/g, '');
}

export interface NewTenantDraft extends NewTenantInput {
  passwordConfirmation: string;
}

export const EMPTY_NEW_TENANT: NewTenantDraft = {
  tenantName: '',
  legalName: '',
  document: '',
  slug: '',
  branchName: '',
  userName: '',
  email: '',
  password: '',
  passwordConfirmation: '',
};

export type NewTenantField = keyof NewTenantDraft;

// The form, field by field: label, a short explanation and an example (never a password).
export const NEW_TENANT_FIELDS: { key: Exclude<NewTenantField, 'password' | 'passwordConfirmation'>; label: string; hint: string; example: string }[] = [
  { key: 'tenantName', label: 'Nome do restaurante', hint: 'Nome comercial que aparecerá no sistema.', example: 'Restaurante Central' },
  { key: 'legalName', label: 'Razão social', hint: 'Nome jurídico da empresa.', example: 'Empresa Central LTDA' },
  {
    key: 'document',
    label: 'CNPJ/CPF',
    hint: 'Documento do responsável ou da empresa, somente números (CNPJ 14 dígitos, CPF 11).',
    example: '12345678000199',
  },
  {
    key: 'slug',
    label: 'Slug',
    hint: 'Identificador usado na URL. Sem espaços, acentos ou caracteres especiais: só letras minúsculas, números e hífen.',
    example: 'restaurante-central',
  },
  { key: 'branchName', label: 'Unidade principal', hint: 'Nome da primeira loja/unidade.', example: 'Matriz Centro' },
  { key: 'userName', label: 'Nome do proprietário', hint: 'Nome do usuário OWNER que receberá acesso.', example: 'João da Silva' },
  { key: 'email', label: 'E-mail do proprietário', hint: 'Será usado para entrar no sistema.', example: 'contato@empresa.com.br' },
];

// First problem of each field, in the same words the API would use.
export function validateNewTenant(draft: NewTenantDraft): Partial<Record<NewTenantField, string>> {
  const problems: Partial<Record<NewTenantField, string>> = {};
  const required: [NewTenantField, string][] = [
    ['tenantName', 'Informe o nome do restaurante.'],
    ['legalName', 'Informe a razão social.'],
    ['document', 'Informe o CNPJ ou CPF.'],
    ['slug', 'Informe o slug.'],
    ['branchName', 'Informe a unidade principal.'],
    ['userName', 'Informe o nome do proprietário.'],
    ['email', 'Informe o e-mail do proprietário.'],
    ['password', 'Informe a senha inicial.'],
  ];
  for (const [key, message] of required) {
    if (!draft[key].trim()) problems[key] = message;
  }
  const digits = documentDigits(draft.document);
  if (!problems.document && digits.length !== 11 && digits.length !== 14) {
    problems.document = 'CNPJ com 14 dígitos ou CPF com 11.';
  }
  if (!problems.slug && !SLUG_PATTERN.test(draft.slug.trim())) {
    problems.slug = 'Só letras minúsculas, números e hífen (ex.: restaurante-central).';
  }
  if (!problems.email && !EMAIL_PATTERN.test(draft.email.trim())) problems.email = 'E-mail inválido.';
  if (!problems.password && draft.password.length < PASSWORD_MIN) {
    problems.password = `A senha precisa ter ao menos ${PASSWORD_MIN} caracteres.`;
  }
  if (!problems.password && draft.password !== draft.passwordConfirmation) {
    problems.passwordConfirmation = 'As senhas não conferem.';
  }
  return problems;
}

// What goes to the API: trimmed, the document in digits only, never the confirmation.
export function toNewTenantInput(draft: NewTenantDraft): NewTenantInput {
  return {
    tenantName: draft.tenantName.trim(),
    legalName: draft.legalName.trim(),
    document: documentDigits(draft.document),
    slug: draft.slug.trim(),
    branchName: draft.branchName.trim(),
    userName: draft.userName.trim(),
    email: draft.email.trim(),
    password: draft.password,
  };
}

// The API's answer to a creation, on the field it is about when there is one.
export function newTenantError(code: string | undefined, message: string): { field?: NewTenantField; message: string } {
  switch (code) {
    case 'SLUG_ALREADY_EXISTS':
      return { field: 'slug', message: 'Já existe um restaurante com este slug. Escolha outro.' };
    case 'DOCUMENT_ALREADY_EXISTS':
      return { field: 'document', message: 'Já existe um restaurante com este CNPJ/CPF.' };
    case 'EMAIL_ALREADY_EXISTS':
      return { field: 'email', message: 'Já existe uma conta com este e-mail.' };
    case 'TENANT_ALREADY_EXISTS':
      return { message: 'Já existe um restaurante com este slug ou documento.' };
    default:
      return { message };
  }
}

export function statusActions(status: TenantStatus): { canSuspend: boolean; canReactivate: boolean } {
  return { canSuspend: status === 'ACTIVE' || status === 'TRIAL', canReactivate: status === 'SUSPENDED' };
}

export function validateSuspensionReason(reason: string): string | null {
  const text = reason.trim();
  if (text.length < SUSPENSION_REASON_MIN) return `Escreva o motivo (ao menos ${SUSPENSION_REASON_MIN} caracteres).`;
  if (text.length > SUSPENSION_REASON_MAX) return `O motivo pode ter até ${SUSPENSION_REASON_MAX} caracteres.`;
  return null;
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

export function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// "21–40 de 2.063"
export function pageRangeLabel(meta: { page: number; pageSize: number; total: number }): string {
  if (meta.total === 0) return 'Nenhum restaurante';
  const from = (meta.page - 1) * meta.pageSize + 1;
  const to = Math.min(meta.page * meta.pageSize, meta.total);
  return `${from.toLocaleString('pt-BR')}–${to.toLocaleString('pt-BR')} de ${meta.total.toLocaleString('pt-BR')}`;
}
