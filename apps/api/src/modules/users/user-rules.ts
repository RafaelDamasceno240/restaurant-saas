import { RoleName } from '@prisma/client';
import { hasTenantWideRole } from '../branches/tenant-wide-role';

// Roles a staff account can be given through the users API. OWNER is never assignable: the
// owner is whoever registered the restaurant.
export const ASSIGNABLE_ROLES = [
  'ADMIN',
  'MANAGER',
  'CASHIER',
  'WAITER',
  'KITCHEN',
  'DELIVERY',
  'VIEWER',
] as const satisfies readonly RoleName[];

export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

// Who may hand out a role. `users.create`/`users.update` (OWNER and ADMIN in the seed) is the
// baseline, checked by the controller; on top of it only the OWNER makes someone an ADMIN, so
// an ADMIN can never mint a peer.
export function canAssignRole(actorRoles: readonly RoleName[], role: RoleName): boolean {
  if (role === 'OWNER') return false;
  if (role === 'ADMIN') return actorRoles.includes('OWNER');
  return true;
}

// Who may change an existing account (name, role, branches, status, password). The OWNER's
// account is never changed by someone else; an ADMIN's only by the OWNER.
export function canManageUser(actorRoles: readonly RoleName[], targetRoles: readonly RoleName[]): boolean {
  if (targetRoles.includes('OWNER')) return false;
  if (targetRoles.includes('ADMIN')) return actorRoles.includes('OWNER');
  return true;
}

// Everyone but OWNER/ADMIN only operates the branches they are linked to (BranchAccessService),
// so an account with one of those roles and no branch could log in and do nothing.
export function roleNeedsBranch(role: RoleName): boolean {
  return !hasTenantWideRole([role]);
}
