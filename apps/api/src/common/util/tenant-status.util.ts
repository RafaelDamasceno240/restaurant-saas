import { TenantStatus } from '@prisma/client';

const BLOCKED_STATUSES: TenantStatus[] = ['SUSPENDED', 'CANCELLED'];

export function isTenantBlocked(status: TenantStatus): boolean {
  return BLOCKED_STATUSES.includes(status);
}
