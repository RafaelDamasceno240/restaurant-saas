// Pure normalization of coupon codes. No I/O: shared by the DTO validators, the admin service,
// the order flow and the preview, so "the same code" means the same thing everywhere.

// The canonical form is what the database stores, compares and indexes (CHECK
// coupons_code_canonical and the partial unique index on (tenantId, code) WHERE active).
export const COUPON_CODE_PATTERN = /^[A-Z0-9_-]{3,32}$/;

// trim + upper case. toUpperCase (not toLocaleUpperCase): the result never depends on the
// server locale. The result may still be INVALID (e.g. inner spaces) - see isValidCouponCode.
export function normalizeCouponCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export function isValidCouponCode(canonical: string): boolean {
  return COUPON_CODE_PATTERN.test(canonical);
}

// Escape LIKE wildcards for the admin search (Prisma's `contains` does not).
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => '\\' + char);
}
