import { apiFetch } from './api-client';

export interface AccessibleBranch {
  id: string;
  name: string;
  code: string;
}

export function listAccessibleBranches(accessToken: string): Promise<AccessibleBranch[]> {
  return apiFetch<AccessibleBranch[]>('/branches/accessible', { accessToken });
}
