import { escapeLike, isValidCpf, normalizeCpf, normalizeEmail, normalizePhone, searchTerms } from './customer-input';

describe('normalizePhone', () => {
  it('keeps only digits', () => {
    expect(normalizePhone('(11) 98765-4321')).toBe('11987654321');
    expect(normalizePhone(' 11 3456-7890 ')).toBe('1134567890');
  });

  it('reduces a Brazilian number typed with the country code to the national one', () => {
    expect(normalizePhone('+55 (11) 98765-4321')).toBe('11987654321');
    expect(normalizePhone('5511987654321')).toBe('11987654321');
    expect(normalizePhone('551134567890')).toBe('1134567890');
  });

  it('does not strip a leading 55 from numbers that are not 12/13 digits', () => {
    expect(normalizePhone('55123456')).toBe('55123456'); // 8 digits: a local number that starts with 55
    expect(normalizePhone('5512345678901')).toBe('12345678901'); // 13 digits -> stripped (country code)
  });

  it('accepts other international lengths as typed, up to 15 digits', () => {
    expect(normalizePhone('+1 415 555 2671')).toBe('14155552671');
    expect(normalizePhone('123456789012345')).toBe('123456789012345');
  });

  it('rejects too short, too long and empty input', () => {
    expect(normalizePhone('1234567')).toBeNull();
    expect(normalizePhone('1234567890123456')).toBeNull();
    expect(normalizePhone('abc')).toBeNull();
    expect(normalizePhone('')).toBeNull();
  });

  it('makes different spellings of the same number identical', () => {
    const variants = ['11987654321', '(11) 98765-4321', '+55 11 98765-4321', '55 11 987654321'];
    expect(new Set(variants.map((v) => normalizePhone(v))).size).toBe(1);
  });
});

describe('normalizeEmail', () => {
  it('trims and lower-cases', () => {
    expect(normalizeEmail('  Maria.Souza@Example.COM ')).toBe('maria.souza@example.com');
  });
});

describe('CPF', () => {
  it('accepts valid CPFs, with or without punctuation', () => {
    expect(isValidCpf('52998224725')).toBe(true);
    expect(normalizeCpf('529.982.247-25')).toBe('52998224725');
    expect(normalizeCpf('111.444.777-35')).toBe('11144477735');
  });

  it('rejects wrong check digits', () => {
    expect(normalizeCpf('529.982.247-24')).toBeNull();
    expect(normalizeCpf('111.444.777-36')).toBeNull();
  });

  it('rejects all-equal sequences, wrong length and non-numeric input', () => {
    expect(normalizeCpf('000.000.000-00')).toBeNull();
    expect(normalizeCpf('11111111111')).toBeNull();
    expect(normalizeCpf('1234567890')).toBeNull();
    expect(normalizeCpf('529982247251')).toBeNull();
    expect(normalizeCpf('abc')).toBeNull();
  });
});

describe('searchTerms', () => {
  it('is null for blank input', () => {
    expect(searchTerms(undefined)).toBeNull();
    expect(searchTerms('   ')).toBeNull();
  });

  it('searches digits only when there are at least three', () => {
    expect(searchTerms('ana')).toEqual({ text: 'ana', digits: null });
    expect(searchTerms('11')).toEqual({ text: '11', digits: null });
    expect(searchTerms('(11) 98')).toEqual({ text: '(11) 98', digits: '1198' });
  });
});

describe('escapeLike', () => {
  it('treats % _ and \\ as plain text', () => {
    expect(escapeLike('100%')).toBe('100\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('a\\b')).toBe('a\\\\b');
  });
});
