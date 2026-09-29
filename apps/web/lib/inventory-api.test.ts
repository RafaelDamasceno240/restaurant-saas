import {
  countDifference,
  formatDate,
  formatPercent,
  formatQuantity,
  formatSignedQuantity,
  parseCostToCents,
  parseQuantity,
} from './inventory-api';

describe('inventory-api helpers', () => {
  it('parses costs to integer cents without float math', () => {
    expect(parseCostToCents('12,50')).toBe(1250);
    expect(parseCostToCents('12.50')).toBe(1250);
    expect(parseCostToCents('R$ 0,1')).toBe(10);
    expect(parseCostToCents('7')).toBe(700);
    expect(parseCostToCents('1,234')).toBeNull();
    expect(parseCostToCents('abc')).toBeNull();
    expect(parseCostToCents('-1')).toBeNull();
  });

  it('parses quantities with at most 3 decimals', () => {
    expect(parseQuantity('1,5')).toBe(1.5);
    expect(parseQuantity('0.150')).toBe(0.15);
    expect(parseQuantity('30')).toBe(30);
    expect(parseQuantity('0,0005')).toBeNull();
    expect(parseQuantity('-2')).toBeNull();
    expect(parseQuantity('')).toBeNull();
  });

  it('formats quantities, signed deltas, percents and dates', () => {
    expect(formatQuantity(2, 'UNIT')).toBe('2 UN');
    expect(formatQuantity(0.15, 'KG')).toBe('0,150 KG');
    expect(formatSignedQuantity(-1.5, 'KG')).toBe('−1,500 KG');
    expect(formatSignedQuantity(3, 'UNIT')).toBe('+3 UN');
    expect(formatPercent(69.9)).toBe('69,9%');
    expect(formatPercent(null)).toBe('—');
    expect(formatDate('2026-10-05T00:00:00.000Z')).toBe('05/10/2026');
  });

  it('previews the count difference rounded to the stock scale', () => {
    expect(countDifference(10, 8.5)).toBe(-1.5);
    expect(countDifference(0.1, 0.3)).toBe(0.2);
    expect(countDifference(4, 4)).toBe(0);
  });
});
