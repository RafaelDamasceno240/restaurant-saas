'use client';

import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react';
import { usePathname } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import {
  apiFetch,
  ApiError,
  AuthSession,
  endSession,
  refreshSession,
  startSession,
  subscribeToSession,
} from './api-client';
import { isPublicArea, isSessionRefusal } from './session-area';

export interface AuthUser {
  id: string;
  tenantId: string;
  // logoUrl: the restaurant's own logo for the panel (null = none: the panel shows its initials).
  tenant?: { id: string; name: string; slug: string; logoUrl?: string | null };
  name: string;
  email: string;
  roles: string[];
  // Shows the way to /super-admin. Only a hint for the screens: /platform on the API checks it
  // again on every request.
  isPlatformAdmin?: boolean;
}

interface AuthContextValue {
  user: AuthUser | null;
  accessToken: string | null;
  isLoading: boolean;
  // The session could not be restored because the API did not answer (no network, server down),
  // which says nothing about being signed in. Screens show "cannot reach the server" and offer
  // `retrySession` instead of sending a signed-in operator to the login form.
  sessionUnavailable: boolean;
  retrySession: () => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

type AuthResponse = AuthSession;

// Access tokens live only in memory (React state) — never in localStorage —
// per the security guidance in docs/authentication.md. The refresh token is
// an httpOnly cookie the browser manages automatically; this provider never
// touches it directly.
//
// Renewal itself lives in api-client.ts (a 401 on an authenticated call
// refreshes once and retries); this provider only mirrors its outcome.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(null);
  // The session is only restored where it is used. On the public menu, the demo and the landing
  // page the provider stays idle (lib/session-area.ts) and nothing is "loading"; the exchange
  // happens the first time the visitor reaches the sign-in pages or the dashboard. `isLoading`
  // is derived, not stored: the render that enters such a page already says "loading", so the
  // dashboard layout never sees a finished-but-empty session and bounces to /login.
  const needsSession = !isPublicArea(usePathname());
  const [restored, setRestored] = useState(false);
  const [sessionUnavailable, setSessionUnavailable] = useState(false);
  const restoreStarted = useRef(false);
  const isLoading = needsSession && !restored;
  // Every admin/authenticated query (['pdv-products'], ['orders', tab],
  // ['kds-orders', status], etc.) is tenant-scoped server-side, but the
  // QueryClient itself has no notion of "which tenant" a cached response
  // belongs to. Without an explicit clear, switching accounts in the same
  // tab (logout -> login as a different tenant) could briefly render the
  // previous tenant's cached data before the new fetch resolves. Clearing
  // on every identity change (login/logout) is the simplest safe
  // fix — cheaper and more robust than trying to scope every query key by
  // tenantId by hand.
  const queryClient = useQueryClient();

  const fetchMe = useCallback(async (token: string) => {
    const me = await apiFetch<AuthUser>('/auth/me', { accessToken: token });
    setUser(me);
  }, []);

  // Keeps React in step with the session held by api-client.ts: a renewal
  // hands every screen the new token, and a refused refresh ends the session
  // here. The dashboard layout sends a user-less session back to /login.
  useEffect(
    () =>
      subscribeToSession((event) => {
        if (event.type === 'refreshed') {
          setAccessToken(event.session.accessToken);
          return;
        }
        setUser(null);
        setAccessToken(null);
        queryClient.clear();
      }),
    [queryClient],
  );

  // On first load, try to silently exchange a still-valid refresh cookie for
  // a fresh access token, so a page refresh doesn't force a re-login.
  const restore = useCallback(async () => {
    setSessionUnavailable(false);
    try {
      const refreshed = await refreshSession();
      setAccessToken(refreshed.accessToken);
      await fetchMe(refreshed.accessToken);
    } catch (error) {
      setUser(null);
      setAccessToken(null);
      // Only a refusal means "not signed in". Anything else (the request never got an answer, the
      // API is restarting) leaves the refresh cookie as valid as it was.
      setSessionUnavailable(!isSessionRefusal(error instanceof ApiError ? error.statusCode : null));
    } finally {
      setRestored(true);
    }
  }, [fetchMe]);

  useEffect(() => {
    if (!needsSession || restoreStarted.current) return;
    restoreStarted.current = true;
    void restore();
  }, [needsSession, restore]);

  // One retry at a time: a second tap while the first is in flight does nothing.
  const retrying = useRef(false);
  const retrySession = useCallback(async () => {
    if (retrying.current) return;
    retrying.current = true;
    setRestored(false);
    try {
      await restore();
    } finally {
      retrying.current = false;
    }
  }, [restore]);

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
      startSession(res.accessToken);
      setSessionUnavailable(false);
      setAccessToken(res.accessToken);
      await fetchMe(res.accessToken);
    },
    [fetchMe, queryClient],
  );

  // The API identifies the session to end by the refresh cookie alone, so no
  // access token is sent: signing out has to work after it expired too.
  const logout = useCallback(async () => {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch {
      // Even if the server call fails, clear local state so the UI reflects
      // "logged out" immediately.
    }
    endSession();
    setUser(null);
    setAccessToken(null);
    queryClient.clear();
  }, [queryClient]);

  // Reads /auth/me again after something it carries changed (the restaurant name). Same
  // session, same token: nothing is cleared.
  const refreshUser = useCallback(async () => {
    if (accessToken) await fetchMe(accessToken);
  }, [accessToken, fetchMe]);

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        isLoading,
        sessionUnavailable,
        retrySession,
        login,
        logout,
        refreshUser,
      }}
    >
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
