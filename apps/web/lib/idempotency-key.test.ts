import { createIdempotencyKey } from './idempotency-key';

const KEY_FORMAT = /^[A-Za-z0-9_-]{8,100}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('createIdempotencyKey', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

  afterEach(() => {
    if (original) Object.defineProperty(globalThis, 'crypto', original);
    jest.restoreAllMocks();
  });

  function stubCrypto(value: unknown) {
    Object.defineProperty(globalThis, 'crypto', { value, configurable: true });
  }

  it('uses crypto.randomUUID when available', () => {
    stubCrypto({ randomUUID: () => '11111111-2222-4333-8444-555555555555' });
    expect(createIdempotencyKey()).toBe('11111111-2222-4333-8444-555555555555');
  });

  it('falls back to getRandomValues when randomUUID is missing', () => {
    stubCrypto({
      getRandomValues: (bytes: Uint8Array) => {
        bytes.fill(0xab);
        return bytes;
      },
    });
    const key = createIdempotencyKey();
    expect(key).toMatch(UUID_V4);
    expect(key).toMatch(KEY_FORMAT);
  });

  it('falls back to Math.random when crypto is unavailable', () => {
    stubCrypto(undefined);
    const key = createIdempotencyKey();
    expect(key).toMatch(UUID_V4);
  });

  it('does not throw when crypto throws', () => {
    stubCrypto({
      randomUUID: () => {
        throw new Error('insecure context');
      },
    });
    expect(() => createIdempotencyKey()).not.toThrow();
    expect(createIdempotencyKey()).toMatch(UUID_V4);
  });

  it('generates different keys on each call', () => {
    stubCrypto(undefined);
    expect(createIdempotencyKey()).not.toBe(createIdempotencyKey());
  });
});
