import { ReactNode } from 'react';
import Link from 'next/link';
import clsx from 'clsx';

export type ChipTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

const TONE: Record<ChipTone, string> = {
  neutral: 'border-line bg-surface text-muted-foreground',
  success: 'border-success/30 bg-success/10 text-success',
  warning: 'border-warning/30 bg-warning/10 text-warning',
  danger: 'border-danger/30 bg-danger/10 text-danger',
  info: 'border-info/30 bg-info/10 text-info',
};

// Reusable operational status chip for the topbar ("● Caixa aberto",
// "⏱ 40min", …). Callers pass data; the chip only knows how to look.
export function Chip({
  icon,
  label,
  tone = 'neutral',
  dot,
  href,
  title,
  className,
}: {
  icon?: ReactNode;
  label: ReactNode;
  tone?: ChipTone;
  dot?: boolean;
  href?: string;
  title?: string;
  className?: string;
}) {
  const classes = clsx(
    'inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-medium transition-colors [&>svg]:h-3.5 [&>svg]:w-3.5',
    TONE[tone],
    href && 'hover:brightness-125',
    className,
  );
  const content = (
    <>
      {dot && <span className="h-2 w-2 rounded-full bg-current" aria-hidden />}
      {icon}
      {label}
    </>
  );
  return href ? (
    <Link href={href} title={title} className={classes}>
      {content}
    </Link>
  ) : (
    <span title={title} className={classes}>
      {content}
    </span>
  );
}
