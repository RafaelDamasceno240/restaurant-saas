// Rules of an add-on group, the same the database CHECKs hold (migration 21:
// option_groups_select_range, option_items_max_quantity_range) and the order pricing applies
// (order-creation/option-pricing.ts). Checked here first so the panel gets a sentence it can show
// instead of a constraint error.
export const MAX_SELECT_LIMIT = 50;

export function groupRangeProblem(minSelect: number, maxSelect: number): string | null {
  if (!Number.isInteger(minSelect) || minSelect < 0) return 'O mínimo não pode ser negativo.';
  if (!Number.isInteger(maxSelect) || maxSelect < 1 || maxSelect > MAX_SELECT_LIMIT)
    return `O máximo deve ficar entre 1 e ${MAX_SELECT_LIMIT}.`;
  if (minSelect > maxSelect) return 'O mínimo não pode ser maior que o máximo.';
  return null;
}

export interface GroupHealthInput {
  minSelect: number;
  active: boolean;
  options: { active: boolean; soldOut: boolean; maxQuantity: number }[];
}

// What the panel should warn about. A required group the customer cannot satisfy makes every
// product that offers it "Esgotado" on the public menu (public-menu.service.ts): not an error to
// save (the owner may be adding options), but never silent.
export function groupWarnings(group: GroupHealthInput): string[] {
  if (!group.active) return [];
  const available = group.options.filter((o) => o.active && !o.soldOut);
  const reachable = available.reduce((sum, o) => sum + o.maxQuantity, 0);
  if (group.minSelect > 0 && available.length === 0)
    return [
      'Grupo obrigatório sem nenhum adicional disponível: os produtos dele aparecem como esgotados.',
    ];
  if (group.minSelect > reachable)
    return [
      `O mínimo (${group.minSelect}) é maior que o total que dá para escolher (${reachable}): os produtos dele não podem ser pedidos.`,
    ];
  return [];
}
