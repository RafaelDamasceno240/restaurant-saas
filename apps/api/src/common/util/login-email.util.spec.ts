import { findAccountIdByLoginEmail, normalizeLoginEmail, toLoginEmail } from './login-email.util';

describe('login e-mail', () => {
  it('is trimmed and lower-cased', () => {
    expect(normalizeLoginEmail('  Ana.Caixa@Example.COM ')).toBe('ana.caixa@example.com');
    expect(toLoginEmail({ value: ' X@Y.com' })).toBe('x@y.com');
    expect(toLoginEmail({ value: 42 })).toBe(42);
  });

  const db = (rows: { id: string; email: string }[]) => ({
    $queryRaw: jest.fn().mockResolvedValue(rows),
  });

  it('picks the only account, whatever the spelling typed', async () => {
    const one = db([{ id: 'a', email: 'Ana@x.com' }]);
    await expect(findAccountIdByLoginEmail(one as never, 'ANA@X.COM')).resolves.toBe('a');
    await expect(findAccountIdByLoginEmail(db([]) as never, 'ana@x.com')).resolves.toBeNull();
  });

  it('with two legacy accounts, picks the exact spelling or none', async () => {
    const two = db([
      { id: 'upper', email: 'Ana@x.com' },
      { id: 'lower', email: 'ana@x.com' },
    ]);
    await expect(findAccountIdByLoginEmail(two as never, ' Ana@x.com ')).resolves.toBe('upper');
    await expect(findAccountIdByLoginEmail(two as never, 'ana@x.com')).resolves.toBe('lower');
    await expect(findAccountIdByLoginEmail(two as never, 'ANA@X.COM')).resolves.toBeNull();
  });
});
