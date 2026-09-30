import { RoleName } from '@prisma/client';

// Single source of truth for "this user may operate every branch of the tenant":
// OWNER and ADMIN. Everyone else needs an explicit UserBranch link. Used by
// BranchAccessService (for the caller) and by the delivery module (to decide whether a
// prospective courier can work a given branch).
export function hasTenantWideRole(roles: readonly RoleName[]): boolean {
  return roles.includes('OWNER') || roles.includes('ADMIN');
}
