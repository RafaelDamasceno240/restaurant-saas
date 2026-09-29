import { ReactNode } from 'react';
import clsx from 'clsx';

// CSS-only tooltip: no portal, no JS. Fine for icon buttons and the
// collapsed sidebar; not meant for long or interactive content.
export function Tooltip({
  label,
  side = 'top',
  children,
  className,
  disabled,
}: {
  label: string;
  side?: 'top' | 'bottom' | 'right';
  children: ReactNode;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <span className={clsx('group/tip relative inline-flex', className)}>
      {children}
      {!disabled && (
        <span
          role="tooltip"
          className={clsx(
            'pointer-events-none absolute z-50 whitespace-nowrap rounded-md border border-line-strong bg-surface-2 px-2 py-1 text-xs font-medium text-foreground opacity-0 shadow-lg',
            'transition-opacity duration-150 group-hover/tip:opacity-100 group-focus-within/tip:opacity-100',
            side === 'top' && 'bottom-full left-1/2 mb-1.5 -translate-x-1/2',
            side === 'bottom' && 'left-1/2 top-full mt-1.5 -translate-x-1/2',
            side === 'right' && 'left-full top-1/2 ml-2 -translate-y-1/2',
          )}
        >
          {label}
        </span>
      )}
    </span>
  );
}
