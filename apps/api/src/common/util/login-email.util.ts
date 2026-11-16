import { Prisma } from '@prisma/client';

// The e-mail is the login, and people do not type it the same way twice: a phone capitalises
// the first letter, someone pastes it with a trailing space. Since 2026-11-10 it is compared
// without case: every write stores it trimmed and lower-cased, and every lookup compares
// lower(email), so an account stored with capitals before that day is still found (and left
// as it is: nothing rewrites existing rows).
export const normalizeLoginEmail = (value: string): string => value.trim().toLowerCase();

// For @Transform on DTOs: runs before @IsEmail, so " Ana@X.com" validates as "ana@x.com".
export const toLoginEmail = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? normalizeLoginEmail(value) : value;

type Db = Pick<Prisma.TransactionClient, '$queryRaw'>;

export interface LoginEmailAccount {
  id: string;
  email: string;
}

// Every account whose e-mail is this one in any case. More than one only exists if two were
// created with different capitals before 2026-11-10 (the unique index is case-sensitive).
// Raw SQL on purpose: Prisma's `mode: 'insensitive'` is an ILIKE, where `_` is a wildcard.
export function findAccountsByLoginEmail(db: Db, email: string): Promise<LoginEmailAccount[]> {
  return db.$queryRaw<LoginEmailAccount[]>(
    Prisma.sql`SELECT id, email FROM users WHERE lower(email) = ${normalizeLoginEmail(email)}`,
  );
}

// The one account that signs in with this e-mail. With two legacy accounts that differ only by
// case, the one spelled exactly as typed wins; if neither is, no account is picked, rather than
// guessing whose password to check.
export async function findAccountIdByLoginEmail(db: Db, email: string): Promise<string | null> {
  const matches = await findAccountsByLoginEmail(db, email);
  if (matches.length <= 1) return matches[0]?.id ?? null;
  return matches.find((account) => account.email === email.trim())?.id ?? null;
}
