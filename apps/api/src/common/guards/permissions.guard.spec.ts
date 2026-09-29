import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PermissionsGuard } from './permissions.guard';

function contextWith(user: unknown): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('PermissionsGuard', () => {
  it('allows the request when no permissions are required', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);
    expect(guard.canActivate(contextWith({ permissions: [] }))).toBe(true);
  });

  it('requires every listed permission to be present', () => {
    const reflector = {
      getAllAndOverride: () => ['users.read', 'users.update'],
    } as unknown as Reflector;
    const guard = new PermissionsGuard(reflector);

    expect(
      guard.canActivate(contextWith({ permissions: ['users.read', 'users.update'] })),
    ).toBe(true);

    expect(() =>
      guard.canActivate(contextWith({ permissions: ['users.read'] })),
    ).toThrow(ForbiddenException);
  });
});
