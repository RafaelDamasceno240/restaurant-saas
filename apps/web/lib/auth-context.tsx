'use client';

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { apiFetch, ApiError } from './api-client';

export interface AuthUser {
  id: string;
  tenantId: string;
  tenant?: { id: string; name: string; slug: string };
  name: string;
  email: string;
  roles: string[];
}

interface RegisterInput {
  tenantName: string;
  legalName: string;
  document: string;
  slug: string;
  branchName: string;
  userName: string;
  email: string;
  password: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

interface AuthResponse {
  accessToken: string;
  expiresIn: number;
  user: { id: string; tenantId: string; name: string; email: string; roles: string[] };
}

// Access tokens live only in memory (React state) — never in localStorage —
// per the security guidance in docs/authentication.md. The refresh token is
// an httpOnly cookie the browser manages automatically; this provider never
// touches it directly.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  // Every admin/authenticated query (['pdv-products'], ['orders', tab],
  // ['kds-orders', status], etc.) is tenant-scoped server-side, but the
  // QueryClient itself has no notion of "which tenant" a cached response
  // belongs to. Without an explicit clear, switching accounts in the same
  // tab (logout -> login as a different tenant) could briefly render the
  // previous tenant's cached data before the new fetch resolves. Clearing
  // on every identity change (login/register/logout) is the simplest safe
  // fix — cheaper and more robust than trying to scope every query key by
  // tenantId by hand.
  const queryClient = useQueryClient();

  const fetchMe = useCallback(async (token: string) => {
    const me = await apiFetch<AuthUser>('/auth/me', { accessToken: token });
    setUser(me);
  }, []);

  // On first load, try to silently exchange a still-valid refresh cookie for
  // a fresh access token, so a page refresh doesn't force a re-login.
  useEffect(() => {
    (async () => {
      try {
        const refreshed = await apiFetch<AuthResponse>('/auth/refresh', { method: 'POST' });
        setAccessToken(refreshed.accessToken);
        await fetchMe(refreshed.accessToken);
      } catch {
        setUser(null);
        setAccessToken(null);
      } finally {
        setIsLoading(false);
      }
    })();
  }, [fetchMe]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await apiFetch<AuthResponse>('/auth/login', {
        method: 'POST',
        body: { email, password },
      });
      // Cleared BEFORE setting the new identity: guarantees no query for
      // the incoming session can ever be served the previous tenant's
      // cached data, even for a query that fires the instant accessToken
      // updates.
      queryClient.clear();
      setAccessToken(res.accessToken);
      await fetchMe(res.accessToken);
    },
    [fetchMe, queryClient],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      const res = await apiFetch<AuthResponse>('/auth/register', {
        method: 'POST',
        body: input,
      });
      queryClient.clear();
      setAccessToken(res.accessToken);
      await fetchMe(res.accessToken);
    },
    [fetchMe, queryClient],
  );

  const logout = useCallback(async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST', accessToken });
    } catch {
      // Even if the server call fails, clear local state so the UI reflects
      // "logged out" immediately.
    }
    setUser(null);
    setAccessToken(null);
    queryClient.clear();
  }, [accessToken, queryClient]);

  return (
    <AuthContext.Provider value={{ user, accessToken, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

export { ApiError };
