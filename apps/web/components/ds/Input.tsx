import {
  forwardRef,
  InputHTMLAttributes,
  ReactNode,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
} from 'react';
import clsx from 'clsx';
import { ChevronDown, Search } from 'lucide-react';

const CONTROL =
  'w-full rounded-ctl border border-line bg-surface-2 text-sm text-foreground placeholder:text-subtle outline-none transition-colors ' +
  'hover:border-line-strong focus:border-accent/70 focus:ring-2 focus:ring-accent/20 disabled:cursor-not-allowed disabled:opacity-50';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...props },
  ref,
) {
  return <input ref={ref} className={clsx(CONTROL, 'h-9 px-3', className)} {...props} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...props }, ref) {
    return <textarea ref={ref} rows={3} className={clsx(CONTROL, 'px-3 py-2', className)} {...props} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...props },
  ref,
) {
  return (
    <div className="relative">
      <select ref={ref} className={clsx(CONTROL, 'h-9 appearance-none pl-3 pr-8', className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
    </div>
  );
});

export const SearchInput = forwardRef<
  HTMLInputElement,
  InputHTMLAttributes<HTMLInputElement> & { large?: boolean }
>(function SearchInput({ className, large, ...props }, ref) {
  return (
    <div className="relative">
      <Search
        className={clsx(
          'pointer-events-none absolute top-1/2 -translate-y-1/2 text-subtle',
          large ? 'left-4 h-5 w-5' : 'left-3 h-4 w-4',
        )}
        aria-hidden
      />
      <input
        ref={ref}
        type="search"
        className={clsx(CONTROL, large ? 'h-12 pl-11 pr-4 text-base' : 'h-9 pl-9 pr-3', className)}
        {...props}
      />
    </div>
  );
});

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={clsx('block space-y-1', className)}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
      {hint && <span className="block text-2xs text-subtle">{hint}</span>}
    </label>
  );
}
