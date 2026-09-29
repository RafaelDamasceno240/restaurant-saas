'use client';

import { ReactNode, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';

export interface DropdownItem {
  label: string;
  icon?: ReactNode;
  onSelect: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export function Dropdown({
  trigger,
  items,
  align = 'right',
  label,
}: {
  trigger: ReactNode;
  items: DropdownItem[];
  align?: 'left' | 'right';
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDown(event: MouseEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative inline-flex">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex rounded-ctl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
      >
        {trigger}
      </button>
      {open && (
        <div
          role="menu"
          className={clsx(
            'absolute top-full z-40 mt-1 min-w-[10rem] animate-pop-in rounded-card border border-line-strong bg-surface-2 p-1 shadow-xl',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {items.map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={clsx(
                'flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-sm transition-colors disabled:opacity-40',
                item.danger ? 'text-danger hover:bg-danger/10' : 'text-foreground hover:bg-surface-hover',
              )}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
