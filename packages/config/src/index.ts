// Shared, non-secret constants. Actual env parsing/validation lives in
// apps/api/src/config (backend) and apps/web/lib (frontend) because the two
// apps have different required variables.

export const ROLE_NAMES = [
  'OWNER',
  'ADMIN',
  'MANAGER',
  'CASHIER',
  'WAITER',
  'KITCHEN',
  'DELIVERY',
  'VIEWER',
] as const;

export const ACCESS_TOKEN_HEADER = 'authorization';
export const REFRESH_TOKEN_COOKIE = 'refresh_token';
