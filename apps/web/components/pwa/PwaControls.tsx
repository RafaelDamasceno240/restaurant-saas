'use client';

import clsx from 'clsx';
import { BellOff, BellRing, Download, WifiOff } from 'lucide-react';
import { useInstallPrompt } from '@/lib/install-prompt';
import { NotificationPermissionState, orderAlertsButton } from '@/lib/pwa';
import { useOnlineStatus } from '@/lib/use-online-status';

const CHIP_BUTTON =
  'inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 disabled:cursor-not-allowed disabled:opacity-60 touch:h-10 [&>svg]:h-3.5 [&>svg]:w-3.5';

// "Instalar app": shown only while the browser is offering installation (never on a browser
// that cannot install, never once installed).
export function InstallAppButton() {
  const { canInstall, install } = useInstallPrompt();
  if (!canInstall) return null;
  return (
    <button
      type="button"
      onClick={() => void install()}
      title="Instalar o painel neste aparelho, como um aplicativo"
      className={clsx(CHIP_BUTTON, 'border-accent/40 bg-accent/10 text-accent hover:brightness-125')}
    >
      <Download aria-hidden />
      Instalar app
    </button>
  );
}

// The switch for new-order notifications (state and behaviour in lib/use-order-alerts.ts).
export function OrderAlertsButton({
  enabled,
  permission,
  onToggle,
}: {
  enabled: boolean;
  permission: NotificationPermissionState;
  onToggle: () => void;
}) {
  const view = orderAlertsButton({ enabled, permission });
  // A browser without notifications gets no dead control in the topbar.
  if (permission === 'unsupported') return null;
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={view.disabled}
      aria-pressed={view.active}
      title={view.title}
      className={clsx(
        CHIP_BUTTON,
        view.active ? 'border-success/30 bg-success/10 text-success' : 'border-line bg-surface text-muted-foreground hover:brightness-125',
      )}
    >
      {view.active ? <BellRing aria-hidden /> : <BellOff aria-hidden />}
      {view.label}
    </button>
  );
}

// A thin bar under the topbar while the device has no network at all. It does not block
// anything: requests fail and are reported by each screen as before; this only explains why.
export function OfflineBanner() {
  const online = useOnlineStatus();
  if (online) return null;
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-2 border-b border-warning/30 bg-warning/10 px-4 py-2 text-xs font-medium text-warning">
      <WifiOff className="h-4 w-4 shrink-0" aria-hidden />
      <span>Sem conexão. Vendas, pedidos e recebimentos só valem depois que o sistema confirmar.</span>
    </div>
  );
}
