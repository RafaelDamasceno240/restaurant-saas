import type { Coupon } from './coupons-api';
import {
  CouponDraft,
  EMPTY_DRAFT,
  centsToInput,
  couponApplyMessage,
  couponErrorMessage,
  couponPreviewKey,
  describeDiscount,
  describeUsage,
  draftToCreateInput,
  draftToPatch,
  isEmptyPatch,
  isFiltering,
  isoToLocalInput,
  localInputToIso,
  normalizeCode,
  parseMoneyToCents,
  parseWholeNumber,
  toDraft,
  totalAfterCouponCents,
  validateDraft,
} from './coupons-logic';

const draft = (over: Partial<CouponDraft> = {}): CouponDraft => ({ ...EMPTY_DRAFT, code: 'PROMO10', value: '10', ...over });
const creating = { creating: true };

const coupon = (over: Partial<Coupon> = {}): Coupon => ({
  id: 'c1',
  code: 'PROMO10',
  description: null,
  discountType: 'PERCENTAGE',
  value: 10,
  minOrderCents: 0,
  maxDiscountCents: null,
  startsAt: null,
  endsAt: null,
  active: true,
  availability: 'AVAILABLE',
  usageLimit: null,
  usageCount: 0,
  perCustomerLimit: null,
  branch: null,
  createdAt: '2026-10-02T12:00:00.000Z',
  updatedAt: '2026-10-02T12:00:00.000Z',
  ...over,
});

describe('normalizeCode', () => {
  it('trims and upper-cases, like the API', () => {
    for (const typed of ['promo10', ' PROMO10 ', '\tPromo10\n']) expect(normalizeCode(typed)).toBe('PROMO10');
  });
});

describe('parseMoneyToCents', () => {
  it('reads plain decimal money into whole cents', () => {
    expect(parseMoneyToCents('12,50')).toBe(1250);
    expect(parseMoneyToCents('12.50')).toBe(1250);
    expect(parseMoneyToCents('12')).toBe(1200);
    expect(parseMoneyToCents(' 0,5 ')).toBe(50);
    expect(parseMoneyToCents('0,05')).toBe(5);
    expect(parseMoneyToCents('19,99')).toBe(1999);
  });

  it('never guesses: anything else is null', () => {
    for (const bad of ['', 'abc', '-5', '1,2,3', '1,234', '1.234,50', 'R$ 5', '5,', ',5', '1e3', '99999999999']) {
      expect(parseMoneyToCents(bad)).toBeNull();
    }
  });

  it('stays inside the 32-bit money column', () => {
    expect(parseMoneyToCents('21474836,47')).toBe(2_147_483_647);
    expect(parseMoneyToCents('21474836,48')).toBeNull();
  });

  it('round-trips with centsToInput', () => {
    for (const cents of [1, 5, 50, 100, 1250, 99_999]) expect(parseMoneyToCents(centsToInput(cents))).toBe(cents);
    expect(centsToInput(null)).toBe('');
  });
});

describe('parseWholeNumber', () => {
  it('accepts whole non-negative numbers only', () => {
    expect(parseWholeNumber('10')).toBe(10);
    expect(parseWholeNumber(' 7 ')).toBe(7);
    for (const bad of ['', '1.5', '-1', 'a', '1,5', '99999999999']) expect(parseWholeNumber(bad)).toBeNull();
  });
});

