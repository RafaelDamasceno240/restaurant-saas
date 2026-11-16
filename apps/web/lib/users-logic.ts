import type { BadgeTone } from '@/components/ds/Badge';
import type { CreateUserInput, StaffRole, StaffUser, UpdateUserInput, UserStatus } from './users-api';

// The API decides everything here (users.* permissions and apps/api user-rules.ts); these
// mirrors only keep the screen from offering what would be refused.

export const ROLE_LABEL: Record<StaffRole, string> = {
  OWNER: 'Proprietário',
  ADMIN: 'Administrador',
  MANAGER: 'Gerente',
  CASHIER: 'Caixa',
  WAITER: 'Garçom',
  KITCHEN: 'Cozinha',
  DELIVERY: 'Entregador',
  VIEWER: 'Somente leitura',
};

export const ROLE_HINT: Record<StaffRole, string> = {
  OWNER: 'Quem cadastrou o restaurante. Acesso total.',
  ADMIN: 'Acesso total, em todas as unidades, incluindo a equipe.',
  MANAGER: 'Opera e gerencia as unidades em que trabalha. Não altera a equipe.',
  CASHIER: 'PDV, caixa, clientes e recebimentos.',
  WAITER: 'Mesas, comandas e pedidos.',
  KITCHEN: 'Tela da cozinha e andamento dos pedidos.',
  DELIVERY: 'Entregas atribuídas.',
  VIEWER: 'Só consulta cardápio, pedidos e mesas.',
};

export const STATUS_LABEL: Record<UserStatus, string> = {
  ACTIVE: 'Ativo',
  INACTIVE: 'Inativo',
  BLOCKED: 'Bloqueado',
  INVITED: 'Convidado',
};

export const STATUS_TONE: Record<UserStatus, BadgeTone> = {
  ACTIVE: 'success',
  INACTIVE: 'neutral',
  BLOCKED: 'danger',
  INVITED: 'info',
};

const OPERATIONAL_ROLES: StaffRole[] = ['MANAGER', 'CASHIER', 'WAITER', 'KITCHEN', 'DELIVERY', 'VIEWER'];

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 128;

// Only the owner makes someone an administrator; nobody hands out "owner".
export function assignableRoles(actorRoles: readonly string[]): StaffRole[] {
  if (actorRoles.includes('OWNER')) return ['ADMIN', ...OPERATIONAL_ROLES];
  if (actorRoles.includes('ADMIN')) return OPERATIONAL_ROLES;
  return [];
}

export function canManageTeam(actorRoles: readonly string[]): boolean {
  return actorRoles.includes('OWNER') || actorRoles.includes('ADMIN');
}

// Never yourself, never the owner, and an administrator only by the owner.
export function canManageUser(actor: { id: string; roles: readonly string[] }, target: StaffUser): boolean {
  if (!canManageTeam(actor.roles) || target.id === actor.id) return false;
  if (target.roles.includes('OWNER')) return false;
  if (target.roles.includes('ADMIN')) return actor.roles.includes('OWNER');
  return true;
}

// Owner and administrator work every branch; everyone else only the ones they are linked to.
export function roleNeedsBranch(role: StaffRole): boolean {
  return role !== 'OWNER' && role !== 'ADMIN';
}

export function primaryRole(user: StaffUser): StaffRole | null {
  return user.roles[0] ?? null;
}

export function rolesLabel(user: StaffUser): string {
  return user.roles.length === 0 ? 'Sem papel' : user.roles.map((role) => ROLE_LABEL[role] ?? role).join(', ');
}

export function branchesLabel(user: StaffUser, branches: readonly { id: string; name: string }[]): string {
  const role = primaryRole(user);
  if (role && !roleNeedsBranch(role)) return 'Todas';
  const names = branches.filter((branch) => user.branchIds.includes(branch.id)).map((branch) => branch.name);
  return names.length === 0 ? 'Nenhuma' : names.join(', ');
}

