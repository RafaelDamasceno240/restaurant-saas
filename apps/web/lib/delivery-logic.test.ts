import { addressSummary, centsToInput, DELIVERY_STATUS_LABEL } from './delivery-logic';
import { costToCents } from './purchases-logic';

const base = {
  street: 'Rua das Flores',
  number: '120',
  complement: null,
  neighborhood: 'Centro',
  city: 'São Paulo',
  state: 'SP',
  zipCode: '01310-100',
};

describe('addressSummary', () => {
  it('joins street, number, neighborhood and city/state', () => {
    expect(addressSummary(base)).toBe('Rua das Flores, 120 — Centro, São Paulo/SP');
  });

  it('includes the complement when present', () => {
    expect(addressSummary({ ...base, complement: 'Ap 4' })).toBe('Rua das Flores, 120 · Ap 4 — Centro, São Paulo/SP');
  });

  it('does not leave dangling separators when parts are missing', () => {
    expect(addressSummary({ ...base, number: '', neighborhood: '', city: 'Campinas', state: '' })).toBe(
      'Rua das Flores — Campinas',
    );
  });
});

describe('centsToInput', () => {
  it('formats integer cents as a decimal-comma string', () => {
    expect(centsToInput(0)).toBe('0,00');
    expect(centsToInput(5)).toBe('0,05');
    expect(centsToInput(500)).toBe('5,00');
    expect(centsToInput(123456)).toBe('1234,56');
  });

  it('round-trips through the money parser used by the inputs', () => {
    for (const cents of [0, 1, 99, 100, 550, 100000]) {
      expect(costToCents(centsToInput(cents))).toBe(cents);
    }
  });
});

describe('DELIVERY_STATUS_LABEL', () => {
  it('has a label for every status', () => {
    expect(Object.keys(DELIVERY_STATUS_LABEL).sort()).toEqual(['CANCELLED', 'DELIVERED', 'OUT_FOR_DELIVERY', 'PENDING']);
  });
});
