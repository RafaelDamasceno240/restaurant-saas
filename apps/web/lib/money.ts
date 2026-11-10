// Mirrors apps/api/src/common/util/money.util.ts's contract exactly: round
// once, cents are the source of truth, reais only for display. Duplicated
// (not imported) because apps/api and apps/web are separate deployables —
// there is no shared runtime package between them yet (packages/types only
// has type-only exports, and apps/api doesn't depend on it). See
// docs/PROJECT_STATUS.md "Fatia 03" for this trade-off.
export function toCents(reais: number): number {
  return Math.round(reais * 100);
}

// B6: a product costs at least R$ 0,01 (the API refuses less with the same rule). Takes the price
// field as typed ("12,5", "12.50", "") and says what is wrong with it, or null when it can be sent.
export function productPriceProblem(text: string): string | null {
  const value = Number(text.trim().replace(',', '.'));
  if (text.trim() === '' || !Number.isFinite(value) || toCents(value) < 1) {
    return 'Informe um preço de pelo menos R$ 0,01.';
  }
  if (Math.abs(value * 100 - toCents(value)) > 1e-6) return 'O preço pode ter no máximo 2 casas decimais.';
  return null;
}

// B13 (piloto 2026-10-23): "10.030,00", not "10030,00". The digits of a money amount in the
// Brazilian format, without sign or "R$". By hand (not toLocaleString) so every browser, Node and
// every screen print the same thing, with a plain space after "R$" where the callers put one.
export function formatReais(cents: number): string {
  const whole = Math.round(Math.abs(cents));
  const reais = Math.floor(whole / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${reais},${String(whole % 100).padStart(2, '0')}`;
}

export function formatCentsAsBRL(cents: number): string {
  return `R$ ${Math.round(cents) < 0 ? '-' : ''}${formatReais(cents)}`;
}
