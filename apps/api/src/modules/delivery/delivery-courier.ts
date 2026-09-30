import { Prisma, RoleName } from '@prisma/client';
import { hasTenantWideRole } from '../branches/tenant-wide-role';

export type CourierIneligibleReason = 'INACTIVE' | 'NOT_COURIER' | 'NO_BRANCH_ACCESS';

export interface CourierCandidate {
  status: string;
  roles: readonly RoleName[];
  branchIds: readonly string[];
}

// Who may be assigned to a delivery of `branchId`. The candidate was already found INSIDE
// the caller's tenant (another tenant's user is "not found", never reaches this check).
// Order matters only for the reported reason: an inactive user is reported as inactive
// even if it also lacks the role.
export function courierIneligibleReason(candidate: CourierCandidate, branchId: string): CourierIneligibleReason | null {
  if (candidate.status !== 'ACTIVE') return 'INACTIVE';
  if (!candidate.roles.includes('DELIVERY')) return 'NOT_COURIER';
  if (!hasTenantWideRole(candidate.roles) && !candidate.branchIds.includes(branchId)) return 'NO_BRANCH_ACCESS';
  return null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const COURIER_FILTER_PATTERN = /^(me|none|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i;

// `courier` query value: "me" (the caller), "none" (unassigned) or a courier's user id.
// The tenant scope is applied by the caller of this helper, so an id from another tenant
// simply matches nothing.
export function courierWhere(filter: string | undefined, callerUserId: string): Prisma.DeliveryWhereInput {
  if (!filter) return {};
  const value = filter.toLowerCase();
  if (value === 'me') return { courierUserId: callerUserId };
  if (value === 'none') return { courierUserId: null };
  return UUID.test(filter) ? { courierUserId: filter } : {};
}
