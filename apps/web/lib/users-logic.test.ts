import type { StaffUser } from './users-api';
import {
  assignableRoles,
  branchesLabel,
  canManageTeam,
  canManageUser,
  draftToInput,
  draftToPatch,
  EMPTY_DRAFT,
  isEmptyPatch,
  lastLoginLabel,
  ROLE_HINT,
  ROLE_LABEL,
  roleNeedsBranch,
  rolesLabel,
  STATUS_LABEL,
  STATUS_TONE,
  toDraft,
  userErrorMessage,
  validateDraft,
  validatePassword,
} from './users-logic';

const user = (extra: Partial<StaffUser> = {}): StaffUser => ({
  id: 'u1',
  tenantId: 't1',
  name: 'Ana Caixa',
  email: 'ana@example.com',
  status: 'ACTIVE',
  lastLoginAt: null,
  createdAt: '2026-10-10T12:00:00.000Z',
  roles: ['CASHIER'],
  branchIds: ['b1'],
  ...extra,
});

const owner = { id: 'owner', roles: ['OWNER'] };
const admin = { id: 'admin', roles: ['ADMIN'] };
const manager = { id: 'manager', roles: ['MANAGER'] };

describe('users-logic', () => {
  it('labels every role and status', () => {
    for (const role of ['OWNER', 'ADMIN', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN', 'DELIVERY', 'VIEWER'] as const) {
      expect(ROLE_LABEL[role]).toBeTruthy();
      expect(ROLE_HINT[role]).toBeTruthy();
    }
    for (const status of ['ACTIVE', 'INACTIVE', 'BLOCKED', 'INVITED'] as const) {
      expect(STATUS_LABEL[status]).toBeTruthy();
      expect(STATUS_TONE[status]).toBeTruthy();
    }
  });

  describe('assignableRoles', () => {
    it('lets the owner hand out everything but owner', () => {
      expect(assignableRoles(['OWNER'])).toEqual(['ADMIN', 'MANAGER', 'CASHIER', 'WAITER', 'KITCHEN', 'DELIVERY', 'VIEWER']);
    });
    it('keeps administrator out of what an administrator hands out', () => {
      expect(assignableRoles(['ADMIN'])).toEqual(['MANAGER', 'CASHIER', 'WAITER', 'KITCHEN', 'DELIVERY', 'VIEWER']);
    });
    it('gives nothing to the other roles', () => {
      expect(assignableRoles(['MANAGER'])).toEqual([]);
      expect(assignableRoles([])).toEqual([]);
    });
  });

  describe('canManageUser', () => {
    it('is only for owner and administrator', () => {
      expect(canManageTeam(['OWNER'])).toBe(true);
      expect(canManageTeam(['ADMIN'])).toBe(true);
      expect(canManageTeam(['MANAGER'])).toBe(false);
      expect(canManageUser(manager, user())).toBe(false);
    });
    it('never offers your own account or the owner', () => {
      expect(canManageUser(owner, user({ id: 'owner', roles: ['OWNER'] }))).toBe(false);
      expect(canManageUser(admin, user({ id: 'admin', roles: ['ADMIN'] }))).toBe(false);
      expect(canManageUser(admin, user({ id: 'owner', roles: ['OWNER'] }))).toBe(false);
    });
    it('leaves administrators to the owner', () => {
      const otherAdmin = user({ id: 'a2', roles: ['ADMIN'] });
      expect(canManageUser(owner, otherAdmin)).toBe(true);
      expect(canManageUser(admin, otherAdmin)).toBe(false);
    });
    it('lets owner and administrator manage the rest', () => {
      expect(canManageUser(owner, user())).toBe(true);
      expect(canManageUser(admin, user({ roles: ['WAITER'] }))).toBe(true);
      expect(canManageUser(admin, user({ roles: [] }))).toBe(true);
    });
  });

  describe('labels', () => {
    const branches = [
      { id: 'b1', name: 'Matriz' },
      { id: 'b2', name: 'Filial' },
    ];
    it('names the roles, or says there is none', () => {
      expect(rolesLabel(user())).toBe('Caixa');
      expect(rolesLabel(user({ roles: [] }))).toBe('Sem papel');
    });
    it('shows "Todas" for tenant-wide roles and the names for the others', () => {
      expect(roleNeedsBranch('ADMIN')).toBe(false);
      expect(roleNeedsBranch('CASHIER')).toBe(true);
      expect(branchesLabel(user({ roles: ['ADMIN'], branchIds: [] }), branches)).toBe('Todas');
      expect(branchesLabel(user({ branchIds: ['b1', 'b2'] }), branches)).toBe('Matriz, Filial');
      expect(branchesLabel(user({ branchIds: [] }), branches)).toBe('Nenhuma');
    });
    it('says when someone never signed in', () => {
      expect(lastLoginLabel(null)).toBe('Nunca entrou');
      expect(lastLoginLabel('2026-10-10T12:00:00.000Z')).toMatch(/10\/10\/2026/);
    });
  });

  describe('validateDraft', () => {
    const valid = { name: 'Ana Caixa', email: 'ana@example.com', password: 'Sup3rSecret!', role: 'CASHIER' as const, branchIds: [] };

    it('accepts a complete new account in a single-branch restaurant', () => {
      expect(validateDraft(valid, 'create', 1)).toBeNull();
    });
    it('asks for name, e-mail, password and role, in that order', () => {
      expect(validateDraft(EMPTY_DRAFT, 'create', 1)).toMatch(/nome/);
      expect(validateDraft({ ...valid, email: 'ana@' }, 'create', 1)).toMatch(/e-mail/);
      expect(validateDraft({ ...valid, password: '1234567' }, 'create', 1)).toMatch(/8 caracteres/);
      expect(validateDraft({ ...valid, role: '' }, 'create', 1)).toMatch(/papel/);
    });
    it('asks for a branch only when there is a choice and the role needs one', () => {
      expect(validateDraft(valid, 'create', 2)).toMatch(/unidade/);
      expect(validateDraft({ ...valid, branchIds: ['b2'] }, 'create', 2)).toBeNull();
      expect(validateDraft({ ...valid, role: 'ADMIN' }, 'create', 2)).toBeNull();
    });
    it('does not ask for e-mail or password when editing', () => {
      expect(validateDraft({ ...valid, email: '', password: '' }, 'edit', 1)).toBeNull();
    });
    it('bounds the password length', () => {
      expect(validatePassword('12345678')).toBeNull();
      expect(validatePassword('x'.repeat(129))).toMatch(/máximo/);
    });
  });

  describe('draftToInput', () => {
    const draft = { name: '  Ana Caixa ', email: ' ana@example.com ', password: ' com espaço ', role: 'CASHIER' as const, branchIds: ['b2'] };

    it('trims name and e-mail, never the password, and omits the branch when there is only one', () => {
      expect(draftToInput(draft, 1)).toEqual({
        name: 'Ana Caixa',
        email: 'ana@example.com',
        password: ' com espaço ',
        role: 'CASHIER',
      });
    });
    it('sends the chosen branches when there are several', () => {
      expect(draftToInput(draft, 2).branchIds).toEqual(['b2']);
      expect(draftToInput({ ...draft, role: 'ADMIN' }, 2).branchIds).toBeUndefined();
    });
  });

  describe('draftToPatch', () => {
    it('is empty when nothing changed', () => {
      const current = user({ branchIds: ['b1', 'b2'] });
      const patch = draftToPatch({ ...toDraft(current), branchIds: ['b2', 'b1'] }, current, 2);
      expect(isEmptyPatch(patch)).toBe(true);
    });
    it('carries only what changed', () => {
      const current = user();
      expect(draftToPatch({ ...toDraft(current), name: 'Ana Maria' }, current, 2)).toEqual({ name: 'Ana Maria' });
      expect(draftToPatch({ ...toDraft(current), role: 'WAITER' }, current, 2)).toEqual({ role: 'WAITER' });
      expect(draftToPatch({ ...toDraft(current), branchIds: ['b2'] }, current, 2)).toEqual({ branchIds: ['b2'] });
    });
    it('never sends e-mail or password', () => {
      const current = user();
      const patch = draftToPatch({ ...toDraft(current), email: 'outro@example.com', password: 'Sup3rSecret!' }, current, 1);
      expect(isEmptyPatch(patch)).toBe(true);
    });
  });

  it('translates the API error codes and keeps the fallback for the rest', () => {
    expect(userErrorMessage('EMAIL_ALREADY_EXISTS', 'x')).toMatch(/e-mail/);
    expect(userErrorMessage('ROLE_NOT_ASSIGNABLE', 'x')).toMatch(/papel/);
    expect(userErrorMessage('USER_PROTECTED', 'x')).toMatch(/conta/);
    expect(userErrorMessage('BRANCHES_REQUIRED', 'x')).toMatch(/unidade/);
    expect(userErrorMessage('INVALID_CURRENT_PASSWORD', 'x')).toMatch(/atual/);
    expect(userErrorMessage('PASSWORD_UNCHANGED', 'x')).toMatch(/diferente/);
    expect(userErrorMessage(undefined, 'padrão')).toBe('padrão');
    expect(userErrorMessage('OUTRO', 'padrão')).toBe('padrão');
  });
});
