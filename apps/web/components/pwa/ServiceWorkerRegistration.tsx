'use client';

import { useEffect } from 'react';
import { SERVICE_WORKER_URL, shouldRegisterServiceWorker } from '@/lib/pwa';

// Registers public/sw.js once the page has loaded (never competing with the first render).
// Production builds only; see lib/pwa.ts and docs/PWA.md for what the worker does and does not.
export function ServiceWorkerRegistration() {
  useEffect(() => {
    const allowed = shouldRegisterServiceWorker({
      isProduction: process.env.NODE_ENV === 'production',
      isSecureContext: window.isSecureContext,
      hasServiceWorker: 'serviceWorker' in navigator,
    });
    if (!allowed) return;
    const register = () => {
      // A failed registration only means "no offline page, no install": the app works the same.
      navigator.serviceWorker.register(SERVICE_WORKER_URL, { scope: '/' }).catch(() => undefined);
    };
    if (document.readyState === 'complete') {
      register();
      return;
    }
    window.addEventListener('load', register, { once: true });
    return () => window.removeEventListener('load', register);
  }, []);

  return null;
}
