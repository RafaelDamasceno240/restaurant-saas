'use client';

import { useSyncExternalStore } from 'react';

// Chrome/Edge/Android fire `beforeinstallprompt` once, when they consider the app installable,
// and it may happen before any component is mounted. This module starts listening as soon as it
// is loaded and keeps the event, so the "Instalar app" button can show up whenever it mounts.
// Safari has no such event: there the user installs from the share menu (docs/PWA.md).
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the browser's own mini-infobar from showing; the app offers its own button.
    event.preventDefault();
    deferred = event as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    emit();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

// `canInstall` is true only while the browser is offering installation. `install()` shows the
// browser's own confirmation; the event can be used once, so it is dropped either way.
export function useInstallPrompt() {
  const canInstall = useSyncExternalStore(
    subscribe,
    () => deferred !== null,
    () => false,
  );

  async function install(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    const event = deferred;
    if (!event) return 'unavailable';
    deferred = null;
    emit();
    await event.prompt();
    const choice = await event.userChoice;
    return choice.outcome;
  }

  return { canInstall, install };
}
