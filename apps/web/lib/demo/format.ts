// Deliberately NOT lib/money.ts's `formatCentsAsBRL` for display here: that
// shared util (used by every real screen — dashboard/caixa, PDV, cardápio,
// checkout) only swaps the decimal point for a comma and has no thousands
// separator (`R$ 1430,00`, not `R$ 1.430,00`). Fixing it there would touch
// every real screen's rendering the day before a presentation — out of
// scope for an "isolado do fluxo real" demo. This is scoped to /demo only.
const formatter = new Intl.NumberFormat('pt-BR', {
  style: 'currency',
  currency: 'BRL',
});

export function formatDemoBRL(cents: number): string {
  return formatter.format(cents / 100);
}
