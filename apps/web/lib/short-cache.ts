// Keeps the result of `load(key)` for `ttlMs`, so many visitors (and many pages of one visit)
// share one call. Only successes are kept: a failure is retried by the next caller. Keys come
// from URLs anyone can type, so at most `maxEntries` are kept (the oldest goes first).
export function shortCache<T>(
  load: (key: string) => Promise<T>,
  { ttlMs, maxEntries, now = Date.now }: { ttlMs: number; maxEntries: number; now?: () => number },
): (key: string) => Promise<T> {
  const entries = new Map<string, { at: number; value: Promise<T> }>();
  return (key) => {
    const hit = entries.get(key);
    if (hit && now() - hit.at < ttlMs) return hit.value;
    entries.delete(key);
    const value = load(key);
    entries.set(key, { at: now(), value });
    value.catch(() => {
      if (entries.get(key)?.value === value) entries.delete(key);
    });
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value as string);
    return value;
  };
}
