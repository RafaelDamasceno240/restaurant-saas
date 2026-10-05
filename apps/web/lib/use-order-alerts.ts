'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { newOrdersMessage, NotificationPermissionState, orderAlertsStorageKey, shouldNotifyNewOrders } from './pwa';

function readPermission(): NotificationPermissionState {
  if (typeof window === 'undefined' || !('Notification' in window)) return 'unsupported';
  return Notification.permission;
}

// "Avisar novos pedidos": a system notification when the number of orders waiting for
// confirmation grows while this screen is not being looked at (another tab, another app, the
// tablet's home screen with the app still open behind).
//
// This is NOT web push: there is no push server, so nothing arrives when the app is closed or
// the device suspended it. It only uses what the open app already knows (the same polling that
// feeds the topbar chip). See docs/PWA.md.
export function useOrderAlerts(userId: string | undefined, pendingCount: number | undefined) {
  const [enabled, setEnabled] = useState(false);
  const [permission, setPermission] = useState<NotificationPermissionState>('default');
  const previous = useRef<number | null>(null);
  const requesting = useRef(false);

  // The preference belongs to this browser and this user; restored after mount.
  useEffect(() => {
    setPermission(readPermission());
    if (!userId) return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(orderAlertsStorageKey(userId));
    } catch {
      stored = null;
    }
    setEnabled(stored === '1');
  }, [userId]);

  const persist = useCallback(
    (value: boolean) => {
      setEnabled(value);
      if (!userId) return;
      try {
        window.localStorage.setItem(orderAlertsStorageKey(userId), value ? '1' : '0');
      } catch {
        // the preference just won't survive a reload
      }
    },
    [userId],
  );

  // Must be called from a click: browsers only ask for the permission on a user gesture.
  const toggle = useCallback(async () => {
    if (requesting.current) return;
    const current = readPermission();
    if (current === 'unsupported' || current === 'denied') {
      setPermission(current);
      return;
    }
    if (enabled && current === 'granted') {
      persist(false);
      return;
    }
    if (current === 'granted') {
      setPermission('granted');
      persist(true);
      return;
    }
    requesting.current = true;
    try {
      const answer = await Notification.requestPermission();
      setPermission(answer);
      persist(answer === 'granted');
    } finally {
      requesting.current = false;
    }
  }, [enabled, persist]);

  useEffect(() => {
    if (pendingCount === undefined) return;
    const notify = shouldNotifyNewOrders({
      enabled,
      permission: readPermission(),
      hidden: document.visibilityState === 'hidden',
      previous: previous.current,
      current: pendingCount,
    });
    previous.current = pendingCount;
    if (!notify) return;
    const { title, body } = newOrdersMessage(pendingCount);
    // One notification, replaced as the count changes (same tag), leading to the orders screen.
    const options = { body, tag: 'pending-orders', icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', data: { path: '/dashboard/pedidos' } };
    const viaPage = () => {
      try {
        new Notification(title, options);
      } catch {
        // some mobile browsers only allow notifications through a service worker
      }
    };
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker
        .getRegistration()
        .then((registration) => (registration ? registration.showNotification(title, options) : viaPage()))
        .catch(viaPage);
    } else {
      viaPage();
    }
  }, [pendingCount, enabled]);

  return { enabled, permission, toggle, active: enabled && permission === 'granted' };
}
