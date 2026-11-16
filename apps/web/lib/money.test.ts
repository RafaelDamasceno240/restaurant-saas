import { formatCentsAsBRL, formatReais, productPriceProblem } from './money';
import { formatCents } from './cash-api';

describe('productPriceProblem (B6)', () => {
  it('refuses empty, zero, negative and below one cent', () => {
    for (const text of ['', '   ', '0', '0.00', '-1', '-0.01', '0.004', 'abc']) {
      expect(productPriceProblem(text)).toBe('Informe um preço de pelo menos R$ 0,01.');
    }
  });

  it('accepts one cent and up, with dot or comma', () => {
    for (const text of ['0.01', '0,01', '1', '24.9', '24,90', '1234.56']) {
      expect(productPriceProblem(text)).toBeNull();
    }
  });

  it('refuses more than 2 decimal places', () => {
    expect(productPriceProblem('1.005')).toBe('O preço pode ter no máximo 2 casas decimais.');
    expect(productPriceProblem('0.015')).toBe('O preço pode ter no máximo 2 casas decimais.');
  });
});

describe('Brazilian money format with thousands separator (B13)', () => {
  it('groups thousands with a dot and keeps the comma for cents', () => {
    expect(formatReais(0)).toBe('0,00');
    expect(formatReais(5)).toBe('0,05');
    expect(formatReais(99999)).toBe('999,99');
    expect(formatReais(100000)).toBe('1.000,00');
    expect(formatReais(196440)).toBe('1.964,40');
    expect(formatReais(1003000)).toBe('10.030,00');
    expect(formatReais(123456789)).toBe('1.234.567,89');
    expect(formatReais(-196440)).toBe('1.964,40');
  });

  it('the screens print it with "R$" and the sign they always used', () => {
    expect(formatCentsAsBRL(1003000)).toBe('R$ 10.030,00');
    expect(formatCentsAsBRL(4180)).toBe('R$ 41,80');
    expect(formatCents(1003000)).toBe('R$ 10.030,00');
    expect(formatCents(-196440)).toBe('-R$ 1.964,40');
    expect(formatCents(-90)).toBe('-R$ 0,90');
  });
});
