import { durationToMs, hashToken } from './token.util';

describe('token.util', () => {
  it('parses supported duration units', () => {
    expect(durationToMs('15m')).toBe(15 * 60_000);
    expect(durationToMs('7d')).toBe(7 * 86_400_000);
    expect(durationToMs('1h')).toBe(3_600_000);
    expect(durationToMs('30s')).toBe(30_000);
  });

  it('rejects an unsupported format', () => {
    expect(() => durationToMs('7')).toThrow();
    expect(() => durationToMs('7 days')).toThrow();
  });

  it('hashes deterministically and differently per input', () => {
    const a = hashToken('token-a');
    const b = hashToken('token-a');
    const c = hashToken('token-b');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toHaveLength(64); // sha256 hex
  });
});
