import { ReactNode } from 'react';
import clsx from 'clsx';
import { AlertCircle, CheckCircle2, Info, Loader2, TriangleAlert } from 'lucide-react';
import { Button } from './Button';

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={clsx('h-4 w-4 animate-spin text-muted-foreground', className)} aria-hidden />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={clsx('animate-pulse rounded-md bg-surface-hover', className)} aria-hidden />;
}

export function LoadingState({ label = 'Carregando...', className }: { label?: string; className?: string }) {
  return (
    <div
      role="status"
      className={clsx('flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground', className)}
    >
      <Spinner />
      {label}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={clsx(
        'flex flex-col items-center justify-center gap-2 rounded-card border border-dashed border-line-strong px-6 py-10 text-center',
        className,
      )}
    >
      {icon && <div className="mb-1 text-subtle [&>svg]:h-8 [&>svg]:w-8">{icon}</div>}
      <p className="text-sm font-medium text-foreground">{title}</p>
      {description && <p className="max-w-sm text-xs text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({
  message = 'Algo deu errado.',
  onRetry,
  className,
}: {
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={clsx(
        'flex flex-col items-center gap-2 rounded-card border border-danger/30 bg-danger/5 px-6 py-8 text-center',
        className,
      )}
    >
      <AlertCircle className="h-6 w-6 text-danger" aria-hidden />
      <p className="text-sm text-foreground">{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Tentar novamente
        </Button>
      )}
    </div>
  );
}

const ALERT_TONE = {
  danger: { cls: 'border-danger/30 bg-danger/10 text-danger', Icon: AlertCircle },
  warning: { cls: 'border-warning/30 bg-warning/10 text-warning', Icon: TriangleAlert },
  success: { cls: 'border-success/30 bg-success/10 text-success', Icon: CheckCircle2 },
  info: { cls: 'border-info/30 bg-info/10 text-info', Icon: Info },
} as const;

export function Alert({
  tone = 'danger',
  children,
  className,
}: {
  tone?: keyof typeof ALERT_TONE;
  children: ReactNode;
  className?: string;
}) {
  const { cls, Icon } = ALERT_TONE[tone];
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'status'}
      className={clsx('flex items-start gap-2 rounded-ctl border px-3 py-2 text-sm', cls, className)}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
