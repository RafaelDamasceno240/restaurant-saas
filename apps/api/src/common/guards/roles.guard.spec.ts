import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';

function contextWith(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows the request when no roles are required', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(contextWith({ roles: [] }))).toBe(true);
  });

  it('allows a user that has one of the required roles', () => {
    const reflector = { getAllAndOverride: () => ['ADMIN', 'OWNER'] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(contextWith({ roles: ['OWNER'] }))).toBe(true);
  });

  it('rejects a user without any of the required roles', () => {
    const reflector = { getAllAndOverride: () => ['ADMIN'] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(contextWith({ roles: ['WAITER'] }))).toThrow(ForbiddenException);
  });

  it('rejects when there is no authenticated user at all', () => {
    const reflector = { getAllAndOverride: () => ['ADMIN'] } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(() => guard.canActivate(contextWith(undefined))).toThrow(ForbiddenException);
  });
});
