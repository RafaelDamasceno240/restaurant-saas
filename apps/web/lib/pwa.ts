// Small, pure decisions of the installable app (docs/PWA.md). The browser APIs themselves are
// used by components/pwa/*; what is here can be unit-tested without a browser.

export const SERVICE_WORKER_URL = '/sw.js';

// The worker is only registered on a production build, on a secure origin (https, or localhost
// for a local `next start`), in a browser that has service workers. In `next dev` a worker would
// keep serving old build files.
export function shouldRegisterServiceWorker(input: { isProduction: boolean; isSecureContext: boolean; hasServiceWorker: boolean }): boolean {
  return input.isProduction && input.isSecureContext && input.hasServiceWorker;
}

// True when the page runs as an installed app (its own window, no browser bar).
export function isStandaloneDisplay(input: { matchesStandalone: boolean; iosStandalone?: boolean }): boolean {
  return input.matchesStandalone || input.iosStandalone === true;
}

export type NotificationPermissionState = 'default' | 'granted' | 'denied' | 'unsupported';

// The per-user switch "avisar novos pedidos" (a preference of this browser, not of the account).
export function orderAlertsStorageKey(userId: string): string {
  return `restaurant-saas:order-alerts:${userId}`;
}

// A system notification is shown only when ALL of these hold: the user switched alerts on, the
// browser allows notifications, the screen is not being looked at (otherwise the topbar chip and
// the kitchen sound already tell), and there are MORE orders waiting than last time we looked.
// `previous === null` is the first reading after opening the app: never a notification, or every
// reload would announce orders that were already there.
export function shouldNotifyNewOrders(input: {
  enabled: boolean;
  permission: NotificationPermissionState;
  hidden: boolean;
  previous: number | null;
  current: number;
}): boolean {
  if (!input.enabled || input.permission !== 'granted' || !input.hidden) return false;
  if (input.previous === null) return false;
  return input.current > input.previous;
}

export function newOrdersMessage(count: number): { title: string; body: string } {
  return count === 1
    ? { title: 'Novo pedido', body: '1 pedido aguardando confirmação.' }
    : { title: 'Novos pedidos', body: `${count} pedidos aguardando confirmação.` };
}

// What the alerts button says and whether pressing it can do anything.
export function orderAlertsButton(input: { enabled: boolean; permission: NotificationPermissionState }): {
  label: string;
  title: string;
  active: boolean;
  disabled: boolean;
} {
  if (input.permission === 'unsupported') {
    return { label: 'Avisos indisponíveis', title: 'Este navegador não mostra notificações.', active: false, disabled: true };
  }
  if (input.permission === 'denied') {
    return {
      label: 'Avisos bloqueados',
      title: 'As notificações deste site estão bloqueadas nas configurações do navegador.',
      active: false,
      disabled: true,
    };
  }
  if (input.enabled && input.permission === 'granted') {
    return { label: 'Avisos ligados', title: 'Avisa quando chega pedido novo e esta tela não está à vista. Toque para desligar.', active: true, disabled: false };
  }
  return { label: 'Avisar pedidos', title: 'Mostrar uma notificação quando chegar pedido novo e esta tela não estiver à vista.', active: false, disabled: false };
}
