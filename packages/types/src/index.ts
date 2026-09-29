// Shared types consumed by both `api` and `web`.
// Kept intentionally small in Phase 1: only the foundation entities exist.

export type TenantStatus = 'ACTIVE' | 'SUSPENDED' | 'TRIAL' | 'CANCELLED';
export type UserStatus = 'ACTIVE' | 'INACTIVE' | 'BLOCKED' | 'INVITED';
export type BranchStatus = 'ACTIVE' | 'INACTIVE';

export type RoleName =
  | 'OWNER'
  | 'ADMIN'
  | 'MANAGER'
  | 'CASHIER'
  | 'WAITER'
  | 'KITCHEN'
  | 'DELIVERY'
  | 'VIEWER';

export interface TenantDto {
  id: string;
  name: string;
  legalName: string;
  document: string;
  slug: string;
  status: TenantStatus;
  createdAt: string;
  updatedAt: string;
}

export interface BranchDto {
  id: string;
  tenantId: string;
  name: string;
  code: string;
  status: BranchStatus;
}

export interface AuthenticatedUserDto {
  id: string;
  tenantId: string;
  name: string;
  email: string;
  status: UserStatus;
  roles: RoleName[];
}

export interface LoginResponseDto {
  accessToken: string;
  expiresIn: number;
  user: AuthenticatedUserDto;
}
