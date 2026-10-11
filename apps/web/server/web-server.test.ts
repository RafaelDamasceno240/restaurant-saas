/** @jest-environment node */
import http, { IncomingMessage, Server, ServerResponse } from 'http';
import { AddressInfo } from 'net';
import { createWebServer } from './web-server';

// A real HTTP server on a real socket: the address appended is the one the operating system
// reports for the connection, not something a test passed in. The handler stands in for Next
// and answers with the X-Forwarded-For it was given, which is what Next's /api rewrite forwards.
describe('createWebServer', () => {
  let server: Server;
  let port: number;
  let seen: (string | string[] | undefined)[] = [];

  beforeAll(async () => {
    server = createWebServer((req: IncomingMessage, res: ServerResponse) => {
      seen.push(req.headers['x-forwarded-for']);
      if (req.url === '/boom') throw new Error('handler failed');
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ forwardedFor: req.headers['x-forwarded-for'] }));
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(async () => {
    await new Promise((resolve) => server.close(resolve));
  });
  beforeEach(() => {
    seen = [];
  });

  // rawHeaders: sent exactly as given, including a header repeated on several lines.
  function get(path: string, rawHeaders: string[] = []): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
      const req = http.request({ host: '127.0.0.1', port, path, method: 'GET', agent: false }, (res) => {
        let body = '';
        res.on('data', (chunk) => (body += chunk));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body }));
      });
      for (let i = 0; i < rawHeaders.length; i += 2) {
        const name = rawHeaders[i];
        const value = rawHeaders[i + 1];
        const current = req.getHeader(name);
        req.setHeader(name, current === undefined ? value : [...([] as string[]).concat(current as string | string[]), value]);
      }
      req.on('error', reject);
      req.end();
    });
  }
  const forwardedFor = async (rawHeaders: string[] = []) =>
    JSON.parse((await get('/', rawHeaders)).body).forwardedFor as string;

  it('gives the handler the address of the socket when the client sent no header', async () => {
    expect(await forwardedFor()).toBe('127.0.0.1');
  });

  it('gives the same client the same address on every request', async () => {
    expect(await forwardedFor()).toBe(await forwardedFor());
  });

  it('appends the socket address to a header the client sent, never replacing it', async () => {
    expect(await forwardedFor(['X-Forwarded-For', '203.0.113.7'])).toBe('203.0.113.7, 127.0.0.1');
  });

  it('leaves a forged chain to the left of the real address', async () => {
    const header = await forwardedFor(['X-Forwarded-For', '6.6.6.6, 7.7.7.7']);
    expect(header).toBe('6.6.6.6, 7.7.7.7, 127.0.0.1');
    expect(header.split(', ').pop()).toBe('127.0.0.1');
  });

  it('does the same when the header is repeated on several lines', async () => {
    const header = await forwardedFor(['X-Forwarded-For', '6.6.6.6', 'X-Forwarded-For', '7.7.7.7']);
    expect(header.split(', ').pop()).toBe('127.0.0.1');
    expect(header).toContain('6.6.6.6');
    expect(header).toContain('7.7.7.7');
  });

  it('is not fooled by other headers that claim an address', async () => {
    const header = await forwardedFor(['X-Real-IP', '6.6.6.6', 'Forwarded', 'for=6.6.6.6', 'X-Client-IP', '6.6.6.6']);
    expect(header).toBe('127.0.0.1');
  });

  it('writes the header before the handler runs, on every request', async () => {
    await get('/a');
    await get('/b', ['X-Forwarded-For', '203.0.113.7']);
    expect(seen).toEqual(['127.0.0.1', '203.0.113.7, 127.0.0.1']);
  });

  it('answers 500 instead of hanging when the handler throws', async () => {
    const errors = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      expect((await get('/boom')).status).toBe(500);
    } finally {
      errors.mockRestore();
    }
  });
});
