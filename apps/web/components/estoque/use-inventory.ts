'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { inventoryApi } from '@/lib/inventory-api';

export const INVENTORY_QUERY_ROOT = 'inventory';

export function useInventoryItems(branchId: string | null) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: [INVENTORY_QUERY_ROOT, 'items', branchId],
    queryFn: () => inventoryApi.listItems(accessToken as string, branchId as string),
    enabled: !!accessToken && !!branchId,
  });
}

export function useRefreshInventory() {
  const queryClient = useQueryClient();
  return () => queryClient.invalidateQueries({ queryKey: [INVENTORY_QUERY_ROOT] });
}

export function useErrorMessage() {
  return (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
}
