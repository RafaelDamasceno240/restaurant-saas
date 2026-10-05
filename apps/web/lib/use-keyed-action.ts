'use client';

import { useCallback, useRef, useState } from 'react';
import { ApiError } from './api-client';
import { createIdempotencyKey } from './idempotency-key';

// Runs an operation the server deduplicates by an idempotency key (points, cashback, payments).
//  - a synchronous guard: two clicks in the same tick start one request (React state would
//    still say "not busy" for the second);
//  - ONE key per attempt, reused if the request is retried after a failure without an answer
//    (network drop, timeout): the server then recognises the retry and does not apply it twice;
//  - a new key after a definitive answer (success, or an error the API returned).
export function useKeyedAction<Input, Output>(action: (input: Input, idempotencyKey: string) => Promise<Output>) {
  const keyRef = useRef<string | null>(null);
  const runningRef = useRef(false);
  const [busy, setBusy] = useState(false);

  const run = useCallback(
    async (input: Input): Promise<Output | undefined> => {
      if (runningRef.current) return undefined;
      runningRef.current = true;
      setBusy(true);
      keyRef.current ??= createIdempotencyKey();
      try {
        const output = await action(input, keyRef.current);
        keyRef.current = null;
        return output;
      } catch (error) {
        if (error instanceof ApiError) keyRef.current = null;
        throw error;
      } finally {
        runningRef.current = false;
        setBusy(false);
      }
    },
    [action],
  );

  // Call when the input changes (another reward, another amount): it is a different operation.
  const reset = useCallback(() => {
    keyRef.current = null;
  }, []);

  return { run, busy, reset };
}