describe('validateDraft', () => {
  it('accepts a valid percentage and a valid fixed coupon', () => {
    expect(validateDraft(draft(), creating)).toBeNull();
    expect(validateDraft(draft({ discountType: 'FIXED', value: '5,00' }), creating)).toBeNull();
  });

  it('checks the code only when creating, using the canonical form', () => {
    expect(validateDraft(draft({ code: ' promo10 ' }), creating)).toBeNull();
    for (const bad of ['', 'AB', 'PRO MO', 'PROMO%', 'A'.repeat(33)]) {
      expect(validateDraft(draft({ code: bad }), creating)).toMatch(/Código inválido/);
    }
    expect(validateDraft(draft({ code: '' }), { creating: false })).toBeNull(); // the code is not editable
  });

  it('percentage: whole number from 1 to 100', () => {
    for (const bad of ['', '0', '101', '10,5', '-3', 'x']) {
      expect(validateDraft(draft({ value: bad }), creating)).toMatch(/percentual/);
    }
    expect(validateDraft(draft({ value: '100' }), creating)).toBeNull();
  });

  it('fixed: money above zero', () => {
    for (const bad of ['', '0', '0,00', 'abc', '-5']) {
      expect(validateDraft(draft({ discountType: 'FIXED', value: bad }), creating)).toMatch(/valor de desconto/);
    }
  });

  it('the discount cap is only checked for percentage coupons', () => {
    expect(validateDraft(draft({ maxDiscount: '20,00' }), creating)).toBeNull();
    expect(validateDraft(draft({ maxDiscount: 'x' }), creating)).toMatch(/teto/);
    expect(validateDraft(draft({ maxDiscount: '0' }), creating)).toMatch(/teto/);
    expect(validateDraft(draft({ discountType: 'FIXED', value: '5', maxDiscount: 'lixo' }), creating)).toBeNull();
  });

  it('minimum order, window and limits', () => {
    expect(validateDraft(draft({ minOrder: '30,00' }), creating)).toBeNull();
    expect(validateDraft(draft({ minOrder: 'abc' }), creating)).toMatch(/mínimo/);
    expect(validateDraft(draft({ startsAt: '2026-10-10T10:00', endsAt: '2026-10-09T10:00' }), creating)).toMatch(/depois do início/);
    expect(validateDraft(draft({ startsAt: '2026-10-10T10:00', endsAt: '2026-10-10T10:00' }), creating)).toMatch(/depois do início/);
    expect(validateDraft(draft({ startsAt: '2026-10-10T10:00', endsAt: '2026-10-11T10:00' }), creating)).toBeNull();
    expect(validateDraft(draft({ usageLimit: '0' }), creating)).toMatch(/limite de utilizações/);
    expect(validateDraft(draft({ perCustomerLimit: '1.5' }), creating)).toMatch(/limite por cliente/);
    expect(validateDraft(draft({ usageLimit: '5', perCustomerLimit: '1' }), creating)).toBeNull();
  });

  it('description length and the branch of a branch-limited user', () => {
    expect(validateDraft(draft({ description: 'x'.repeat(201) }), creating)).toMatch(/descrição/);
    expect(validateDraft(draft(), { creating: true, branchRequired: true })).toMatch(/unidade/);
    expect(validateDraft(draft({ branchId: 'b1' }), { creating: true, branchRequired: true })).toBeNull();
  });
});

describe('draftToCreateInput', () => {
  it('sends the canonical code and money in cents, never reais', () => {
    expect(draftToCreateInput(draft({ code: ' promo10 ', value: '15', minOrder: '30,00', maxDiscount: '20,50' }))).toEqual({
      code: 'PROMO10',
      description: null,
      discountType: 'PERCENTAGE',
      value: 15,
      minOrderCents: 3000,
      maxDiscountCents: 2050,
      startsAt: null,
      endsAt: null,
      usageLimit: null,
      perCustomerLimit: null,
      branchId: null,
    });
    const fixed = draftToCreateInput(draft({ discountType: 'FIXED', value: '5,50', maxDiscount: '99', usageLimit: '10', branchId: 'b1' }));
    expect(fixed).toMatchObject({ discountType: 'FIXED', value: 550, maxDiscountCents: null, usageLimit: 10, branchId: 'b1' });
  });

  it('turns empty optional fields into null, not into invented numbers', () => {
    const input = draftToCreateInput(draft());
    expect([input.minOrderCents, input.maxDiscountCents, input.usageLimit, input.perCustomerLimit]).toEqual([0, null, null, null]);
  });
});

