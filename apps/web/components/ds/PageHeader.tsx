import { ReactNode } from 'react';
import clsx from 'clsx';

// Standard page frame. `Page` gives every screen the same gutter and max
// width; PDV/KDS opt out and fill the viewport instead.
export function Page({ children, className, wide }: { children: ReactNode; className?: string; wide?: boolean }) {
  return (
    <div className={clsx('mx-auto w-full space-y-5 p-4 sm:p-6', wide ? 'max-w-[1400px]' : 'max-w-6xl', className)}>
      {children}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{title}</h1>
        {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}