export interface UserDraft {
  name: string;
  email: string;
  password: string;
  role: StaffRole | '';
  branchIds: string[];
}

export const EMPTY_DRAFT: UserDraft = { name: '', email: '', password: '', role: '', branchIds: [] };

export function toDraft(user: StaffUser): UserDraft {
  return { name: user.name, email: user.email, password: '', role: primaryRole(user) ?? '', branchIds: [...user.branchIds] };
}

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN) return `A senha precisa ter ao menos ${PASSWORD_MIN} caracteres.`;
  if (password.length > PASSWORD_MAX) return `A senha pode ter no máximo ${PASSWORD_MAX} caracteres.`;
  return null;
}

// `branchCount` is how many branches the restaurant has: with a single one the API picks it.
export function validateDraft(draft: UserDraft, mode: 'create' | 'edit', branchCount: number): string | null {
  if (draft.name.trim().length < 2) return 'Informe o nome (ao menos 2 letras).';
  if (mode === 'create') {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.email.trim())) return 'Informe um e-mail válido.';
    const passwordProblem = validatePassword(draft.password);
    if (passwordProblem) return passwordProblem;
  }
  if (!draft.role) return 'Escolha o papel.';
  if (roleNeedsBranch(draft.role) && branchCount > 1 && draft.branchIds.length === 0) {
    return 'Escolha ao menos uma unidade.';
  }
  return null;
}

// Branches are only sent when there is a choice to make.
function branchIdsToSend(draft: UserDraft, branchCount: number): string[] | undefined {
  if (!draft.role || !roleNeedsBranch(draft.role) || branchCount <= 1) return undefined;
  return draft.branchIds;
}

export function draftToInput(draft: UserDraft, branchCount: number): CreateUserInput {
  const branchIds = branchIdsToSend(draft, branchCount);
  return {
    name: draft.name.trim(),
    email: draft.email.trim(),
    password: draft.password,
    role: draft.role as StaffRole,
    ...(branchIds ? { branchIds } : {}),
  };
}

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((id) => b.includes(id));

export function draftToPatch(draft: UserDraft, user: StaffUser, branchCount: number): UpdateUserInput {
  const patch: UpdateUserInput = {};
  const name = draft.name.trim();
  if (name !== user.name) patch.name = name;
  if (draft.role && draft.role !== primaryRole(user)) patch.role = draft.role;
  const branchIds = branchIdsToSend(draft, branchCount);
  if (branchIds && !sameSet(branchIds, user.branchIds)) patch.branchIds = branchIds;
  return patch;
}

export function isEmptyPatch(patch: UpdateUserInput): boolean {
  return Object.keys(patch).length === 0;
}

export function userErrorMessage(code: string | undefined, fallback: string): string {
  switch (code) {
    case 'EMAIL_ALREADY_EXISTS':
      return 'Já existe uma conta com este e-mail.';
    case 'ROLE_NOT_ASSIGNABLE':
      return 'Você não pode atribuir este papel.';
    case 'USER_PROTECTED':
      return 'Você não pode alterar esta conta.';
    case 'CANNOT_MANAGE_SELF':
      return 'Você não pode alterar a própria conta por aqui.';
    case 'BRANCHES_REQUIRED':
      return 'Escolha ao menos uma unidade para este funcionário.';
    case 'BRANCH_NOT_FOUND':
      return 'Unidade não encontrada. Atualize a página.';
    case 'NOT_FOUND':
      return 'Usuário não encontrado. Atualize a lista.';
    case 'INVALID_CURRENT_PASSWORD':
      return 'Senha atual incorreta.';
    case 'PASSWORD_UNCHANGED':
      return 'A nova senha precisa ser diferente da atual.';
    case 'FORBIDDEN':
      return 'Você não tem permissão para isso.';
    default:
      return fallback;
  }
}

export function lastLoginLabel(iso: string | null): string {
  if (!iso) return 'Nunca entrou';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}
