import { ReactNode } from 'react';
import clsx from 'clsx';

export type BadgeTone = 'neutral' | 'brand' | 'primary' | 'success' | 'warning' | 'danger' | 'info';

const TONE: Record<BadgeTone, string> = {
  neutral: 'bg-surface-hover text-muted-foreground ring-line-strong',
  // dourado — highlight (new orders, sources)
  brand: 'bg-accent/10 text-accent ring-accent/30',
  // caramelo — active / in progress
  primary: 'bg-primary/25 text-brand-muted ring-primary/50',
  success: 'bg-success/10 text-success ring-success/25',
  warning: 'bg-warning/10 text-warning ring-warning/25',
  danger: 'bg-danger/10 text-danger ring-danger/25',
  info: 'bg-info/10 text-info ring-info/25',
};

export function Badge({
  tone = 'neutral',
  dot,
  children,
  className,
}: {
  tone?: BadgeTone;
  dot?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={clsx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-2xs font-medium ring-1 ring-inset',
        TONE[tone],
        className,
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {children}
    </span>
  );
}
