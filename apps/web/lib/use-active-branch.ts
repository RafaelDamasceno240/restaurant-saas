'use client';

import { createContext, createElement, ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from './auth-context';
import { AccessibleBranch, listAccessibleBranches } from './branches-api';

// The "active branch" is a UX convenience only: the selected id is sent with
// each PDV/Caixa request and the BACKEND re-validates it every time
// (BranchAccessService). The localStorage key is per-user, so a different
// account in the same browser never inherits someone else's selection.
//
// State lives in ONE provider mounted by the dashboard layout, so the global
// branch picker in the topbar and every page (PDV, Caixa, Mesas) always agree
// on the selection. The selection logic itself is unchanged.
interface ActiveBranchValue {
  branches: AccessibleBranch[];
  branchId: string | null;
  setBranchId: (id: string) => void;
  isLoading: boolean;
  isError: boolean;
}

const ActiveBranchContext = createContext<ActiveBranchValue | null>(null);

export function ActiveBranchProvider({ children }: { children: ReactNode }) {
  const { user, accessToken } = useAuth();
  const storageKey = user ? `restaurant-saas:active-branch:${user.id}` : null;
  const [selected, setSelected] = useState<string | null>(null);

  const query = useQuery({
    queryKey: ['accessible-branches'],
    queryFn: () => listAccessibleBranches(accessToken as string),
    enabled: !!accessToken,
  });
  const branches = useMemo(() => query.data ?? [], [query.data]);

  useEffect(() => {
    if (!storageKey || branches.length === 0) return;
    let stored: string | null = null;
    try {
      stored = window.localStorage.getItem(storageKey);
    } catch {
      stored = null;
    }
    const valid = branches.find((b) => b.id === stored);
    setSelected(valid ? valid.id : branches[0].id);
  }, [storageKey, branches]);

  const value = useMemo<ActiveBranchValue>(
    () => ({
      branches,
      branchId: selected,
      setBranchId: (id: string) => {
        setSelected(id);
        if (storageKey) {
          try {
            window.localStorage.setItem(storageKey, id);
          } catch {
            // storage unavailable — selection still works for this session
          }
        }
      },
      isLoading: query.isLoading,
      isError: query.isError,
    }),
    [branches, selected, storageKey, query.isLoading, query.isError],
  );

  return createElement(ActiveBranchContext.Provider, { value }, children);
}

export function useActiveBranch(): ActiveBranchValue {
  const ctx = useContext(ActiveBranchContext);
  if (!ctx) {
    throw new Error('useActiveBranch must be used within an ActiveBranchProvider');
  }
  return ctx;
}
