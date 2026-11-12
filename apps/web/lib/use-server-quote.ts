'use client';

import { useEffect, useRef, useState } from 'react';
import { ApiError } from './api-client';
import { ItemsQuote, quoteKey, toApiLine } from './staff-addons';

type ApiLine = ReturnType<typeof toApiLine>;

export interface ServerQuoteState {
  // The server's prices for EXACTLY the current lines, or null while they are being asked for
  // (or when the last answer was an error).
  quote: ItemsQuote | null;
  pending: boolean;
  // Why the server refused these lines (an add-on sold out meanwhile, a required group...).
  error: string | null;
}

// Asks the API what the current lines cost, a moment after the last change (one request per
// pause, not per tap). The screen shows the server's numbers when they match what it holds and
// its own estimate, marked as such, in between. The sale itself is priced again on the server.
export function useServerQuote(
  lines: ApiLine[],
  fetcher: ((lines: ApiLine[]) => Promise<ItemsQuote>) | null,
  delayMs = 350,
): ServerQuoteState {
  const key = quoteKey(lines);
  const [answer, setAnswer] = useState<{ key: string; quote: ItemsQuote | null; error: string | null } | null>(null);
  const linesRef = useRef(lines);
  linesRef.current = lines;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;
  const enabled = !!fetcher && lines.length > 0;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      const run = fetcherRef.current;
      if (!run) return;
      run(linesRef.current)
        .then((quote) => {
          if (!cancelled) setAnswer({ key, quote, error: null });
        })
        .catch((err) => {
          if (cancelled) return;
          // A refusal about the lines is worth showing; a network blip or a rate limit is not
          // (the estimate stays on screen and the sale re-checks everything anyway).
          const message = err instanceof ApiError && err.statusCode === 400 ? err.message : null;
          setAnswer({ key, quote: null, error: message });
        });
    }, delayMs);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [key, enabled, delayMs]);

  if (!enabled) return { quote: null, pending: false, error: null };
  const current = answer?.key === key ? answer : null;
  return { quote: current?.quote ?? null, pending: !current, error: current?.error ?? null };
}
