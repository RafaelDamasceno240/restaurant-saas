import { normalizeInstagram, normalizeState, normalizeZipCode } from './profile-input';

describe('profile input', () => {
  it('stores the Instagram handle without "@" and refuses links and spaces', () => {
    expect(normalizeInstagram('@doce.burger')).toBe('doce.burger');
    expect(normalizeInstagram(' doce_burger ')).toBe('doce_burger');
    expect(normalizeInstagram('https://instagram.com/doce')).toBeNull();
    expect(normalizeInstagram('doce burger')).toBeNull();
    expect(normalizeInstagram('@')).toBeNull();
    expect(normalizeInstagram('a'.repeat(31))).toBeNull();
  });

  it('stores the CEP as 8 digits', () => {
    expect(normalizeZipCode('01310-100')).toBe('01310100');
    expect(normalizeZipCode('01310100')).toBe('01310100');
    expect(normalizeZipCode('1310-100')).toBeNull();
    expect(normalizeZipCode('01310-1000')).toBeNull();
  });

  it('accepts only the 27 Brazilian states, in upper case', () => {
    expect(normalizeState('mg')).toBe('MG');
    expect(normalizeState(' DF ')).toBe('DF');
    expect(normalizeState('XX')).toBeNull();
    expect(normalizeState('Minas')).toBeNull();
  });
});