describe('draftToPatch', () => {
  it('an untouched coupon is an empty patch', () => {
    const c = coupon({ discountType: 'FIXED', value: 500, minOrderCents: 3000, usageLimit: 5, description: 'x' });
    expect(isEmptyPatch(draftToPatch(toDraft(c), c))).toBe(true);
  });

  it('sends only the changed fields and clears optional ones with null', () => {
    const c = coupon({ maxDiscountCents: 1000, usageLimit: 5, description: 'antes' });
    const next = { ...toDraft(c), value: '15', usageLimit: '', description: 'depois', maxDiscount: '' };
    expect(draftToPatch(next, c)).toEqual({ value: 15, usageLimit: null, description: 'depois', maxDiscountCents: null });
  });

  it('never carries the code, the branch or the activation', () => {
    const c = coupon({ branch: { id: 'b1', name: 'Matriz' } });
    const patch = draftToPatch({ ...toDraft(c), code: 'OUTRO', branchId: 'b2', value: '20' }, c) as Record<string, unknown>;
    expect(Object.keys(patch)).toEqual(['value']);
  });

  it('compares dates as instants, not as strings', () => {
    const c = coupon({ startsAt: '2026-10-10T13:00:00.000Z' });
    expect(isEmptyPatch(draftToPatch(toDraft(c), c))).toBe(true);
  });
});

describe('dates', () => {
  it('local input <-> ISO round-trips and empty means no date', () => {
    const local = '2026-10-10T09:30';
    expect(isoToLocalInput(localInputToIso(local))).toBe(local);
    expect(localInputToIso('')).toBeNull();
    expect(localInputToIso('not a date')).toBeNull();
    expect(isoToLocalInput(null)).toBe('');
  });
});

describe('couponPreviewKey', () => {
  const items = [
    { productId: 'b', quantity: 2 },
    { productId: 'a', quantity: 1 },
  ];
  it('is the same for the same basket regardless of order or code spelling', () => {
    expect(couponPreviewKey('br1', 'promo10', items)).toBe(couponPreviewKey('br1', ' PROMO10 ', [...items].reverse()));
  });
  it('changes with the branch, the code, the products or a quantity (the preview becomes stale)', () => {
    const base = couponPreviewKey('br1', 'PROMO10', items);
    expect(couponPreviewKey('br2', 'PROMO10', items)).not.toBe(base);
    expect(couponPreviewKey('br1', 'OUTRO10', items)).not.toBe(base);
    expect(couponPreviewKey('br1', 'PROMO10', [{ productId: 'a', quantity: 2 }, items[0]])).not.toBe(base);
    expect(couponPreviewKey('br1', 'PROMO10', [items[1]])).not.toBe(base);
  });
});

describe('display helpers', () => {
  it('totalAfterCouponCents: only a display; never negative; the fee is added back untouched', () => {
    expect(totalAfterCouponCents(5000, 500)).toBe(4500);
    expect(totalAfterCouponCents(5000, 500, 700)).toBe(5200);
    expect(totalAfterCouponCents(2500, 99_999, 300)).toBe(300);
    expect(totalAfterCouponCents(2500, 0)).toBe(2500);
  });

  it('describes the discount and the usage', () => {
    expect(describeDiscount(coupon())).toBe('10%');
    expect(describeDiscount(coupon({ maxDiscountCents: 2000 }))).toBe('10% (até R$ 20,00)');
    expect(describeDiscount(coupon({ discountType: 'FIXED', value: 550 }))).toBe('R$ 5,50');
    expect(describeUsage(coupon({ usageCount: 3 }))).toBe('3');
    expect(describeUsage(coupon({ usageCount: 3, usageLimit: 10 }))).toBe('3 / 10');
  });

  it('tells "no coupons yet" from "nothing matches the filters"', () => {
    expect(isFiltering('', 'active')).toBe(false);
    expect(isFiltering(' ', 'active')).toBe(false);
    expect(isFiltering('promo', 'active')).toBe(true);
    expect(isFiltering('', 'inactive')).toBe(true);
  });

  it('error messages: friendly for known codes, the API message otherwise', () => {
    expect(couponErrorMessage('COUPON_CODE_TAKEN', 'x')).toMatch(/Desative-o/);
    expect(couponErrorMessage('COUPON_USAGE_LIMIT_BELOW_USED', 'limite menor que 4')).toBe('limite menor que 4');
    expect(couponErrorMessage('OUTRO', 'texto da API')).toBe('texto da API');
    expect(couponApplyMessage('COUPON_INVALID', 'x')).toBe('Cupom inválido ou não aplicável a este pedido.');
    expect(couponApplyMessage('COUPON_EXPIRED', 'Este cupom expirou.')).toBe('Este cupom expirou.');
  });
});
