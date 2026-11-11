import {
  brandColorWarning,
  contrastOnWhite,
  groupRangeProblem,
  groupRuleLabel,
  imageFileProblem,
  moveItem,
  normalizeHexColor,
  optionPriceProblem,
  promoPriceProblem,
} from './menu-admin-logic';

describe('moveItem', () => {
  it('moves one step up or down and never past the ends', () => {
    expect(moveItem(['a', 'b', 'c'], 1, -1)).toEqual(['b', 'a', 'c']);
    expect(moveItem(['a', 'b', 'c'], 1, 1)).toEqual(['a', 'c', 'b']);
    expect(moveItem(['a', 'b', 'c'], 0, -1)).toEqual(['a', 'b', 'c']);
    expect(moveItem(['a', 'b', 'c'], 2, 1)).toEqual(['a', 'b', 'c']);
  });
});

describe('promoPriceProblem', () => {
  it('is optional; when given it must be a price above the selling price', () => {
    expect(promoPriceProblem('32', '')).toBeNull();
    expect(promoPriceProblem('32', '35')).toBeNull();
    expect(promoPriceProblem('32,00', '35,90')).toBeNull();
    expect(promoPriceProblem('32', '32')).toMatch(/maior que o preço de venda/);
    expect(promoPriceProblem('32', '30')).toMatch(/maior/);
    expect(promoPriceProblem('32', 'abc')).toMatch(/2 casas/);
    expect(promoPriceProblem('32', '35,999')).toMatch(/2 casas/);
  });
});

describe('optionPriceProblem', () => {
  it('accepts free and priced add-ons, refuses negative or malformed', () => {
    expect(optionPriceProblem('0')).toBeNull();
    expect(optionPriceProblem('4,50')).toBeNull();
    expect(optionPriceProblem('-1')).toMatch(/0 = grátis/);
    expect(optionPriceProblem('')).toMatch(/0 = grátis/);
    expect(optionPriceProblem('1,234')).toMatch(/2 casas/);
  });
});

describe('add-on group rules', () => {
  it('validates the range like the API', () => {
    expect(groupRangeProblem(0, 3)).toBeNull();
    expect(groupRangeProblem(1, 1)).toBeNull();
    expect(groupRangeProblem(2, 1)).toMatch(/maior que o máximo/);
    expect(groupRangeProblem(0, 0)).toMatch(/entre 1 e 50/);
    expect(groupRangeProblem(-1, 2)).toMatch(/negativo/);
  });

  it('reads the rule as the owner thinks about it', () => {
    expect(groupRuleLabel(0, 3)).toBe('Opcional · até 3');
    expect(groupRuleLabel(1, 1)).toBe('Obrigatório · escolha 1');
    expect(groupRuleLabel(1, 5)).toBe('Obrigatório · de 1 a 5');
  });
});

describe('imageFileProblem', () => {
  it('spares uploads the API would refuse', () => {
    expect(imageFileProblem({ size: 1000, type: 'image/png' })).toBeNull();
    expect(imageFileProblem({ size: 1000, type: 'image/webp' })).toBeNull();
    expect(imageFileProblem({ size: 1000, type: 'image/svg+xml' })).toMatch(/JPEG, PNG ou WebP/);
    expect(imageFileProblem({ size: 3 * 1024 * 1024 + 1, type: 'image/jpeg' })).toMatch(/3 MB/);
    expect(imageFileProblem({ size: 0, type: 'image/jpeg' })).toMatch(/vazio/);
  });
});

describe('brand color', () => {
  it('normalizes what the API stores', () => {
    expect(normalizeHexColor('c8102e')).toBe('#C8102E');
    expect(normalizeHexColor(' #1c1917 ')).toBe('#1C1917');
    expect(normalizeHexColor('red')).toBeNull();
  });

  it('warns about colors that barely show on the white menu', () => {
    expect(contrastOnWhite('#FFFFFF')).toBeCloseTo(1);
    expect(brandColorWarning('#FFF7CC')).toMatch(/muito clara/);
    expect(brandColorWarning('#C8102E')).toBeNull();
    expect(brandColorWarning('#1C1917')).toBeNull();
    expect(brandColorWarning(null)).toBeNull();
  });
});
