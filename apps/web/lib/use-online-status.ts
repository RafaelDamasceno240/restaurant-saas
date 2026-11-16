'use client';

import { useSyncExternalStore } from 'react';

function subscribe(listener: () => void) {
  window.addEventListener('online', listener);
  window.addEventListener('offline', listener);
  return () => {
    window.removeEventListener('online', listener);
    window.removeEventListener('offline', listener);
  };
}

// Whether the device reports a network connection. `false` is reliable (no network at all);
// `true` only means "some network", not that the server is reachable, so the screens keep
// handling request errors as before. Rendered as online on the server and on first paint.
export function useOnlineStatus(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => navigator.onLine,
    () => true,
  );
}
