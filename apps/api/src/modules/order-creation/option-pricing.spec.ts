import {
  GroupForPricing,
  normalizeLineNote,
  optionsSignature,
  priceOptions,
} from './option-pricing';

const turbine: GroupForPricing = {
  id: 'g1',
  name: 'Turbine seu lanche!',
  minSelect: 0,
  maxSelect: 10,
  active: true,
  options: [
    { id: 'bacon', name: 'Bacon', priceCents: 400, maxQuantity: 10, active: true, soldOut: false },
    { id: 'ovo', name: 'Ovo', priceCents: 200, maxQuantity: 2, active: true, soldOut: false },
    {
      id: 'pao',
      name: 'Troca de pão',
      priceCents: 200,
      maxQuantity: 10,
      active: true,
      soldOut: true,
    },
    {
      id: 'velho',
      name: 'Antigo',
      priceCents: 100,
      maxQuantity: 10,
      active: false,
      soldOut: false,
    },
  ],
};
const soda: GroupForPricing = {
  id: 'g2',
  name: 'Refrigerante combo',
  minSelect: 1,
  maxSelect: 1,
  active: true,
  options: [
    { id: 'coca', name: 'Coca lata', priceCents: 0, maxQuantity: 1, active: true, soldOut: false },
    {
      id: 'guarana',
      name: 'Guaraná lata',
      priceCents: 0,
      maxQuantity: 1,
      active: true,
      soldOut: false,
    },
  ],
};

describe('priceOptions', () => {
  it('no add-ons: no extra, nothing frozen', () => {
    expect(priceOptions('Burger', [turbine], [], true)).toEqual({
      ok: true,
      options: [],
      extraCents: 0,
    });
  });

  it('prices per unit of the line and freezes names/prices in the product order', () => {
    const result = priceOptions(
      'Burger',
      [turbine, soda],
      [
        { optionId: 'ovo', quantity: 2 },
        { optionId: 'coca', quantity: 1 },
        { optionId: 'bacon', quantity: 1 },
      ],
      true,
    );
    expect(result).toEqual({
      ok: true,
      extraCents: 400 + 2 * 200,
      options: [
        {
          optionItemId: 'bacon',
          groupNameSnapshot: 'Turbine seu lanche!',
          optionNameSnapshot: 'Bacon',
          unitPriceCents: 400,
          quantity: 1,
        },
        {
          optionItemId: 'ovo',
          groupNameSnapshot: 'Turbine seu lanche!',
          optionNameSnapshot: 'Ovo',
          unitPriceCents: 200,
          quantity: 2,
        },
        {
          optionItemId: 'coca',
          groupNameSnapshot: 'Refrigerante combo',
          optionNameSnapshot: 'Coca lata',
          unitPriceCents: 0,
          quantity: 1,
        },
      ],
    });
  });

  it('the same option sent twice adds up (and still respects its maximum)', () => {
    const twice = priceOptions(
      'Burger',
      [turbine],
      [
        { optionId: 'bacon', quantity: 1 },
        { optionId: 'bacon', quantity: 2 },
      ],
      false,
    );
    expect(twice.ok && twice.options[0].quantity).toBe(3);
    const over = priceOptions(
      'Burger',
      [turbine],
      [
        { optionId: 'ovo', quantity: 1 },
        { optionId: 'ovo', quantity: 2 },
      ],
      false,
    );
    expect(over).toMatchObject({ ok: false, error: { code: 'OPTION_LIMIT' } });
  });

  it('refuses an option of another product, an inactive one, a sold-out one or one of an inactive group', () => {
    for (const optionId of ['nao-existe', 'velho', 'pao']) {
      expect(priceOptions('Burger', [turbine], [{ optionId, quantity: 1 }], false)).toMatchObject({
        ok: false,
        error: { code: 'OPTION_UNAVAILABLE' },
      });
    }
    expect(
      priceOptions(
        'Combo',
        [{ ...soda, active: false }],
        [{ optionId: 'coca', quantity: 1 }],
        false,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'OPTION_UNAVAILABLE' },
    });
  });

  it('refuses more units than the group allows', () => {
    expect(
      priceOptions(
        'Combo',
        [soda],
        [
          { optionId: 'coca', quantity: 1 },
          { optionId: 'guarana', quantity: 1 },
        ],
        true,
      ),
    ).toMatchObject({
      ok: false,
      error: { code: 'OPTION_LIMIT' },
    });
    const small = { ...turbine, maxSelect: 2 };
    expect(
      priceOptions('Burger', [small], [{ optionId: 'bacon', quantity: 3 }], false),
    ).toMatchObject({
      ok: false,
      error: { code: 'OPTION_LIMIT' },
    });
  });

  it('a required group is enforced only when asked (public checkout), never skipped there', () => {
    expect(priceOptions('Combo', [soda], [], true)).toMatchObject({
      ok: false,
      error: {
        code: 'OPTION_REQUIRED',
        message: 'Escolha uma opção em "Refrigerante combo" (Combo).',
      },
    });
    expect(priceOptions('Combo', [soda], [], false)).toEqual({
      ok: true,
      options: [],
      extraCents: 0,
    });
    // An inactive required group asks nothing.
    expect(priceOptions('Combo', [{ ...soda, active: false }], [], true)).toEqual({
      ok: true,
      options: [],
      extraCents: 0,
    });
  });
});

describe('optionsSignature / normalizeLineNote', () => {
  it('does not depend on the order of the options', () => {
    expect(
      optionsSignature([
        { optionItemId: 'b', quantity: 1 },
        { optionItemId: 'a', quantity: 2 },
      ]),
    ).toBe(
      optionsSignature([
        { optionItemId: 'a', quantity: 2 },
        { optionItemId: 'b', quantity: 1 },
      ]),
    );
    expect(optionsSignature([])).toBe('');
  });

  it('trims notes and treats blank as none', () => {
    expect(normalizeLineNote('  sem cebola ')).toBe('sem cebola');
    expect(normalizeLineNote('   ')).toBeNull();
    expect(normalizeLineNote(undefined)).toBeNull();
  });
});
