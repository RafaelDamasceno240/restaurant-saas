import { ButtonHTMLAttributes, forwardRef, ReactNode } from 'react';
import clsx from 'clsx';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger' | 'danger-ghost';
export type ButtonSize = 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-primary text-primary-foreground hover:bg-primary-hover font-semibold',
  secondary: 'bg-surface-hover text-foreground hover:bg-line font-medium',
  outline: 'border border-line-strong bg-transparent text-foreground hover:bg-surface-hover font-medium',
  ghost: 'bg-transparent text-muted-foreground hover:bg-surface-hover hover:text-foreground font-medium',
  danger: 'bg-danger text-danger-foreground hover:bg-danger/85 font-semibold',
  'danger-ghost': 'bg-transparent text-danger hover:bg-danger/10 font-medium',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'h-8 gap-1.5 px-3 text-xs',
  md: 'h-9 gap-2 px-3.5 text-sm',
  lg: 'h-12 gap-2 px-5 text-base',
  icon: 'h-9 w-9',
  'icon-sm': 'h-7 w-7',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  icon?: ReactNode;
  fullWidth?: boolean;
}

// Unlike components/ui/button.tsx (light theme, used by the public pages), the
// variant here fully owns the colors — callers pick a `variant`, they don't
// override classes, so there is no Tailwind class-order surprise.
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading, icon, fullWidth, className, children, disabled, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      className={clsx(
        'inline-flex shrink-0 select-none items-center justify-center whitespace-nowrap rounded-ctl transition-colors duration-150',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-background',
        'disabled:cursor-not-allowed disabled:opacity-50 active:scale-[0.98]',
        VARIANT[variant],
        SIZE[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : icon}
      {children}
    </button>
  );
});
