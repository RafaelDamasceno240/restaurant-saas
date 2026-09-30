'use client';

import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth-context';
import { PurchaseFilters, purchasesApi, suppliersApi } from '@/lib/purchases-api';
import { INVENTORY_QUERY_ROOT } from '@/components/estoque/use-inventory';

export function usePurchases(branchId: string | null, filters: PurchaseFilters) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: [INVENTORY_QUERY_ROOT, 'purchases', branchId, filters],
    queryFn: () => purchasesApi.list(accessToken as string, branchId as string, filters),
    enabled: !!accessToken && !!branchId,
    placeholderData: (previous) => previous,
  });
}

export function usePurchase(id: string) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: [INVENTORY_QUERY_ROOT, 'purchase', id],
    queryFn: () => purchasesApi.get(accessToken as string, id),
    enabled: !!accessToken && !!id,
  });
}

export function useSuppliers(includeInactive = false) {
  const { accessToken } = useAuth();
  return useQuery({
    queryKey: [INVENTORY_QUERY_ROOT, 'suppliers', includeInactive],
    queryFn: () => suppliersApi.list(accessToken as string, includeInactive),
    enabled: !!accessToken,
  });
}
