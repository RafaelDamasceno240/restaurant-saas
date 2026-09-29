import { randomBytes } from 'crypto';

// Short, customer-friendly order reference (e.g. "MFXQ2-A1B2") — not a
// security token, not the primary key. Timestamp (base36) + a few random
// hex chars keeps collisions astronomically unlikely without needing a
// DB-backed sequence for this MVP. The DB column is still @unique, so a
// real collision surfaces as a clear error instead of silent duplication.
export function generateOrderNumber(): string {
  const timePart = Date.now().toString(36).toUpperCase();
  const randomPart = randomBytes(2).toString('hex').toUpperCase();
  return `${timePart}-${randomPart}`;
}
