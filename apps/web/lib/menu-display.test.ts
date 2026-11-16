import {
  brandCssVars,
  canIncrement,
  chosenOptions,
  decrement,
  describeOpening,
  firstMissingGroup,
  groupRuleText,
  groupUnits,
  increment,
  localWeekMinute,
  priceLabel,
  unitPriceCents,
} from './menu-display';
import type { PublicMenuOptionGroup, PublicMenuProduct } from './public-menu-api';

const turbine: PublicMenuOptionGroup = {
  id: 'g1',
  name: 'Turbine seu lanche!',
  minSelect: 0,
  maxSelect: 3,
  options: [
    { id: 'bacon', name: 'Bacon', description: null, price: 4, maxQuantity: 2, imageUrl: null },
    { id: 'ovo', name: 'Ovo', description: null, price: 2, maxQuantity: 10, imageUrl: null },
  ],
};
const soda: PublicMenuOptionGroup = {
  id: 'g2',
  name: 'Refrigerante combo',
  minSelect: 1,
  maxSelect: 1,
  options: [
    { id: 'coca', name: 'Coca lata', description: null, price: 0, maxQuantity: 1, imageUrl: null },
    {
      id: 'guarana',
      name: 'Guaraná lata',
      description: null,
      price: 0,
      maxQuantity: 1,
      imageUrl: null,
    },
  ],
};
const product = (extra: Partial<PublicMenuProduct> = {}): PublicMenuProduct => ({
  id: 'p1',
  name: 'Burger Tudo',
  description: null,
  price: 34,
  imageUrl: null,
  ...extra,
});

describe('brandCssVars', () => {
  it('turns #RRGGBB into theme triplets with a readable text color', () => {
    expect(brandCssVars('#C8102E')).toEqual({
      '--primary': '200 16 46',
      '--primary-hover': '172 14 40',
      '--primary-foreground': '255 255 255',
    });
    expect(brandCssVars('#FFD54F')['--primary-foreground']).toBe('17 17 17');
  });

  it('keeps the defaults without a valid color', () => {
    expect(brandCssVars(null)).toEqual({});
    expect(brandCssVars('red')).toEqual({});
  });
});

describe('priceLabel', () => {
  it('fixed price, "a partir de" with a paid add-on, promotion with the full price', () => {
    expect(priceLabel(product())).toEqual({
      priceCents: 3400,
      compareAtCents: null,
      startingAt: false,
    });
    expect(priceLabel(product({ optionGroups: [turbine] })).startingAt).toBe(true);
    // Only free choices: the price cannot go up.
    expect(priceLabel(product({ optionGroups: [soda] })).startingAt).toBe(false);
    expect(priceLabel(product({ price: 32, compareAtPrice: 35, optionGroups: [turbine] }))).toEqual(
      {
        priceCents: 3200,
        compareAtCents: 3500,
        startingAt: false,
      },
    );
  });
});

describe('describeOpening (restaurant time zone)', () => {
  // Brendi's Do'cê hours: Thu 19:00-22:30, Fri 19:00-23:00, Sat/Sun 19:00-22:45.
  const hours = [
    { weekday: 0, opens: '19:00', closes: '22:45' },
    { weekday: 4, opens: '19:00', closes: '22:30' },
    { weekday: 5, opens: '19:00', closes: '23:00' },
    { weekday: 6, opens: '19:00', closes: '22:45' },
  ];
  const at = (iso: string) => new Date(iso);

  it('reads the weekday and minute in the given zone', () => {
    // 2026-11-10 21:00 UTC = Tuesday 18:00 in São Paulo.
    expect(localWeekMinute(at('2026-11-10T21:00:00Z'), 'America/Sao_Paulo')).toBe(
      2 * 1440 + 18 * 60,
    );
  });

  it('closed on Tuesday: opens Thursday', () => {
    expect(describeOpening(hours, at('2026-11-10T21:00:00Z'), 'America/Sao_Paulo')).toEqual({
      open: false,
      text: 'Fechado · abre quinta às 19:00',
    });
  });

  it('Wednesday night: opens tomorrow; Thursday afternoon: opens today', () => {
    expect(describeOpening(hours, at('2026-11-12T01:00:00Z'), 'America/Sao_Paulo').text).toBe(
      'Fechado · abre amanhã às 19:00',
    );
    expect(describeOpening(hours, at('2026-11-12T18:00:00Z'), 'America/Sao_Paulo').text).toBe(
      'Fechado · abre hoje às 19:00',
    );
  });

  it('open on Friday evening, with the closing time', () => {
    expect(describeOpening(hours, at('2026-11-14T00:30:00Z'), 'America/Sao_Paulo')).toEqual({
      open: true,
      text: 'Aberto agora · fecha às 23:00',
    });
  });

  it('an interval past midnight stays open after 00:00', () => {
    const late = [{ weekday: 6, opens: '18:00', closes: '02:00' }];
    // Sunday 01:00 in São Paulo = 04:00 UTC.
    expect(describeOpening(late, at('2026-11-15T04:00:00Z'), 'America/Sao_Paulo').open).toBe(true);
  });

  it('no hours informed: nothing to say; empty week: closed', () => {
    expect(describeOpening(null, new Date())).toEqual({ open: null, text: '' });
    expect(describeOpening([], new Date()).open).toBe(false);
  });
});

describe('add-on selection', () => {
  it('respects the per-option and the group maximum', () => {
    let sel = increment(turbine, 'bacon', {});
    sel = increment(turbine, 'bacon', sel);
    expect(canIncrement(turbine, 'bacon', sel)).toBe(false); // bacon max 2
    sel = increment(turbine, 'ovo', sel);
    expect(groupUnits(turbine, sel)).toBe(3);
    expect(canIncrement(turbine, 'ovo', sel)).toBe(false); // group max 3
    expect(increment(turbine, 'ovo', sel)).toBe(sel);
    expect(decrement('bacon', sel)).toEqual({ bacon: 1, ovo: 1 });
    expect(decrement('ovo', sel)).toEqual({ bacon: 2 });
  });

  it('a single-choice group replaces the previous choice', () => {
    const sel = increment(soda, 'guarana', increment(soda, 'coca', {}));
    expect(sel).toEqual({ guarana: 1 });
  });

  it('finds the first required group still missing', () => {
    expect(firstMissingGroup([turbine, soda], {})).toBe(soda);
    expect(firstMissingGroup([turbine, soda], { coca: 1 })).toBeNull();
  });

  it('prices one unit with its add-ons, in the order of the product', () => {
    const p = product({ optionGroups: [turbine, soda] });
    const sel = { ovo: 2, bacon: 1, coca: 1 };
    expect(unitPriceCents(p, sel)).toBe(3400 + 400 + 2 * 200);
    expect(chosenOptions(p.optionGroups!, sel).map((o) => `${o.name}x${o.quantity}`)).toEqual([
      'Baconx1',
      'Ovox2',
      'Coca latax1',
    ]);
  });

  it('describes the rule of each group', () => {
    expect(groupRuleText(turbine)).toBe('Escolha até 3 opções');
    expect(groupRuleText(soda)).toBe('Escolha 1 opção');
    expect(groupRuleText({ ...soda, minSelect: 1, maxSelect: 5 })).toBe('Escolha de 1 a 5');
  });
});
