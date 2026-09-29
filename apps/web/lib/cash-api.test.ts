import { formatCents, parseBRLToCents } from './cash-api';

describe('cash-api money helpers', () => {
  it('parses BRL strings to integer cents without float math', () => {
    expect(parseBRLToCents('10,50')).toBe(1050);
    expect(parseBRLToCents('10.5')).toBe(1050);
    expect(parseBRLToCents('R$ 0,10')).toBe(10);
    expect(parseBRLToCents('100')).toBe(10000);
  });

  it('rejects invalid input', () => {
    expect(parseBRLToCents('')).toBeNull();
    expect(parseBRLToCents('abc')).toBeNull();
    expect(parseBRLToCents('10,555')).toBeNull();
    expect(parseBRLToCents('-5')).toBeNull();
  });

  it('formats cents including negative differences', () => {
    expect(formatCents(1050)).toBe('R$ 10,50');
    expect(formatCents(-90)).toBe('-R$ 0,90');
    expect(formatCents(null)).toBe('—');
  });
});
