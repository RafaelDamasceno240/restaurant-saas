'use client';

import { useCallback, useRef, useState } from 'react';

// Synthesizes a short beep via the Web Audio API — no external audio file,
// no dependency. Browsers block audio (including creating/resuming an
// AudioContext) without a prior user gesture, so `enable()` MUST be called
// from a real click handler; `play()` is a no-op until that has happened.
export function useOrderSound() {
  const audioContextRef = useRef<AudioContext | null>(null);
  const [enabled, setEnabled] = useState(false);

  const enable = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new AudioContext();
    }
    // resume() is itself only allowed following a user gesture — this
    // function must only ever be invoked from one (see the "Ativar som"
    // button in cozinha/page.tsx).
    void audioContextRef.current.resume();
    setEnabled(true);
  }, []);

  const play = useCallback(() => {
    const ctx = audioContextRef.current;
    if (!enabled || !ctx) return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.value = 880;
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    oscillator.start();
    oscillator.stop(ctx.currentTime + 0.4);
  }, [enabled]);

  return { enabled, enable, play };
}
