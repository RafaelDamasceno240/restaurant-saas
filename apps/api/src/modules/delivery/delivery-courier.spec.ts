import { courierIneligibleReason, courierWhere, COURIER_FILTER_PATTERN } from './delivery-courier';

const BRANCH = 'b1';
const ok = { status: 'ACTIVE', roles: ['DELIVERY'] as const, branchIds: [BRANCH] };

describe('courierIneligibleReason', () => {
  it('accepts an active DELIVERY user linked to the branch', () => {
    expect(courierIneligibleReason({ ...ok, roles: ['DELIVERY'] }, BRANCH)).toBeNull();
  });
  it('rejects inactive users first, even without the role', () => {
    expect(courierIneligibleReason({ status: 'INACTIVE', roles: ['WAITER'], branchIds: [] }, BRANCH)).toBe('INACTIVE');
  });
  it('rejects users without the DELIVERY role', () => {
    expect(courierIneligibleReason({ status: 'ACTIVE', roles: ['WAITER'], branchIds: [BRANCH] }, BRANCH)).toBe('NOT_COURIER');
  });
  it('rejects a courier not linked to the branch', () => {
    expect(courierIneligibleReason({ status: 'ACTIVE', roles: ['DELIVERY'], branchIds: ['other'] }, BRANCH)).toBe('NO_BRANCH_ACCESS');
  });
  it('treats OWNER/ADMIN holding DELIVERY as tenant-wide', () => {
    expect(courierIneligibleReason({ status: 'ACTIVE', roles: ['ADMIN', 'DELIVERY'], branchIds: [] }, BRANCH)).toBeNull();
  });
  it('does not make a MANAGER tenant-wide', () => {
    expect(courierIneligibleReason({ status: 'ACTIVE', roles: ['MANAGER', 'DELIVERY'], branchIds: [] }, BRANCH)).toBe('NO_BRANCH_ACCESS');
  });
});

describe('courierWhere', () => {
  const uuid = '11111111-1111-4111-8111-111111111111';
  it('maps the three filter forms', () => {
    expect(courierWhere(undefined, 'u')).toEqual({});
    expect(courierWhere('me', 'u')).toEqual({ courierUserId: 'u' });
    expect(courierWhere('ME', 'u')).toEqual({ courierUserId: 'u' });
    expect(courierWhere('none', 'u')).toEqual({ courierUserId: null });
    expect(courierWhere(uuid, 'u')).toEqual({ courierUserId: uuid });
  });
  it('ignores anything else and the pattern rejects it', () => {
    expect(courierWhere('x', 'u')).toEqual({});
    expect(COURIER_FILTER_PATTERN.test('x')).toBe(false);
    expect(COURIER_FILTER_PATTERN.test('me')).toBe(true);
    expect(COURIER_FILTER_PATTERN.test(uuid)).toBe(true);
  });
});
