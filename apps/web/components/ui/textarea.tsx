import { TextareaHTMLAttributes, forwardRef } from 'react';
import clsx from 'clsx';

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => (
    <textarea
      ref={ref}
      rows={3}
      className={clsx(
        'w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm text-foreground outline-none placeholder:text-subtle focus:border-accent/70 focus:ring-2 focus:ring-accent/20',
        // 16px text on touch devices: iOS zooms the page when a focused field has smaller text.
        'touch:text-base',
        className,
      )}
      {...props}
    />
  ),
);
Textarea.displayName = 'Textarea';
