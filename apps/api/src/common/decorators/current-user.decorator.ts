import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedRequestUser } from '../types/authenticated-request-user';

// Pulls the authenticated user (already resolved + tenant-scoped by
// JwtStrategy) off the request. Every module that touches tenant-owned data
// MUST read tenantId from here — never from the request body or query
// string. This is the "centralized tenant context" required by the spec.
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedRequestUser => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user as AuthenticatedRequestUser;
  },
);
