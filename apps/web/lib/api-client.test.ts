export {};

type ApiClient = typeof import('./api-client');

interface Call {
  url: string;
  method: string;
  authorization: string | undefined;
  body: string | undefined;
  init: RequestInit;
}

const calls: Call[] = [];
let handler: (call: Call) => Promise<Response> | Response;

function json(status: number, body: unknown = {}): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

// The session lives in module state, so every test gets its own copy of the module.
function load(): Promise<ApiClient> {
  jest.resetModules();
  return import('./api-client');
}

const refreshCalls = () => calls.filter((c) => c.url === '/api/auth/refresh');
const callsTo = (path: string) => calls.filter((c) => c.url === `/api${path}`);
const session = (accessToken: string) => ({ accessToken, expiresIn: 900, user: { id: 'u1' } });

// An API that accepts only `validToken` and hands out `nextToken` on refresh.
function apiAccepting(validToken: string, nextToken = validToken) {
  return (call: Call) => {
    if (call.url === '/api/auth/refresh') return json(200, session(nextToken));
    return call.authorization === `Bearer ${validToken}`
      ? json(200, { ok: true, path: call.url })
      : json(401, { code: 'UNAUTHORIZED', message: 'Unauthorized' });
  };
}

beforeEach(() => {
  calls.length = 0;
  handler = () => json(200, {});
  global.fetch = jest.fn((url: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const call: Call = {
      url: String(url),
      method: init.method ?? 'GET',
      authorization: headers.Authorization,
      body: init.body as string | undefined,
      init,
    };
    calls.push(call);
    return Promise.resolve(handler(call));
  }) as unknown as typeof fetch;
});

describe('apiFetch in the browser', () => {
  it('calls the same-origin /api prefix, with the cookie and without any HTTP caching', async () => {
    const { apiFetch } = await load();
    handler = () => json(200, { data: [] });

    await apiFetch('/customers?page=1', { accessToken: 'token-1' });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('/api/customers?page=1');
    expect(calls[0].init.credentials).toBe('include');
    expect(calls[0].init.cache).toBe('no-store');
    expect(calls[0].authorization).toBe('Bearer token-1');
  });

  it('sends no Authorization header on a public call', async () => {
    const { apiFetch } = await load();
    await apiFetch('/public/menu/cantina');
    expect(calls[0].authorization).toBeUndefined();
  });

  it('returns undefined for 204', async () => {
    const { apiFetch } = await load();
    handler = () => json(204);
    await expect(apiFetch('/auth/logout', { method: 'POST' })).resolves.toBeUndefined();
  });
});

