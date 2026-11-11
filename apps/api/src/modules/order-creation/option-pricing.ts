// Add-ons of an order line (option groups, migration 20261110210000). Pure: the caller loads the
// product with its groups and options (scoped to the tenant) and this decides whether the
// customer's choice is valid and what it costs. The client never prices anything: it only sends
// option ids and quantities, exactly like it only sends product ids.

export interface OptionForPricing {
  id: string;
  name: string;
  priceCents: number;
  maxQuantity: number;
  active: boolean;
  soldOut: boolean;
}

export interface GroupForPricing {
  id: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  active: boolean;
  options: OptionForPricing[];
}

export interface ChosenOption {
  optionId: string;
  quantity: number;
}

// Frozen on the order line: names and prices as they were when the order was placed.
export interface PricedOption {
  optionItemId: string;
  groupNameSnapshot: string;
  optionNameSnapshot: string;
  unitPriceCents: number;
  quantity: number;
}

export type OptionPricingError =
  | { code: 'OPTION_UNAVAILABLE'; message: string }
  | { code: 'OPTION_LIMIT'; message: string }
  | { code: 'OPTION_REQUIRED'; message: string };

export type OptionPricingResult =
  | { ok: true; options: PricedOption[]; extraCents: number }
  | { ok: false; error: OptionPricingError };

// Order of the result: the product's groups in their display order, then each group's options in
// theirs (the kitchen reads them in the same order as the customer saw them).
//
// `enforceRequired`: the public checkout must satisfy every required group (minSelect > 0). The
// staff flows (PDV) do not offer add-ons yet, so they sell the product at its base price and the
// minimums are not checked there; the maximums and availability always are.
export function priceOptions(
  productName: string,
  groups: GroupForPricing[],
  chosen: ChosenOption[],
  enforceRequired: boolean,
): OptionPricingResult {
  const activeGroups = groups.filter((g) => g.active);
  const owner = new Map<string, { group: GroupForPricing; option: OptionForPricing }>();
  for (const group of activeGroups)
    for (const option of group.options) owner.set(option.id, { group, option });

  const quantityById = new Map<string, number>();
  for (const choice of chosen) {
    quantityById.set(choice.optionId, (quantityById.get(choice.optionId) ?? 0) + choice.quantity);
  }

  for (const [optionId, quantity] of quantityById) {
    const found = owner.get(optionId);
    if (!found || !found.option.active || found.option.soldOut) {
      return fail(
        'OPTION_UNAVAILABLE',
        `Um dos adicionais escolhidos para "${productName}" não está mais disponível.`,
      );
    }
    if (quantity > found.option.maxQuantity) {
      return fail(
        'OPTION_LIMIT',
        `No máximo ${found.option.maxQuantity} de "${found.option.name}" em "${productName}".`,
      );
    }
  }

  const priced: PricedOption[] = [];
  for (const group of activeGroups) {
    let units = 0;
    for (const option of group.options) {
      const quantity = quantityById.get(option.id);
      if (!quantity) continue;
      units += quantity;
      priced.push({
        optionItemId: option.id,
        groupNameSnapshot: group.name,
        optionNameSnapshot: option.name,
        unitPriceCents: option.priceCents,
        quantity,
      });
    }
    if (units > group.maxSelect) {
      return fail(
        'OPTION_LIMIT',
        `Escolha no máximo ${group.maxSelect} em "${group.name}" (${productName}).`,
      );
    }
    if (enforceRequired && units < group.minSelect) {
      return fail(
        'OPTION_REQUIRED',
        group.minSelect === 1
          ? `Escolha uma opção em "${group.name}" (${productName}).`
          : `Escolha pelo menos ${group.minSelect} em "${group.name}" (${productName}).`,
      );
    }
  }

  const extraCents = priced.reduce((sum, o) => sum + o.unitPriceCents * o.quantity, 0);
  return { ok: true, options: priced, extraCents };
}

function fail(code: OptionPricingError['code'], message: string): OptionPricingResult {
  return { ok: false, error: { code, message } };
}

// Same line, same request: used by the idempotent replay to tell a retry from another order.
export function optionsSignature(
  options: { optionItemId: string | null; quantity: number }[],
): string {
  return options
    .map((o) => `${o.optionItemId ?? '-'}x${o.quantity}`)
    .sort()
    .join(',');
}

// A line note as stored: trimmed, inner whitespace kept, empty means none.
export function normalizeLineNote(note: string | null | undefined): string | null {
  const value = note?.trim();
  return value ? value : null;
}
