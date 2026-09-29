import { RoleName } from '@prisma/client';

// Shape attached to `req.user` by JwtStrategy after validating the access
// token. This is the single source of truth for "who is making this request
// and which tenant do they belong to" throughout the API.
export interface AuthenticatedRequestUser {
  userId: string;
  tenantId: string;
  email: string;
  roles: RoleName[];
  permissions: string[];
}
