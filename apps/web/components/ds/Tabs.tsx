import { ReactNode } from 'react';
import clsx from 'clsx';

export interface TabItem<K extends string> {
  key: K;
  label: string;
  count?: number;
  icon?: ReactNode;
}

// Underline tabs (page sections). `variant="pill"` renders segmented
// controls (PDV modes, table filters).
export function Tabs<K extends string>({
  items,
  value,
  onChange,
  variant = 'underline',
  className,
}: {
  items: TabItem<K>[];
  value: K;
  onChange: (key: K) => void;
  variant?: 'underline' | 'pill';
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={clsx(
        'flex gap-1 overflow-x-auto overflow-y-hidden',
        variant === 'underline' ? 'border-b border-line' : 'w-max max-w-full rounded-ctl bg-surface-2 p-1',
        className,
      )}
    >
      {items.map((item) => {
        const active = item.key === value;
        return (
          <button
            key={item.key}
            role="tab"
            type="button"
            aria-selected={active}
            onClick={() => onChange(item.key)}
            className={clsx(
              'inline-flex shrink-0 items-center gap-2 whitespace-nowrap text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50',
              variant === 'underline'
                ? clsx(
                    '-mb-px border-b-2 px-3 py-2.5',
                    active ? 'border-accent text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
                  )
                : clsx(
                    'rounded-md px-3 py-1.5',
                    active ? 'bg-surface-hover text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
                  ),
            )}
          >
            {item.icon}
            {item.label}
            {item.count !== undefined && (
              <span
                className={clsx(
                  'rounded-full px-1.5 py-px text-2xs font-semibold',
                  active ? 'bg-accent/15 text-accent' : 'bg-surface-hover text-muted-foreground',
                )}
              >
                {item.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
