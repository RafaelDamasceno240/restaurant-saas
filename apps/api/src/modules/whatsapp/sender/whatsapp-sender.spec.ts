import { randomBytes } from 'crypto';
import { backoffMs } from '../queue/whatsapp-queue.service';
import {
  CloudApiSender,
  SimulatedSender,
  decryptToken,
  encryptToken,
  windowOpen,
} from './whatsapp-sender';

describe('Cloud API sender (fake transport: nothing leaves the test)', () => {
  const request = {
    phoneNumberId: 'PN1',
    to: '5511999990001',
    body: 'Olá',
    accessToken: 'fictitious-token',
  };

  it('posts a text message to the phone number and returns the wamid', async () => {
    const fetchImpl = jest.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ messages: [{ id: 'wamid.OUT1' }] }),
    }));
    const result = await new CloudApiSender('v21.0', fetchImpl).send(request);
    expect(result).toEqual({ ok: true, providerMessageId: 'wamid.OUT1', delivered: false });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string>; body: string },
    ];
    expect(url).toBe('https://graph.facebook.com/v21.0/PN1/messages');
    expect(init.headers.Authorization).toBe('Bearer fictitious-token');
    expect(JSON.parse(init.body)).toMatchObject({
      messaging_product: 'whatsapp',
      to: '5511999990001',
      type: 'text',
      text: { body: 'Olá' },
    });
  });

  it('429/5xx and network failures are retried; 4xx is final; the provider text never leaks', async () => {
    const reply = (status: number, error: unknown) =>
      jest.fn(async () => ({ ok: false, status, json: async () => ({ error }) }));
    expect(
      await new CloudApiSender('v21.0', reply(429, { code: 130429 })).send(request),
    ).toMatchObject({ ok: false, retryable: true, code: '130429' });
    expect(await new CloudApiSender('v21.0', reply(503, {})).send(request)).toMatchObject({
      ok: false,
      retryable: true,
    });
    const final = await new CloudApiSender(
      'v21.0',
      reply(400, { code: 131047, message: 'token fictitious-token for 5511999990001' }),
    ).send(request);
    expect(final).toMatchObject({ ok: false, retryable: false, code: '131047' });
    expect(JSON.stringify(final)).not.toContain('fictitious-token');
    const network = jest.fn(async () => {
      throw new Error('ECONNRESET');
    });
    expect(await new CloudApiSender('v21.0', network).send(request)).toMatchObject({
      ok: false,
      retryable: true,
      code: 'NETWORK',
    });
    expect(
      await new CloudApiSender('v21.0', network).send({ ...request, accessToken: null }),
    ).toMatchObject({ ok: false, code: 'NO_TOKEN' });
    expect(network).toHaveBeenCalledTimes(1);
  });

  it('the simulated sender never calls anything and reports delivery', async () => {
    expect(await new SimulatedSender().send()).toMatchObject({
      ok: true,
      delivered: true,
      providerMessageId: expect.stringMatching(/^sim\./),
    });
  });
});

describe('tokens at rest, service window and backoff', () => {
  it('encrypts the access token with AES-256-GCM and refuses tampering or a wrong key', () => {
    const key = randomBytes(32).toString('base64');
    const sealed = encryptToken('EAAB-fictitious', key);
    expect(sealed).not.toContain('EAAB');
    expect(decryptToken(sealed, key)).toBe('EAAB-fictitious');
    expect(() => decryptToken(sealed, randomBytes(32).toString('base64'))).toThrow();
    const [v, iv, tag, data] = sealed.split('.');
    expect(() =>
      decryptToken([v, iv, tag, Buffer.from('x').toString('base64') + data].join('.'), key),
    ).toThrow();
    expect(() => encryptToken('x', 'short')).toThrow('32 bytes');
  });

  it('free-form replies only within 24 hours of the last customer message', () => {
    const now = new Date('2026-11-12T12:00:00Z');
    expect(windowOpen(new Date('2026-11-11T12:00:01Z'), now)).toBe(true);
    expect(windowOpen(new Date('2026-11-11T12:00:00Z'), now)).toBe(false);
    expect(windowOpen(null, now)).toBe(false);
  });

  it('backs off exponentially up to five minutes', () => {
    expect([1, 2, 3, 4, 10, 30].map(backoffMs)).toEqual([
      2_000, 4_000, 8_000, 16_000, 300_000, 300_000,
    ]);
  });
});
