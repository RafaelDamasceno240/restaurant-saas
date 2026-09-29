'use client';

import { useEffect, useState } from 'react';

function computeMinutes(createdAt: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 60_000));
}

// Recomputed on an interval purely for display — createdAt itself never
// changes, and nothing here is persisted or refetched from the server.
export function useElapsedMinutes(createdAt: string): number {
  const [minutes, setMinutes] = useState(() => computeMinutes(createdAt));

  useEffect(() => {
    setMinutes(computeMinutes(createdAt));
    const interval = setInterval(() => setMinutes(computeMinutes(createdAt)), 15_000);
    return () => clearInterval(interval);
  }, [createdAt]);

  return minutes;
}
