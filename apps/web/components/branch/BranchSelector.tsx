'use client';

import { MapPin } from 'lucide-react';
import { AccessibleBranch } from '@/lib/branches-api';
import { Select } from '@/components/ds/Input';
import { Chip } from '@/components/shell/Chip';

// Compact unit picker for the topbar. One accessible branch renders as a
// read-only chip; several render as a select.
export function BranchSelector({
  branches,
  value,
  onChange,
  disabled,
}: {
  branches: AccessibleBranch[];
  value: string | null;
  onChange: (id: string) => void;
  disabled?: boolean;
}) {
  if (branches.length === 0) return null;
  if (branches.length === 1) {
    return <Chip icon={<MapPin />} label={branches[0].name} title="Unidade" />;
  }
  return (
    <div className="flex items-center gap-1.5">
      <MapPin className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      <Select
        aria-label="Unidade"
        className="h-8 max-w-[11rem] rounded-full py-0 text-xs"
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
      >
        {branches.map((b) => (
          <option key={b.id} value={b.id}>
            {b.name}
          </option>
        ))}
      </Select>
    </div>
  );
}
