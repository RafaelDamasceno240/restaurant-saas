import type { OptionGroup } from './cardapio-api';
import {
  blockedRequiredGroup,
  buildPersonalizedLine,
  canPick,
  missingGroup,
  needsPersonalization,
  optionsSummary,
  personalizedKey,
  productSaleGroups,
  quoteKey,
  selectionFromOptions,
  toApiLine,
} from './staff-addons';
import { increment } from './menu-display';

const option = (id: string, name: string, price: number, extra: Partial<OptionGroup['options'][number]> = {}) => ({
  id,
  name,
  description: null,
  price,
  maxQuantity: 1,
  active: true,
  soldOut: false,
  displayOrder: 0,
  imported: false,
  ...extra,
});

const group = (id: string, name: string, minSelect: number, maxSelect: number, options: OptionGroup['options'], extra: Partial<OptionGroup> = {}): OptionGroup => ({
  id,
  name,
  minSelect,
  maxSelect,
  required: minSelect > 0,
  active: true,
  imported: false,
  productIds: [],
  warnings: [],
  options,
  createdAt: '',
  updatedAt: '',
  ...extra,
});

const ponto = group('g-ponto', 'Ponto', 1, 1, [option('o-mal', 'Mal passado', 0), option('o-ponto', 'Ao ponto', 0)]);
const extras = group('g-extra', 'Adicionais', 0, 3, [
  option('o-bacon', 'Bacon', 5, { maxQuantity: 2 }),
  option('o-cheddar', 'Cheddar', 4),
  option('o-ovo', 'Ovo', 2, { soldOut: true }),
  option('o-velho', 'Picles', 1, { active: false }),
]);
const inactive = group('g-off', 'Molhos', 0, 2, [option('o-maio', 'Maionese', 0)], { active: false });
const all = [extras, ponto, inactive];

describe('staff add-ons (PDV and tabs)', () => {
  it('offers the product\'s own active groups, in the product\'s order, with active options only', () => {
    const groups = productSaleGroups({ optionGroupIds: ['g-ponto', 'g-extra', 'g-off', 'g-missing'] }, all);
    expect(groups.map((g) => g.id)).toEqual(['g-ponto', 'g-extra']);
    expect(groups[1].options.map((o) => [o.name, o.soldOut])).toEqual([
      ['Bacon', false],
      ['Cheddar', false],
      ['Ovo', true],
    ]);
    expect(needsPersonalization(groups)).toBe(true);
    expect(needsPersonalization(productSaleGroups({ optionGroupIds: ['g-off'] }, all))).toBe(false);
    expect(productSaleGroups({ optionGroupIds: ['g-ponto'] }, undefined)).toEqual([]);
  });

  it('a sold-out option is shown but never picked; the limits are the menu\'s', () => {
    const [, ext] = productSaleGroups({ optionGroupIds: ['g-ponto', 'g-extra'] }, all);
    expect(canPick(ext, 'o-ovo', {})).toBe(false);
    expect(canPick(ext, 'o-bacon', { 'o-bacon': 2 })).toBe(false); // its own max
    expect(canPick(ext, 'o-cheddar', { 'o-bacon': 2, 'o-cheddar': 0 })).toBe(true);
    expect(canPick(ext, 'o-cheddar', { 'o-bacon': 2, 'o-cheddar': 1 })).toBe(false);
  });

  it('a required group must be chosen before confirming; one that cannot be satisfied blocks the product', () => {
    const groups = productSaleGroups({ optionGroupIds: ['g-ponto', 'g-extra'] }, all);
    expect(missingGroup(groups, {})?.name).toBe('Ponto');
    expect(missingGroup(groups, increment(groups[0], 'o-mal', {}))).toBeNull();
    expect(blockedRequiredGroup(groups)).toBeNull();
    const allSoldOut = group('g-pao', 'Pão', 1, 1, [option('o-a', 'Brioche', 0, { soldOut: true })]);
    expect(blockedRequiredGroup(productSaleGroups({ optionGroupIds: ['g-pao'] }, [allSoldOut]))?.name).toBe('Pão');
  });

  it('builds the line with the add-ons in the product\'s order and the estimated unit price, in cents', () => {
    const groups = productSaleGroups({ optionGroupIds: ['g-ponto', 'g-extra'] }, all);
    const line = buildPersonalizedLine({ id: 'p1', name: 'X-Burger', price: 25 }, groups, { 'o-bacon': 2, 'o-ponto': 1, 'o-cheddar': 1 }, '  sem cebola ', 2);
    expect(line).toEqual({
      productId: 'p1',
      name: 'X-Burger',
      basePriceCents: 2500,
      unitPriceCents: 3900,
      options: [
        { optionId: 'o-ponto', groupName: 'Ponto', name: 'Ao ponto', priceCents: 0, quantity: 1 },
        { optionId: 'o-bacon', groupName: 'Adicionais', name: 'Bacon', priceCents: 500, quantity: 2 },
        { optionId: 'o-cheddar', groupName: 'Adicionais', name: 'Cheddar', priceCents: 400, quantity: 1 },
      ],
      notes: 'sem cebola',
      quantity: 2,
    });
    expect(optionsSummary(line.options)).toBe('Ao ponto · 2× Bacon · Cheddar');
  });

  it('sends ids, quantities and the note only - never a price or a name', () => {
    const line = { productId: 'p1', quantity: 2, notes: ' bem passado ', options: [{ optionId: 'o-bacon', groupName: 'Adicionais', name: 'Bacon', priceCents: 500, quantity: 2 }] };
    expect(toApiLine(line)).toEqual({ productId: 'p1', quantity: 2, options: [{ optionId: 'o-bacon', quantity: 2 }], notes: 'bem passado' });
    expect(toApiLine({ productId: 'p2', quantity: 1, notes: null, options: [] })).toEqual({ productId: 'p2', quantity: 1 });
  });

  it('the identity of a line ignores the order of its add-ons', () => {
    const a = personalizedKey({ productId: 'p1', notes: null, options: [{ optionId: 'a', quantity: 1 }, { optionId: 'b', quantity: 2 }] });
    const b = personalizedKey({ productId: 'p1', notes: null, options: [{ optionId: 'b', quantity: 2 }, { optionId: 'a', quantity: 1 }] });
    expect(a).toBe(b);
    expect(personalizedKey({ productId: 'p1', notes: null, options: [] })).toBe('p1');
    expect(quoteKey([{ productId: 'p1', quantity: 1 }])).not.toBe(quoteKey([{ productId: 'p1', quantity: 2 }]));
  });

  it('editing a saved line drops what can no longer be chosen and says so', () => {
    const groups = productSaleGroups({ optionGroupIds: ['g-ponto', 'g-extra'] }, all);
    const { selection, dropped } = selectionFromOptions(groups, [
      { optionId: 'o-ponto', quantity: 1 },
      { optionId: 'o-ovo', quantity: 1 }, // sold out now
      { optionId: 'o-gone', quantity: 1 }, // deleted
      { optionId: 'o-bacon', quantity: 5 }, // over its max now
    ]);
    expect(selection).toEqual({ 'o-ponto': 1, 'o-bacon': 2 });
    expect(dropped).toEqual(['o-ovo', 'o-gone']);
  });
});
