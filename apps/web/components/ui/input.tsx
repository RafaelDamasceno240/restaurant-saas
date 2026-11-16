import { InputHTMLAttributes, forwardRef } from 'react';
import clsx from 'clsx';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={clsx(
        'w-full rounded-lg border border-line-strong bg-surface-2 px-3 py-2 text-sm text-foreground outline-none placeholder:text-subtle focus:border-accent/70 focus:ring-2 focus:ring-accent/20',
        // Fingers: 44px tall, and 16px text so iOS does not zoom the page on focus.
        'touch:min-h-11 touch:text-base',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
