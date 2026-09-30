import { Prisma } from '@prisma/client';

// Free text coming from the customer or from staff: trimmed, and blank means "no note".
export function normalizeNotes(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

// Prisma's `contains` does not escape the LIKE wildcards, so a search for "50%" or "a_b"
// would match far more than typed. Backslash is PostgreSQL's default LIKE escape.
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => '\\' + char);
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

// Builds the creation-time filter of the delivery list. The web sends the local day
// bounds as ISO instants (so the timezone is the operator's). A bare YYYY-MM-DD is also
// accepted; as an upper bound it means "until the end of that UTC day".
export function createdAtRange(dateFrom?: string, dateTo?: string): Prisma.DateTimeFilter | undefined {
  if (!dateFrom && !dateTo) return undefined;
  const range: Prisma.DateTimeFilter = {};
  if (dateFrom) range.gte = new Date(dateFrom);
  if (dateTo) {
    const upper = new Date(dateTo);
    if (DATE_ONLY.test(dateTo)) upper.setUTCHours(23, 59, 59, 999);
    range.lte = upper;
  }
  return range;
}
