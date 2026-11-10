import { readFileSync } from 'fs';
import { join } from 'path';
import { PERMISSIONS, ROLE_PERMISSIONS, hasPermission } from './permissions';

// B12: lib/permissions.ts is a copy of the API's seed. If the seed changes and this copy does not,
// screens would show (or hide) things the API decides otherwise: this test fails first.
const seed = readFileSync(join(__dirname, '../../api/prisma/seed.ts'), 'utf8');
const quoted = (text: string) => [...text.replace(/\/\/.*$/gm, '').matchAll(/'([a-z.]+)'/g)].map((m) => m[1]);

describe('permissions mirror the API seed (B12)', () => {
  it('same permission list', () => {
    const list = seed.match(/const PERMISSIONS: string\[\] = \[([\s\S]*?)\];/)![1];
    expect([...PERMISSIONS]).toEqual(quoted(list));
  });

  it('same permissions for every role', () => {
    const block = seed.match(/const ROLE_PERMISSIONS: Record<RoleName, string\[\]> = \{([\s\S]*?)\n\};/)![1];
    const roles = [...block.matchAll(/\n {2}([A-Z]+): (PERMISSIONS|\[([\s\S]*?)\]),/g)];
    expect(roles.map((m) => m[1])).toEqual(Object.keys(ROLE_PERMISSIONS));
    for (const [, role, all, list] of roles) {
      expect([...ROLE_PERMISSIONS[role]]).toEqual(all === 'PERMISSIONS' ? [...PERMISSIONS] : quoted(list));
    }
  });

  it('hasPermission: any of the roles is enough; unknown roles and no roles have nothing', () => {
    expect(hasPermission(['KITCHEN'], 'products.read')).toBe(false);
    expect(hasPermission(['KITCHEN', 'CASHIER'], 'products.read')).toBe(true);
    expect(hasPermission(['MANAGER'], 'products.delete')).toBe(false);
    expect(hasPermission(['OWNER'], 'products.delete')).toBe(true);
    expect(hasPermission(['NOPE'], 'orders.read')).toBe(false);
    expect(hasPermission(undefined, 'orders.read')).toBe(false);
  });
});
