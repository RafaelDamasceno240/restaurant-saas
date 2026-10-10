import { RoleName } from '@prisma/client';
import { ASSIGNABLE_ROLES, canAssignRole, canManageUser, roleNeedsBranch } from './user-rules';

describe('user rules', () => {
  describe('ASSIGNABLE_ROLES', () => {
    it('offers every role except OWNER', () => {
      const all = Object.values(RoleName);
      expect([...ASSIGNABLE_ROLES].sort()).toEqual(all.filter((role) => role !== 'OWNER').sort());
    });
  });

  describe('canAssignRole', () => {
    it('never lets anyone hand out OWNER', () => {
      expect(canAssignRole(['OWNER'], 'OWNER')).toBe(false);
      expect(canAssignRole(['ADMIN'], 'OWNER')).toBe(false);
    });

    it('lets only the OWNER make an ADMIN', () => {
      expect(canAssignRole(['OWNER'], 'ADMIN')).toBe(true);
      expect(canAssignRole(['ADMIN'], 'ADMIN')).toBe(false);
      expect(canAssignRole(['MANAGER'], 'ADMIN')).toBe(false);
    });

    it('lets OWNER and ADMIN hand out the operational roles', () => {
      for (const role of ['MANAGER', 'CASHIER', 'WAITER', 'KITCHEN', 'DELIVERY', 'VIEWER'] as RoleName[]) {
        expect(canAssignRole(['OWNER'], role)).toBe(true);
        expect(canAssignRole(['ADMIN'], role)).toBe(true);
      }
    });
  });

  describe('canManageUser', () => {
    it('protects the OWNER account from everyone, the OWNER included', () => {
      expect(canManageUser(['OWNER'], ['OWNER'])).toBe(false);
      expect(canManageUser(['ADMIN'], ['OWNER'])).toBe(false);
    });

    it('lets only the OWNER change an ADMIN', () => {
      expect(canManageUser(['OWNER'], ['ADMIN'])).toBe(true);
      expect(canManageUser(['ADMIN'], ['ADMIN'])).toBe(false);
    });

    it('treats an account that is also an ADMIN as an ADMIN', () => {
      expect(canManageUser(['ADMIN'], ['CASHIER', 'ADMIN'])).toBe(false);
    });

    it('lets OWNER and ADMIN change the other staff, including an account with no role', () => {
      expect(canManageUser(['OWNER'], ['CASHIER'])).toBe(true);
      expect(canManageUser(['ADMIN'], ['MANAGER'])).toBe(true);
      expect(canManageUser(['ADMIN'], [])).toBe(true);
    });
  });

  describe('roleNeedsBranch', () => {
    it('is false only for the tenant-wide roles', () => {
      expect(roleNeedsBranch('OWNER')).toBe(false);
      expect(roleNeedsBranch('ADMIN')).toBe(false);
      for (const role of ['MANAGER', 'CASHIER', 'WAITER', 'KITCHEN', 'DELIVERY', 'VIEWER'] as RoleName[]) {
        expect(roleNeedsBranch(role)).toBe(true);
      }
    });
  });
});
