// Pure normalization/validation of CRM customer data. No I/O, so it is unit-tested alone
// and shared by the DTO validators and the service (one definition of "valid").

// Phone: stored as digits only. A Brazilian number typed with the country code
// (55 + DDD + 8/9 digits = 12 or 13 digits) is reduced to the national number so
// "+55 (11) 98765-4321" and "11987654321" are the same customer. Anything else is kept
// as typed (digits only) as long as it has a plausible length (E.164 allows up to 15).
// No other rule is guessed: no DDD table, no mobile-prefix check.
const PHONE_MIN_DIGITS = 8;
const PHONE_MAX_DIGITS = 15;

export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '');
  if ((digits.length === 12 || digits.length === 13) && digits.startsWith('55')) digits = digits.slice(2);
  return digits.length >= PHONE_MIN_DIGITS && digits.length <= PHONE_MAX_DIGITS ? digits : null;
}

// Loose shape accepted from the client before normalizing (same spirit as the checkout
// and PDV phone fields: digits, spaces, parentheses, plus and dashes).
export const PHONE_INPUT_PATTERN = /^[\d\s()+-]{8,25}$/;

export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

// CPF: 11 digits with valid check digits. The all-equal sequences (000.000.000-00 ...)
// pass the arithmetic but are not real CPFs, so they are refused.
export function normalizeCpf(raw: string): string | null {
  const digits = raw.replace(/\D/g, '');
  return isValidCpf(digits) ? digits : null;
}

export function isValidCpf(digits: string): boolean {
  if (!/^\d{11}$/.test(digits) || /^(\d)\1{10}$/.test(digits)) return false;
  const check = (length: number) => {
    let sum = 0;
    for (let i = 0; i < length; i++) sum += Number(digits[i]) * (length + 1 - i);
    const rest = (sum * 10) % 11;
    return rest === 10 ? 0 : rest;
  };
  return check(9) === Number(digits[9]) && check(10) === Number(digits[10]);
}

// Prisma's `contains` does not escape LIKE wildcards: without this, searching "%" would
// match every customer.
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => '\\' + char);
}

// What the list search looks at. Digits are compared with the normalized columns (phone,
// cpf) only when there are enough of them to be meaningful, so typing "a" never scans
// every phone and typing "11" does not match half the base.
const MIN_DIGITS_TO_SEARCH = 3;

export interface CustomerSearchTerms {
  text: string;
  digits: string | null;
}

export function searchTerms(raw: string | undefined): CustomerSearchTerms | null {
  const text = raw?.trim();
  if (!text) return null;
  const digits = text.replace(/\D/g, '');
  return { text, digits: digits.length >= MIN_DIGITS_TO_SEARCH ? digits : null };
}
