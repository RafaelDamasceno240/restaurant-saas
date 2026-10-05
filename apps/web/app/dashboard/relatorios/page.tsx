'use client';

import { useMemo, useState } from 'react';
import { BarChart3 } from 'lucide-react';
import { useAuth } from '@/lib/auth-context';
import { addDaysToDateOnly, localDateOnly } from '@/lib/receivables-logic';
import { ReportFilters } from '@/lib/reports-api';
import {
  DateRange,
  MAX_PERIOD_DAYS,
  PERIOD_PRESET_LABEL,
  PERIOD_PRESETS,
  PeriodPreset,
  presetOf,
  presetRange,
  REPORT_TABS,
  ReportTab,
  validateRange,
} from '@/lib/reports-logic';
import { useActiveBranch } from '@/lib/use-active-branch';
import { Card } from '@/components/ds/Card';
import { Field, Input, Select } from '@/components/ds/Input';
import { Page, PageHeader } from '@/components/ds/PageHeader';
import { Alert, EmptyState } from '@/components/ds/States';
import { Tabs } from '@/components/ds/Tabs';
import { CashPanel, DeliveryPanel, InventoryPanel } from '@/components/reports/OperationsPanels';
import { CustomersPanel, ProductsPanel, SalesPanel } from '@/components/reports/SalesPanels';

// The API decides (reports.read: owner, administrator, manager); this only avoids showing a
// screen whose every request would be refused.
const CAN_READ = ['OWNER', 'ADMIN', 'MANAGER'];
const ALL_BRANCHES = 'all';

export default function ReportsPage() {
  const { user } = useAuth();
  const { branches } = useActiveBranch();
  const canRead = (user?.roles ?? []).some((role) => CAN_READ.includes(role));

  const today = localDateOnly();
  const [tab, setTab] = useState<ReportTab>('sales');
  const [range, setRange] = useState<DateRange>(() => presetRange('30d', today));
  const [branch, setBranch] = useState<string>(ALL_BRANCHES);

  const preset = presetOf(range, today);
  const problem = validateRange(range);
  // The reports are only asked for with a period the API would accept; while the dates being
  // typed are not one, the last valid period stays on screen.
  const [applied, setApplied] = useState<DateRange>(range);
  if (!problem && (applied.from !== range.from || applied.to !== range.to)) setApplied(range);

  const filters = useMemo<ReportFilters>(
    () => ({ from: applied.from, to: applied.to, ...(branch !== ALL_BRANCHES ? { branchId: branch } : {}) }),
    [applied.from, applied.to, branch],
  );

  if (!canRead) {
    return (
      <Page>
        <EmptyState icon={<BarChart3 />} title="Sem acesso a Relatórios" description="Somente proprietários, administradores e gerentes acessam os relatórios." />
      </Page>
    );
  }

  return (
    <Page wide>
      <PageHeader title="Relatórios" description="Vendas, produtos, clientes, estoque, delivery e caixa do período, no horário do restaurante." />

      <Card className="grid gap-3 p-3 sm:grid-cols-2 lg:grid-cols-[14rem_11rem_11rem_minmax(0,1fr)]">
        <Field label="Período">
          <Select
            aria-label="Período"
            value={preset}
            onChange={(event) => {
              const next = event.target.value as PeriodPreset;
              if (next !== 'custom') setRange(presetRange(next, today));
            }}
          >
            {PERIOD_PRESETS.map((key) => (
              <option key={key} value={key} disabled={key === 'custom' && preset !== 'custom'}>
                {PERIOD_PRESET_LABEL[key]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="De">
          <Input
            type="date"
            aria-label="Data inicial"
            value={range.from}
            max={range.to || today}
            min={range.to ? addDaysToDateOnly(range.to, -(MAX_PERIOD_DAYS - 1)) : undefined}
            onChange={(event) => setRange({ ...range, from: event.target.value })}
          />
        </Field>
        <Field label="Até">
          <Input
            type="date"
            aria-label="Data final"
            value={range.to}
            min={range.from || undefined}
            max={today}
            onChange={(event) => setRange({ ...range, to: event.target.value })}
          />
        </Field>
        <Field label="Unidade">
          <Select aria-label="Unidade" value={branch} onChange={(event) => setBranch(event.target.value)}>
            <option value={ALL_BRANCHES}>{branches.length > 1 ? 'Todas as minhas unidades' : 'Todas as unidades'}</option>
            {branches.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </Select>
        </Field>
      </Card>

      {problem && <Alert tone="warning">{problem} Mostrando o último período válido.</Alert>}

      <Tabs value={tab} onChange={setTab} items={REPORT_TABS} />

      {tab === 'sales' && <SalesPanel filters={filters} />}
      {tab === 'products' && <ProductsPanel filters={filters} />}
      {tab === 'customers' && <CustomersPanel filters={filters} />}
      {tab === 'inventory' && <InventoryPanel filters={filters} />}
      {tab === 'delivery' && <DeliveryPanel filters={filters} />}
      {tab === 'cash' && <CashPanel filters={filters} />}
    </Page>
  );
}
