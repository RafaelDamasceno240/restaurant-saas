// Where the API lives depends on who is calling:
//  - browser: the same-origin `/api` prefix, which next.config.js rewrites to the API. The
//    browser only ever talks to the frontend host, so the httpOnly refresh_token cookie is
//    first-party there and middleware.ts can see it (docs/authentication.md).
//  - server (Server Components): Node's fetch needs an absolute URL, so it calls the API
//    directly through API_URL — a server-only variable, never inlined into the browser bundle.
const IS_SERVER = typeof window === 'undefined';
const API_BASE = IS_SERVER ? (process.env.API_URL ?? 'http://localhost:4000/v1') : '/api';

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

// B8 (piloto 2026-10-23): the API answers in Portuguese (validation included), but a proxy, an old
// API or the framework itself can still answer with English or no message at all. This is the one
// place every error passes through on its way to a screen: a message that is not one readable
// Portuguese string becomes the sentence for its status. The code is kept for the screens that
// decide by it.
const TECHNICAL_MESSAGE =
  /^(Bad Request|Unauthorized|Forbidden( resource)?|Not Found|Conflict|Too Many Requests|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout)$|^Cannot (GET|POST|PUT|PATCH|DELETE) |ThrottlerException|JSON|\b(must|should) (be|not|contain|match|exist)\b|<html/i;

const STATUS_MESSAGE: Record<number, string> = {
  400: 'Os dados enviados não são válidos. Confira e tente novamente.',
  401: 'Sua sessão expirou. Entre novamente.',
  403: 'Você não tem permissão para fazer isso.',
  404: 'Não encontrado.',
  409: 'Não foi possível concluir: os dados mudaram. Atualize a página e tente novamente.',
  413: 'O arquivo é grande demais.',
  429: 'Muitas tentativas em pouco tempo. Aguarde um instante e tente novamente.',
};

export const NETWORK_ERROR_MESSAGE = 'Não foi possível falar com o servidor. Confira a conexão e tente novamente.';

export function friendlyErrorMessage(status: number, message: unknown): string {
  const text = Array.isArray(message) ? message.filter((m) => typeof m === 'string').join(' ') : message;
  if (typeof text === 'string' && text.trim() && !TECHNICAL_MESSAGE.test(text)) return text;
  if (status >= 500) return 'O servidor não conseguiu concluir agora. Tente novamente em instantes.';
  return STATUS_MESSAGE[status] ?? 'Ocorreu um erro inesperado.';
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  accessToken?: string | null;
}

export interface AuthSession {
  accessToken: string;
  expiresIn: number;
  user: { id: string; tenantId: string; name: string; email: string; roles: string[] };
}

export type SessionEvent = { type: 'refreshed'; session: AuthSession } | { type: 'expired' };

// The access token lives only in memory (docs/authentication.md). Callers still pass the token
// they got from useAuth(), but a token captured by a closure goes stale the moment a refresh
// happens, so the copy kept here is the one that actually goes on the wire. Browser only: on the
// server this module is shared by every request and must never hold a user's token.
let sessionToken: string | null = null;
// Set once the refresh token is known to be dead, so later 401s stop asking for a new one.
let sessionEnded = false;
let refreshInFlight: Promise<AuthSession> | null = null;
const listeners = new Set<(event: SessionEvent) => void>();

export function startSession(accessToken: string): void {
  if (IS_SERVER) return;
  sessionToken = accessToken;
  sessionEnded = false;
}

export function endSession(): void {
  sessionToken = null;
  sessionEnded = true;
}

export function subscribeToSession(listener: (event: SessionEvent) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function emit(event: SessionEvent): void {
  listeners.forEach((listener) => listener(event));
}

// A request that never got an answer (offline, server down) is an ApiError too, with status 0, so
// screens show the Portuguese sentence instead of the browser's "Failed to fetch". Status 0 is not
// a 4xx: queries still retry it and the session is kept (runRefresh only ends it on 401/403).
async function send(path: string, options: RequestOptions, accessToken: string | null): Promise<Response> {
  try {
    return await rawSend(path, options, accessToken);
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', NETWORK_ERROR_MESSAGE);
  }
}

function rawSend(path: string, options: RequestOptions, accessToken: string | null): Promise<Response> {
  // A file upload (FormData) goes as multipart: the browser sets its own Content-Type with the
  // boundary, so none is set here.
  const isForm = typeof FormData !== 'undefined' && options.body instanceof FormData;
  return fetch(`${API_BASE}${path}`, {
    method: options.method ?? 'GET',
    credentials: 'include',
    // Every response is live, per-restaurant data (menu, prices, order status). Next 14 would
    // otherwise keep server-side GETs in its Data Cache indefinitely.
    cache: 'no-store',
    headers: {
      ...(isForm ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
    },
    body: isForm ? (options.body as FormData) : options.body ? JSON.stringify(options.body) : undefined,
  });
}

async function parse<T>(response: Response): Promise<T> {
  if (response.status === 204) {
    return undefined as T;
  }

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new ApiError(response.status, data.code ?? 'UNKNOWN_ERROR', friendlyErrorMessage(response.status, data.message));
  }

  return data as T;
}

// The refresh token is single-use, and two tabs share one cookie jar: without a cross-tab lock a
// second tab could send the token the first one has just rotated and be logged out for it.
async function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  const locks = typeof navigator === 'undefined' ? undefined : navigator.locks;
  return locks ? await locks.request('restaurant-saas:auth-refresh', task) : task();
}

async function runRefresh(): Promise<AuthSession> {
  try {
    const session = await withRefreshLock(async () =>
      parse<AuthSession>(await send('/auth/refresh', { method: 'POST' }, null)),
    );
    startSession(session.accessToken);
    emit({ type: 'refreshed', session });
    return session;
  } catch (error) {
    // Only a refusal ends the session. A network failure or a 5xx says nothing about the refresh
    // token, so the session is kept and the next request simply tries again.
    if (error instanceof ApiError && (error.statusCode === 401 || error.statusCode === 403)) {
      const hadSession = sessionToken !== null;
      endSession();
      if (hadSession) emit({ type: 'expired' });
    }
    throw error;
  }
}

// Exchanges the refresh cookie for a new access token. Concurrent callers share one request:
// rotation is single-use, so a second simultaneous refresh would be rejected by the API.
export function refreshSession(): Promise<AuthSession> {
  refreshInFlight ??= runRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function tokenForRetry(usedToken: string | null): Promise<string | null> {
  if (IS_SERVER || sessionEnded) return null;
  // Another request already renewed the session while this one was in flight.
  if (sessionToken && sessionToken !== usedToken) return sessionToken;
  try {
    return (await refreshSession()).accessToken;
  } catch {
    return null;
  }
}

// Thin fetch wrapper shared by every backend call from the frontend.
// `credentials: 'include'` is required so the httpOnly refresh_token cookie
// set by the API travels with requests (see docs/authentication.md).
//
// An authenticated request answered with 401 renews the session and is sent again exactly once.
// The second attempt goes straight to the network, so its own 401 can never start another
// refresh.
export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const authenticated = Boolean(options.accessToken);
  const token = authenticated ? ((IS_SERVER ? null : sessionToken) ?? options.accessToken ?? null) : null;

  let response = await send(path, options, token);

  if (response.status === 401 && authenticated) {
    const freshToken = await tokenForRetry(token);
    if (freshToken) {
      response = await send(path, options, freshToken);
    }
  }

  return parse<T>(response);
}
