// Mirrors apps/api/src/common/util/money.util.ts's contract exactly: round
// once, cents are the source of truth, reais only for display. Duplicated
// (not imported) because apps/api and apps/web are separate deployables —
// there is no shared runtime package between them yet (packages/types only
// has type-only exports, and apps/api doesn't depend on it). See
// docs/PROJECT_STATUS.md "Fatia 03" for this trade-off.
export function toCents(reais: number): number {
  return Math.round(reais * 100);
}

export function formatCentsAsBRL(cents: number): string {
  return `R$ ${(cents / 100).toFixed(2).replace('.', ',')}`;
}
