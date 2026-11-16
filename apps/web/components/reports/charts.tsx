'use client';

import { ReactNode } from 'react';
import clsx from 'clsx';
import { PageMeta } from '@/lib/reports-api';
import { barPercent } from '@/lib/reports-logic';
import { Button } from '@/components/ds/Button';
import { Card } from '@/components/ds/Card';

// Small, dependency-free charts: plain boxes sized in percent. Every chart states its content in
// text too (aria-label on the chart, a title on each bar), so nothing is only a picture.

export function ReportCard({ title, hint, children, className }: { title: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <Card className={clsx('space-y-3 p-4', className)}>
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </div>
      {children}
    </Card>
  );
}

export interface ColumnDatum {
  key: string;
  // Under the column (only some are printed when there are many).
  label: string;
  value: number;
  // What a pointer or a screen reader gets for this column.
  title: string;
}

// Vertical bars over time (days, hours). Scrolls sideways inside its own box when there are
// more columns than fit; the page itself never does.
export function ColumnChart({ data, label, emptyText }: { data: ColumnDatum[]; label: string; emptyText: string }) {
  const max = data.reduce((top, row) => Math.max(top, row.value), 0);
  if (data.length === 0 || max <= 0) return <p className="py-6 text-center text-sm text-subtle">{emptyText}</p>;
  // About eight labels, always including the first and the last column.
  const step = Math.max(1, Math.ceil(data.length / 8));
  return (
    <div className="overflow-x-auto" role="img" aria-label={label}>
      <div className="flex min-w-full gap-px" style={{ width: data.length > 62 ? `${data.length * 10}px` : undefined }}>
        {data.map((row, index) => (
          <div key={row.key} className="flex min-w-[6px] flex-1 flex-col items-center gap-1" title={row.title}>
            <div className="flex h-36 w-full items-end rounded-sm bg-surface-2">
              <div
                className={clsx('w-full rounded-sm', row.value > 0 ? 'bg-accent' : 'bg-transparent')}
                style={{ height: `${barPercent(row.value, max)}%` }}
              />
            </div>
            <span className="h-4 whitespace-nowrap text-2xs tabular-nums text-subtle" aria-hidden>
              {index % step === 0 || index === data.length - 1 ? row.label : ''}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export interface BarDatum {
  key: string;
  label: string;
  value: number;
  // Shown at the right of the row ("R$ 155,00").
  display: string;
  hint?: string;
}

// Horizontal bars for a breakdown (by payment method, by origin...).
export function BarList({ data, emptyText }: { data: BarDatum[]; emptyText: string }) {
  const max = data.reduce((top, row) => Math.max(top, row.value), 0);
  if (data.length === 0) return <p className="py-4 text-center text-sm text-subtle">{emptyText}</p>;
  return (
    <ul className="space-y-2.5">
      {data.map((row) => (
        <li key={row.key} className="space-y-1">
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-foreground">
              {row.label}
              {row.hint && <span className="ml-2 text-xs text-muted-foreground">{row.hint}</span>}
            </span>
            <span className="shrink-0 font-medium tabular-nums text-foreground">{row.display}</span>
          </div>
          <div className="h-1.5 rounded-full bg-surface-2" aria-hidden>
            <div className="h-full rounded-full bg-accent" style={{ width: `${barPercent(row.value, max)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function ReportPager({ meta, noun, onPage }: { meta: PageMeta; noun: string; onPage: (page: number) => void }) {
  if (meta.totalPages <= 1) return null;
  return (
    <div className="flex items-center justify-between border-t border-line px-4 py-2.5 text-xs text-muted-foreground">
      <span>
        Página {meta.page} de {meta.totalPages} · {meta.total} {noun}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={meta.page <= 1} onClick={() => onPage(meta.page - 1)}>
          Anterior
        </Button>
        <Button size="sm" variant="outline" disabled={meta.page >= meta.totalPages} onClick={() => onPage(meta.page + 1)}>
          Próxima
        </Button>
      </div>
    </div>
  );
}