describe('access token renewal on 401', () => {
  it('refreshes once and repeats the request once with the new token', async () => {
    const { apiFetch, startSession } = await load();
    startSession('expired');
    handler = apiAccepting('fresh', 'fresh');

    const result = await apiFetch<{ ok: boolean }>('/orders', { accessToken: 'expired' });

    expect(result.ok).toBe(true);
    expect(calls.map((c) => `${c.method} ${c.url} ${c.authorization ?? '-'}`)).toEqual([
      'GET /api/orders Bearer expired',
      'POST /api/auth/refresh -',
      'GET /api/orders Bearer fresh',
    ]);
  });

  it('resends the body of a write request on the retry', async () => {
    const { apiFetch, startSession } = await load();
    startSession('expired');
    handler = apiAccepting('fresh', 'fresh');

    await apiFetch('/pos/orders', { method: 'POST', accessToken: 'expired', body: { branchId: 'b1' } });

    const sent = callsTo('/pos/orders');
    expect(sent).toHaveLength(2);
    expect(sent.map((c) => c.method)).toEqual(['POST', 'POST']);
    expect(sent[1].body).toBe(JSON.stringify({ branchId: 'b1' }));
  });

  it('shares a single refresh between simultaneous requests that all got 401', async () => {
    const { apiFetch, startSession } = await load();
    startSession('expired');
    const gate = deferred<void>();
    handler = async (call) => {
      if (call.url === '/api/auth/refresh') {
        await gate.promise;
        return json(200, session('fresh'));
      }
      return call.authorization === 'Bearer fresh' ? json(200, { path: call.url }) : json(401, {});
    };

    const paths = ['/orders', '/products', '/cash/sessions', '/coupons', '/customers'];
    const pending = paths.map((path) => apiFetch<{ path: string }>(path, { accessToken: 'expired' }));
    // Every request has already been answered 401 and is waiting on the same refresh.
    await new Promise((r) => setTimeout(r, 0));
    expect(refreshCalls()).toHaveLength(1);
    gate.resolve();
    const results = await Promise.all(pending);

    expect(results.map((r) => r.path)).toEqual(paths.map((p) => `/api${p}`));
    expect(refreshCalls()).toHaveLength(1);
    for (const path of paths) {
      expect(callsTo(path).map((c) => c.authorization)).toEqual(['Bearer expired', 'Bearer fresh']);
    }
  });

  it('refreshSession() returns the same promise to concurrent callers', async () => {
    const { refreshSession } = await load();
    handler = () => json(200, session('fresh'));

    const first = refreshSession();
    const second = refreshSession();

    expect(second).toBe(first);
    await Promise.all([first, second]);
    expect(refreshCalls()).toHaveLength(1);
  });

  it('does not refresh again for a 401 that arrives after the session was already renewed', async () => {
    const { apiFetch, startSession } = await load();
    startSession('expired');
    const slow = deferred<void>();
    handler = async (call) => {
      if (call.url === '/api/auth/refresh') return json(200, session('fresh'));
      if (call.authorization === 'Bearer fresh') return json(200, { path: call.url });
      if (call.url === '/api/slow') await slow.promise;
      return json(401, {});
    };

    const late = apiFetch<{ path: string }>('/slow', { accessToken: 'expired' });
    await apiFetch('/fast', { accessToken: 'expired' });
    expect(refreshCalls()).toHaveLength(1);

    slow.resolve();
    await expect(late).resolves.toEqual({ path: '/api/slow' });

    expect(refreshCalls()).toHaveLength(1);
    expect(callsTo('/slow').map((c) => c.authorization)).toEqual(['Bearer expired', 'Bearer fresh']);
  });

  it('sends the renewed token even when the caller still holds the old one', async () => {
    const { apiFetch, startSession } = await load();
    startSession('expired');
    handler = apiAccepting('fresh', 'fresh');
    await apiFetch('/orders', { accessToken: 'expired' });
    calls.length = 0;

    await apiFetch('/products', { accessToken: 'expired' });

    expect(calls.map((c) => `${c.url} ${c.authorization}`)).toEqual(['/api/products Bearer fresh']);
  });

  it('never turns the 401 of the repeated request into another refresh', async () => {
    const { apiFetch, startSession, ApiError } = await load();
    startSession('expired');
    // The API rejects every token, including the one it has just issued.
    handler = (call) =>
      call.url === '/api/auth/refresh'
        ? json(200, session('fresh'))
        : json(401, { code: 'UNAUTHORIZED', message: 'Unauthorized' });

    const failed = apiFetch('/orders', { accessToken: 'expired' });

    await expect(failed).rejects.toBeInstanceOf(ApiError);
    await expect(failed).rejects.toMatchObject({ statusCode: 401 });
    expect(callsTo('/orders')).toHaveLength(2);
    expect(refreshCalls()).toHaveLength(1);
  });

  it('does not refresh for a 401 on a request that carried no access token', async () => {
    const { apiFetch, ApiError } = await load();
    handler = () => json(401, { code: 'INVALID_CREDENTIALS', message: 'E-mail ou senha inválidos.' });

    const failed = apiFetch('/auth/login', { method: 'POST', body: { email: 'a@b.c' } });

    await expect(failed).rejects.toBeInstanceOf(ApiError);
    await expect(failed).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS' });
    expect(calls).toHaveLength(1);
  });

  it.each([403, 404, 409, 500])('does not refresh on %s', async (status) => {
    const { apiFetch, startSession } = await load();
    startSession('token');
    handler = () => json(status, { code: 'SOME_ERROR', message: 'x' });

    await expect(apiFetch('/orders', { accessToken: 'token' })).rejects.toMatchObject({ statusCode: status });
    expect(calls).toHaveLength(1);
  });
});

