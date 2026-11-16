import fs from 'fs';
import path from 'path';
import manifest from '../app/manifest';
import {
  isStandaloneDisplay,
  newOrdersMessage,
  orderAlertsButton,
  orderAlertsStorageKey,
  shouldNotifyNewOrders,
  shouldRegisterServiceWorker,
} from './pwa';

describe('shouldRegisterServiceWorker', () => {
  const ok = { isProduction: true, isSecureContext: true, hasServiceWorker: true };

  it('registers only on a production build, a secure origin and a capable browser', () => {
    expect(shouldRegisterServiceWorker(ok)).toBe(true);
    expect(shouldRegisterServiceWorker({ ...ok, isProduction: false })).toBe(false);
    expect(shouldRegisterServiceWorker({ ...ok, isSecureContext: false })).toBe(false);
    expect(shouldRegisterServiceWorker({ ...ok, hasServiceWorker: false })).toBe(false);
  });
});

describe('isStandaloneDisplay', () => {
  it('recognises an installed app on any platform', () => {
    expect(isStandaloneDisplay({ matchesStandalone: true })).toBe(true);
    expect(isStandaloneDisplay({ matchesStandalone: false, iosStandalone: true })).toBe(true);
    expect(isStandaloneDisplay({ matchesStandalone: false })).toBe(false);
    expect(isStandaloneDisplay({ matchesStandalone: false, iosStandalone: false })).toBe(false);
  });
});

describe('new-order alerts', () => {
  const base = { enabled: true, permission: 'granted' as const, hidden: true, previous: 2, current: 3 };

  it('notifies when more orders are waiting and nobody is looking', () => {
    expect(shouldNotifyNewOrders(base)).toBe(true);
    expect(shouldNotifyNewOrders({ ...base, previous: 0, current: 1 })).toBe(true);
  });

  it('stays quiet when switched off, not allowed, or the screen is in view', () => {
    expect(shouldNotifyNewOrders({ ...base, enabled: false })).toBe(false);
    expect(shouldNotifyNewOrders({ ...base, permission: 'default' })).toBe(false);
    expect(shouldNotifyNewOrders({ ...base, permission: 'denied' })).toBe(false);
    expect(shouldNotifyNewOrders({ ...base, permission: 'unsupported' })).toBe(false);
    expect(shouldNotifyNewOrders({ ...base, hidden: false })).toBe(false);
  });

  it('never announces what was already there, nor a count that did not grow', () => {
    expect(shouldNotifyNewOrders({ ...base, previous: null, current: 5 })).toBe(false);
    expect(shouldNotifyNewOrders({ ...base, previous: 3, current: 3 })).toBe(false);
    expect(shouldNotifyNewOrders({ ...base, previous: 3, current: 1 })).toBe(false);
  });

  it('words the notification by quantity', () => {
    expect(newOrdersMessage(1)).toEqual({ title: 'Novo pedido', body: '1 pedido aguardando confirmação.' });
    expect(newOrdersMessage(4)).toEqual({ title: 'Novos pedidos', body: '4 pedidos aguardando confirmação.' });
  });

  it('keeps the preference per user', () => {
    expect(orderAlertsStorageKey('u1')).toBe('restaurant-saas:order-alerts:u1');
    expect(orderAlertsStorageKey('u1')).not.toBe(orderAlertsStorageKey('u2'));
  });

  it('describes the switch in each state', () => {
    expect(orderAlertsButton({ enabled: false, permission: 'default' })).toMatchObject({ label: 'Avisar pedidos', active: false, disabled: false });
    expect(orderAlertsButton({ enabled: true, permission: 'granted' })).toMatchObject({ label: 'Avisos ligados', active: true, disabled: false });
    // Switched on earlier, permission revoked since: it is not "on".
    expect(orderAlertsButton({ enabled: true, permission: 'default' })).toMatchObject({ label: 'Avisar pedidos', active: false });
    expect(orderAlertsButton({ enabled: true, permission: 'denied' })).toMatchObject({ label: 'Avisos bloqueados', active: false, disabled: true });
    expect(orderAlertsButton({ enabled: false, permission: 'unsupported' })).toMatchObject({ active: false, disabled: true });
  });
});

describe('web app manifest', () => {
  const data = manifest();
  const publicDir = path.join(__dirname, '..', 'public');

  it('installs the operator dashboard as a standalone app', () => {
    expect(data).toMatchObject({ start_url: '/dashboard', scope: '/', display: 'standalone', lang: 'pt-BR' });
    expect(data.name).toBeTruthy();
    expect((data.short_name ?? '').length).toBeLessThanOrEqual(12);
    expect(data.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
    expect(data.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('offers the sizes a browser needs to install, including a maskable icon', () => {
    const icons = data.icons ?? [];
    expect(icons.some((icon) => icon.sizes === '192x192' && icon.purpose === 'any')).toBe(true);
    expect(icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'any')).toBe(true);
    expect(icons.some((icon) => icon.sizes === '512x512' && icon.purpose === 'maskable')).toBe(true);
  });

  it('every icon and shortcut it names really exists and stays inside the app', () => {
    const files = [...(data.icons ?? []), ...(data.shortcuts ?? []).flatMap((shortcut) => shortcut.icons ?? [])].map((icon) => icon.src);
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      expect(file.startsWith('/icons/')).toBe(true);
      expect(fs.existsSync(path.join(publicDir, file))).toBe(true);
    }
    for (const shortcut of data.shortcuts ?? []) {
      expect(shortcut.url.startsWith('/dashboard/')).toBe(true);
    }
  });

  it('declares the real pixel size of each PNG', () => {
    for (const icon of data.icons ?? []) {
      const png = fs.readFileSync(path.join(publicDir, icon.src));
      // PNG header: width and height are the two big-endian integers at bytes 16 and 20.
      expect(`${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`).toBe(icon.sizes);
    }
  });
});
