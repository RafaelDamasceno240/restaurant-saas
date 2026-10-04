/** @jest-environment node */
// Same module, loaded the way a Server Component loads it: no `window`.
export {};

type ApiClient = typeof import('./api-client');

interface Call {
  url: string;
  authorization: string | undefined;
  init: RequestInit;
}

const calls: Call[] = [];
let respond: () => Response;

function json(status: number, body: unknown = {}): Response {
  return { status, ok: status >= 200 && status < 300, json: async () => body } as Response;
}

function load(): Promise<ApiClient> {
  jest.resetModules();
  return import('./api-client');
}

const originalApiUrl = process.env.API_URL;

beforeEach(() => {
  calls.length = 0;
  respond = () => json(200, { ok: true });
  global.fetch = jest.fn((url: RequestInfo | URL, init: RequestInit = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    calls.push({ url: String(url), authorization: headers.Authorization, init });
    return Promise.resolve(respond());
  }) as unknown as typeof fetch;
});

afterEach(() => {
  if (originalApiUrl === undefined) delete process.env.API_URL;
  else process.env.API_URL = originalApiUrl;
});

describe('apiFetch on the server', () => {
  it('calls the API by its absolute URL, taken from API_URL', async () => {
    process.env.API_URL = 'https://api.example.test/v1';
    const { apiFetch } = await load();

    await apiFetch('/public/menu/cantina');

    expect(calls[0].url).toBe('https://api.example.test/v1/public/menu/cantina');
  });

  it('falls back to the local API when API_URL is not set', async () => {
    delete process.env.API_URL;
    const { apiFetch } = await load();

    await apiFetch('/public/menu/cantina');

    expect(calls[0].url).toBe('http://localhost:4000/v1/public/menu/cantina');
  });

  it('never caches: public pages must show the current menu and order status', async () => {
    const { apiFetch } = await load();
    await apiFetch('/public/orders/cantina/o1');
    expect(calls[0].init.cache).toBe('no-store');
  });

  it('keeps no session between requests: one visitor token is never reused for another', async () => {
    const { apiFetch, startSession } = await load();
    startSession('token-of-visitor-a');

    await apiFetch('/auth/me', { accessToken: 'token-of-visitor-b' });
    await apiFetch('/public/menu/cantina');

    expect(calls.map((c) => c.authorization)).toEqual(['Bearer token-of-visitor-b', undefined]);
  });

  it('does not try to renew a session on 401', async () => {
    const { apiFetch } = await load();
    respond = () => json(401, { code: 'UNAUTHORIZED', message: 'Unauthorized' });

    await expect(apiFetch('/auth/me', { accessToken: 'expired' })).rejects.toMatchObject({ statusCode: 401 });
    expect(calls).toHaveLength(1);
  });
});
