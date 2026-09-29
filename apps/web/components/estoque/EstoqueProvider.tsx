'use client';

import { createContext, ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { useAuth } from '@/lib/auth-context';
import { InventoryItem } from '@/lib/inventory-api';
import { useActiveBranch } from '@/lib/use-active-branch';
import { ItemDialog } from './ItemDialog';
import { EntryDialog, ExitDialog } from './MovementDialogs';
import { useInventoryItems, useRefreshInventory } from './use-inventory';

const MANAGER_ROLES = ['OWNER', 'ADMIN', 'MANAGER'];

type OpenDialog =
  | { kind: 'entry'; itemId: string | null }
  | { kind: 'exit'; itemId: string | null }
  | { kind: 'item'; item: InventoryItem | null }
  | null;

interface EstoqueContextValue {
  branchId: string | null;
  canManage: boolean;
  openEntry: (itemId?: string) => void;
  openExit: (itemId?: string) => void;
  openItem: (item?: InventoryItem) => void;
  refresh: () => void;
}

const EstoqueContext = createContext<EstoqueContextValue | null>(null);

export function EstoqueProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { branchId } = useActiveBranch();
  const refresh = useRefreshInventory();
  const itemsQuery = useInventoryItems(branchId);
  const [dialog, setDialog] = useState<OpenDialog>(null);
  const canManage = !!user?.roles.some((role) => MANAGER_ROLES.includes(role));
  const close = useCallback(() => setDialog(null), []);

  const value = useMemo<EstoqueContextValue>(
    () => ({
      branchId,
      canManage,
      openEntry: (itemId) => setDialog({ kind: 'entry', itemId: itemId ?? null }),
      openExit: (itemId) => setDialog({ kind: 'exit', itemId: itemId ?? null }),
      openItem: (item) => setDialog({ kind: 'item', item: item ?? null }),
      refresh: () => void refresh(),
    }),
    [branchId, canManage, refresh],
  );

  const items = itemsQuery.data ?? [];

  return (
    <EstoqueContext.Provider value={value}>
      {children}
      <EntryDialog
        open={dialog?.kind === 'entry'}
        branchId={branchId}
        items={items}
        initialItemId={dialog?.kind === 'entry' ? dialog.itemId : null}
        onClose={close}
        onSaved={value.refresh}
      />
      <ExitDialog
        open={dialog?.kind === 'exit'}
        branchId={branchId}
        items={items}
        initialItemId={dialog?.kind === 'exit' ? dialog.itemId : null}
        onClose={close}
        onSaved={value.refresh}
      />
      <ItemDialog
        open={dialog?.kind === 'item'}
        item={dialog?.kind === 'item' ? dialog.item : null}
        onClose={close}
        onSaved={value.refresh}
      />
    </EstoqueContext.Provider>
  );
}

export function useEstoque(): EstoqueContextValue {
  const context = useContext(EstoqueContext);
  if (!context) throw new Error('useEstoque must be used within EstoqueProvider');
  return context;
}