describe('when the refresh is refused', () => {
  function refusingRefresh(call: Call) {
    return call.url === '/api/auth/refresh'
      ? json(401, { code: 'INVALID_REFRESH_TOKEN', message: 'Sessão inválida ou expirada.' })
      : json(401, { code: 'UNAUTHORIZED', message: 'Unauthorized' });
  }

  it('ends the session once, rejects the request with 401 and does not repeat it', async () => {
    const { apiFetch, startSession, subscribeToSession } = await load();
    startSession('expired');
    const events: string[] = [];
    subscribeToSession((event) => events.push(event.type));
    handler = refusingRefresh;

    const results = await Promise.allSettled([
      apiFetch('/orders', { accessToken: 'expired' }),
      apiFetch('/products', { accessToken: 'expired' }),
      apiFetch('/coupons', { accessToken: 'expired' }),
    ]);

    expect(results.map((r) => r.status)).toEqual(['rejected', 'rejected', 'rejected']);
    expect(results.map((r) => (r as PromiseRejectedResult).reason.statusCode)).toEqual([401, 401, 401]);
    expect(events).toEqual(['expired']);
    expect(refreshCalls()).toHaveLength(1);
    expect(callsTo('/orders')).toHaveLength(1);
  });

  it('stops asking for a new token afterwards, so 401s cannot loop', async () => {
    const { apiFetch, startSession, subscribeToSession } = await load();
    startSession('expired');
    const events: string[] = [];
    subscribeToSession((event) => events.push(event.type));
    handler = refusingRefresh;
    await apiFetch('/orders', { accessToken: 'expired' }).catch(() => undefined);

    for (let i = 0; i < 10; i++) {
      await apiFetch('/orders', { accessToken: 'expired' }).catch(() => undefined);
    }

    expect(refreshCalls()).toHaveLength(1);
    expect(callsTo('/orders')).toHaveLength(11);
    expect(events).toEqual(['expired']);
  });

  it('renews again after a new login', async () => {
    const { apiFetch, startSession } = await load();
    startSession('expired');
    handler = refusingRefresh;
    await apiFetch('/orders', { accessToken: 'expired' }).catch(() => undefined);

    startSession('second-login');
    handler = apiAccepting('fresh', 'fresh');
    await expect(apiFetch('/orders', { accessToken: 'second-login' })).resolves.toMatchObject({ ok: true });
    expect(refreshCalls()).toHaveLength(2);
  });

  it('stays silent when there was no session to end (first load of an anonymous visitor)', async () => {
    const { refreshSession, subscribeToSession } = await load();
    const events: string[] = [];
    subscribeToSession((event) => events.push(event.type));
    handler = () => json(401, { code: 'MISSING_REFRESH_TOKEN', message: 'Sessão não encontrada.' });

    await expect(refreshSession()).rejects.toMatchObject({ statusCode: 401 });
    expect(events).toEqual([]);
  });

  it('stops notifying a listener that unsubscribed', async () => {
    const { apiFetch, startSession, subscribeToSession } = await load();
    startSession('expired');
    const events: string[] = [];
    subscribeToSession((event) => events.push(event.type))();
    handler = refusingRefresh;

    await apiFetch('/orders', { accessToken: 'expired' }).catch(() => undefined);
    expect(events).toEqual([]);
  });
});

describe('when the refresh fails without a verdict on the session', () => {
  it.each([
    ['a 500', () => json(500, { code: 'INTERNAL_SERVER_ERROR' })],
    ['a 429', () => json(429, { code: 'RATE_LIMITED' })],
    [
      'a network failure',
      () => {
        throw new TypeError('Failed to fetch');
      },
    ],
  ])('keeps the session on %s and tries again on the next request', async (_label, refreshResponse) => {
    const { apiFetch, startSession, subscribeToSession } = await load();
    startSession('expired');
    const events: string[] = [];
    subscribeToSession((event) => events.push(event.type));
    handler = (call) => (call.url === '/api/auth/refresh' ? refreshResponse() : json(401, { code: 'UNAUTHORIZED' }));

    await expect(apiFetch('/orders', { accessToken: 'expired' })).rejects.toMatchObject({ statusCode: 401 });
    expect(events).toEqual([]);
    expect(callsTo('/orders')).toHaveLength(1);

    handler = apiAccepting('fresh', 'fresh');
    await expect(apiFetch('/orders', { accessToken: 'expired' })).resolves.toMatchObject({ ok: true });
    expect(events).toEqual(['refreshed']);
    expect(refreshCalls()).toHaveLength(2);
  });
});

