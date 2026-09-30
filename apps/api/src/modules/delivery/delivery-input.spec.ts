import { createdAtRange, escapeLike, normalizeNotes } from './delivery-input';

describe('normalizeNotes', () => {
  it('trims and keeps real text', () => {
    expect(normalizeNotes('  Portão azul  ')).toBe('Portão azul');
  });

  it('treats blank, null and undefined as "no note"', () => {
    expect(normalizeNotes('')).toBeNull();
    expect(normalizeNotes('   \n ')).toBeNull();
    expect(normalizeNotes(null)).toBeNull();
    expect(normalizeNotes(undefined)).toBeNull();
  });
});

describe('escapeLike', () => {
  it('escapes the LIKE wildcards and the escape character itself', () => {
    expect(escapeLike('50%')).toBe('50\\%');
    expect(escapeLike('a_b')).toBe('a\\_b');
    expect(escapeLike('c:\\dir')).toBe('c:\\\\dir');
  });

  it('leaves ordinary text untouched', () => {
    expect(escapeLike('Maria da Silva 12')).toBe('Maria da Silva 12');
  });
});

describe('createdAtRange', () => {
  it('returns no filter when neither bound is given', () => {
    expect(createdAtRange()).toBeUndefined();
  });

  it('uses ISO instants exactly as sent (the operator timezone is decided by the client)', () => {
    const range = createdAtRange('2026-10-01T03:00:00.000Z', '2026-10-02T02:59:59.999Z');
    expect(range?.gte).toEqual(new Date('2026-10-01T03:00:00.000Z'));
    expect(range?.lte).toEqual(new Date('2026-10-02T02:59:59.999Z'));
  });

  it('turns a bare upper date into the end of that UTC day, so the day is inclusive', () => {
    expect(createdAtRange(undefined, '2026-10-31')?.lte).toEqual(new Date('2026-10-31T23:59:59.999Z'));
  });

  it('keeps a bare lower date at the start of the day', () => {
    expect(createdAtRange('2026-10-01')?.gte).toEqual(new Date('2026-10-01T00:00:00.000Z'));
  });

  it('supports an open-ended range on either side', () => {
    expect(createdAtRange('2026-10-01')?.lte).toBeUndefined();
    expect(createdAtRange(undefined, '2026-10-01')?.gte).toBeUndefined();
  });
});
