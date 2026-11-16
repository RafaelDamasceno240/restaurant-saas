import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PlatformAdminGuard } from './platform-admin.guard';

function contextWith(user: unknown): ExecutionContext {
  return { switchToHttp: () => ({ getRequest: () => ({ user }) }) } as unknown as ExecutionContext;
}

function guardWith(grants: Record<string, { user: { status: string } }>) {
  const findUnique = jest.fn(
    async ({ where }: { where: { userId: string } }) => grants[where.userId] ?? null,
  );
  const prisma = { platformAdmin: { findUnique } } as unknown as PrismaService;
  return { guard: new PlatformAdminGuard(prisma), findUnique };
}

const owner = {
  userId: 'u-owner',
  tenantId: 't1',
  email: 'o@x.com',
  roles: ['OWNER'],
  permissions: ['*'],
};

describe('PlatformAdminGuard', () => {
  it('lets an active platform administrator through, whatever their role in their own restaurant', async () => {
    const { guard } = guardWith({ 'u-cashier': { user: { status: 'ACTIVE' } } });
    const cashier = { ...owner, userId: 'u-cashier', roles: ['CASHIER'], permissions: [] };
    await expect(guard.canActivate(contextWith(cashier))).resolves.toBe(true);
  });

  it('refuses OWNER and ADMIN: administering a restaurant is not administering the platform', async () => {
    const { guard, findUnique } = guardWith({});
    await expect(guard.canActivate(contextWith(owner))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(contextWith({ ...owner, roles: ['ADMIN'] }))).rejects.toThrow(
      'Acesso restrito à administração da plataforma.',
    );
    // The decision is the table, read for this user, not anything the token says.
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: 'u-owner' } }),
    );
  });

  it('refuses a grant whose account is no longer active, and a request without a user', async () => {
    const { guard } = guardWith({ 'u-owner': { user: { status: 'INACTIVE' } } });
    await expect(guard.canActivate(contextWith(owner))).rejects.toBeInstanceOf(ForbiddenException);
    await expect(guard.canActivate(contextWith(undefined))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });
});