describe('session events and logout', () => {
  it('announces the renewed session to subscribers', async () => {
    const { apiFetch, startSession, subscribeToSession } = await load();
    startSession('expired');
    const tokens: string[] = [];
    subscribeToSession((event) => {
      if (event.type === 'refreshed') tokens.push(event.session.accessToken);
    });
    handler = apiAccepting('fresh', 'fresh');

    await apiFetch('/orders', { accessToken: 'expired' });
    expect(tokens).toEqual(['fresh']);
  });

  it('logs out without an access token and without trying to renew', async () => {
    const { apiFetch, startSession, endSession } = await load();
    startSession('expired');
    handler = (call) => (call.url === '/api/auth/logout' ? json(204) : json(401, {}));

    await apiFetch('/auth/logout', { method: 'POST' });
    endSession();

    expect(calls.map((c) => `${c.method} ${c.url} ${c.authorization ?? '-'}`)).toEqual(['POST /api/auth/logout -']);
    // A request still in flight when the user signed out must not bring the session back.
    await apiFetch('/orders', { accessToken: 'expired' }).catch(() => undefined);
    expect(refreshCalls()).toHaveLength(0);
  });
});

describe('refresh across tabs', () => {
  afterEach(() => {
    Reflect.deleteProperty(navigator, 'locks');
  });

  it('runs the refresh inside a cross-tab lock when the browser offers one', async () => {
    const { refreshSession } = await load();
    const order: string[] = [];
    const request = jest.fn(async (name: string, task: () => Promise<unknown>) => {
      order.push(`lock:${name}`);
      const result = await task();
      order.push('unlock');
      return result;
    });
    Object.defineProperty(navigator, 'locks', { value: { request }, configurable: true });
    handler = () => {
      order.push('refresh');
      return json(200, session('fresh'));
    };

    await refreshSession();

    expect(order).toEqual(['lock:restaurant-saas:auth-refresh', 'refresh', 'unlock']);
  });
});

describe('error messages a screen can show (B8)', () => {
  it('keeps the Portuguese message and the code the API sent', async () => {
    const { apiFetch } = await load();
    handler = () => json(409, { code: 'PRODUCT_OUT_OF_STOCK', message: 'Desculpe, não temos "Milkshake" disponível.' });
    await expect(apiFetch('/public/orders', { method: 'POST', body: {} })).rejects.toMatchObject({
      statusCode: 409,
      code: 'PRODUCT_OUT_OF_STOCK',
      message: 'Desculpe, não temos "Milkshake" disponível.',
    });
  });

  it('never passes on English, technical or missing messages', async () => {
    const { apiFetch } = await load();
    handler = () => json(400, { statusCode: 400, message: ['customer.name must be longer than or equal to 2 characters'], error: 'Bad Request' });
    await expect(apiFetch('/public/orders', { method: 'POST', body: {} })).rejects.toMatchObject({
      statusCode: 400,
      code: 'UNKNOWN_ERROR',
      message: 'Os dados enviados não são válidos. Confira e tente novamente.',
    });
    handler = () => json(502, {});
    await expect(apiFetch('/orders')).rejects.toMatchObject({ message: 'O servidor não conseguiu concluir agora. Tente novamente em instantes.' });
    handler = () => json(429, { message: 'ThrottlerException: Too Many Requests' });
    await expect(apiFetch('/orders')).rejects.toMatchObject({ message: expect.stringMatching(/^Muitas tentativas/) });
  });

  it('a request that got no answer is an ApiError with status 0, not "Failed to fetch"', async () => {
    const { apiFetch, ApiError, NETWORK_ERROR_MESSAGE } = await load();
    handler = () => {
      throw new TypeError('Failed to fetch');
    };
    const failed = apiFetch('/orders');
    await expect(failed).rejects.toBeInstanceOf(ApiError);
    await expect(failed).rejects.toMatchObject({ statusCode: 0, code: 'NETWORK_ERROR', message: NETWORK_ERROR_MESSAGE });
  });

  it('friendlyErrorMessage joins a list of messages into one sentence', async () => {
    const { friendlyErrorMessage } = await load();
    expect(friendlyErrorMessage(400, ['Telefone em formato inválido.', 'CEP em formato inválido.'])).toBe(
      'Telefone em formato inválido. CEP em formato inválido.',
    );
  });
});
