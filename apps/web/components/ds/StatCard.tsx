import { ReactNode } from 'react';
import clsx from 'clsx';
import { Card } from './Card';
import { Skeleton } from './States';

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'neutral',
  loading,
  featured,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  icon?: ReactNode;
  tone?: 'neutral' | 'success' | 'warning' | 'danger' | 'info';
  loading?: boolean;
  /** Highlights the figure that matters most on the page (gold value, brand frame). */
  featured?: boolean;
}) {
  const iconTone = {
    neutral: 'bg-surface-hover text-muted-foreground',
    success: 'bg-success/10 text-success',
    warning: 'bg-warning/10 text-warning',
    danger: 'bg-danger/10 text-danger',
    info: 'bg-info/10 text-info',
  }[tone];
  return (
    <Card className={clsx('p-4', featured && 'border-accent/40')}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        {icon && (
          <span className={clsx('flex h-7 w-7 items-center justify-center rounded-md [&>svg]:h-4 [&>svg]:w-4', iconTone)}>
            {icon}
          </span>
        )}
      </div>
      {loading ? (
        <Skeleton className="mt-2 h-7 w-24" />
      ) : (
        <p className={clsx('mt-1.5 text-2xl font-semibold tracking-tight', featured ? 'text-accent' : 'text-foreground')}>
          {value}
        </p>
      )}
      {hint && <p className="mt-1 text-2xs text-subtle">{hint}</p>}
    </Card>
  );
}
