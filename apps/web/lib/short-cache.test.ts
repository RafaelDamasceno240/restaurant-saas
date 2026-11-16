import { shortCache } from './short-cache';

describe('shortCache', () => {
  let clock = 0;
  const now = () => clock;
  beforeEach(() => {
    clock = 0;
  });

  it('shares one call per key while it is fresh, and calls again after', async () => {
    const load = jest.fn(async (key: string) => `${key}@${clock}`);
    const get = shortCache(load, { ttlMs: 10_000, maxEntries: 10, now });
    expect(await get('doce')).toBe('doce@0');
    clock = 9_999;
    expect(await get('doce')).toBe('doce@0');
    expect(load).toHaveBeenCalledTimes(1);
    expect(await get('outro')).toBe('outro@9999');
    clock = 10_000;
    expect(await get('doce')).toBe('doce@10000');
    expect(load).toHaveBeenCalledTimes(3);
  });

  it('does not keep failures', async () => {
    let fail = true;
    const load = jest.fn(async () => {
      if (fail) throw new Error('down');
      return 'ok';
    });
    const get = shortCache(load, { ttlMs: 10_000, maxEntries: 10, now });
    await expect(get('doce')).rejects.toThrow('down');
    fail = false;
    expect(await get('doce')).toBe('ok');
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('keeps at most maxEntries keys, dropping the oldest', async () => {
    const load = jest.fn(async (key: string) => key);
    const get = shortCache(load, { ttlMs: 10_000, maxEntries: 2, now });
    await get('a');
    await get('b');
    await get('c');
    await get('b');
    expect(load).toHaveBeenCalledTimes(3);
    await get('a');
    expect(load).toHaveBeenCalledTimes(4);
  });
});
