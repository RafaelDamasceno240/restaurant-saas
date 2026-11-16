import { buildInboundPayload, nextStatus, parseWebhook, sanitizeText } from './whatsapp-payload';
import { isValidSignature, signPayload, verifySubscription } from './whatsapp-signature';

const SECRET = 'fictitious-app-secret-0123456789';

describe('webhook signature (X-Hub-Signature-256)', () => {
  const body = Buffer.from('{"object":"whatsapp_business_account","entry":[]}');

  it('accepts the HMAC of the raw body with the app secret', () => {
    expect(isValidSignature(body, signPayload(body, SECRET), SECRET)).toBe(true);
    expect(
      isValidSignature(
        body,
        signPayload(body, SECRET).toUpperCase().replace('SHA256=', 'sha256='),
        SECRET,
      ),
    ).toBe(true);
  });

  it('refuses another secret, a changed body, a missing or malformed header, or no secret configured', () => {
    expect(
      isValidSignature(body, signPayload(body, 'another-secret-0123456789abcdef'), SECRET),
    ).toBe(false);
    expect(isValidSignature(Buffer.from(`${body} `), signPayload(body, SECRET), SECRET)).toBe(
      false,
    );
    expect(isValidSignature(body, undefined, SECRET)).toBe(false);
    expect(isValidSignature(body, 'sha1=abc', SECRET)).toBe(false);
    expect(isValidSignature(body, ['a', 'b'], SECRET)).toBe(false);
    expect(isValidSignature(body, signPayload(body, SECRET), null)).toBe(false);
    expect(isValidSignature(undefined, signPayload(body, SECRET), SECRET)).toBe(false);
  });

  it('answers the subscription challenge only for the right verify token', () => {
    const token = 'fictitious-verify-token-123';
    const query = {
      'hub.mode': 'subscribe',
      'hub.verify_token': token,
      'hub.challenge': '1158201444',
    };
    expect(verifySubscription(query, token)).toBe('1158201444');
    expect(
      verifySubscription({ ...query, 'hub.verify_token': 'wrong-token-but-long-1' }, token),
    ).toBeNull();
    expect(verifySubscription({ ...query, 'hub.mode': 'unsubscribe' }, token)).toBeNull();
    expect(verifySubscription({ ...query, 'hub.challenge': '<script>' }, token)).toBeNull();
    expect(verifySubscription(query, null)).toBeNull();
  });
});

describe('webhook payload', () => {
  const at = new Date('2026-11-12T15:00:00Z');
  const payload = (messages: unknown[], statuses: unknown[] = []) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'waba',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '15550001111', phone_number_id: 'PN1' },
              contacts: [{ wa_id: '5511999990001', profile: { name: 'Ana' } }],
              messages,
              statuses,
            },
          },
        ],
      },
    ],
  });

  it('reads text, button and list replies, keeps unsupported types as a note, and the profile name', () => {
    const parsed = parseWebhook(
      payload([
        {
          from: '5511999990001',
          id: 'wamid.1',
          timestamp: '1731423600',
          type: 'text',
          text: { body: '  oi  ' },
        },
        {
          from: '5511999990001',
          id: 'wamid.2',
          timestamp: '1731423601',
          type: 'interactive',
          interactive: { type: 'button_reply', button_reply: { id: 'y', title: 'Sim' } },
        },
        {
          from: '5511999990001',
          id: 'wamid.3',
          timestamp: '1731423602',
          type: 'button',
          button: { text: 'Cardápio' },
        },
        {
          from: '5511999990001',
          id: 'wamid.4',
          timestamp: '1731423603',
          type: 'audio',
          audio: { id: 'x' },
        },
      ]),
      at,
    );
    expect(parsed.messages.map((m) => [m.providerMessageId, m.type, m.body])).toEqual([
      ['wamid.1', 'text', 'oi'],
      ['wamid.2', 'interactive', 'Sim'],
      ['wamid.3', 'button', 'Cardápio'],
      ['wamid.4', 'audio', '[mensagem do tipo "audio" não suportada pelo assistente]'],
    ]);
    expect(parsed.messages[0]).toMatchObject({
      phoneNumberId: 'PN1',
      waId: '5511999990001',
      profileName: 'Ana',
    });
    expect(parsed.messages[0].timestamp.toISOString()).toBe('2024-11-12T15:00:00.000Z');
  });

  it('skips what is not the documented shape instead of throwing', () => {
    expect(parseWebhook(null)).toEqual({ messages: [], statuses: [] });
    expect(parseWebhook({ object: 'page', entry: [] })).toEqual({ messages: [], statuses: [] });
    const parsed = parseWebhook(
      payload([
        { from: 'not-a-number', id: 'wamid.x', type: 'text', text: { body: 'a' } },
        { id: 'wamid.y', type: 'text', text: { body: 'no sender' } },
        { from: '5511999990001', id: 'wamid.z', type: 'text', text: { body: '   ' } },
        'garbage',
      ]),
    );
    expect(parsed.messages).toEqual([]);
  });

  it('reads delivery statuses with their error code', () => {
    const parsed = parseWebhook(
      payload(
        [],
        [
          {
            id: 'wamid.out1',
            status: 'delivered',
            timestamp: '1731423700',
            recipient_id: '5511999990001',
          },
          {
            id: 'wamid.out2',
            status: 'failed',
            timestamp: '1731423701',
            errors: [{ code: 131047, title: 'Re-engagement message' }],
          },
          { id: 'wamid.out3', status: 'deleted' },
        ],
      ),
    );
    expect(parsed.statuses.map((s) => [s.providerMessageId, s.status, s.errorCode])).toEqual([
      ['wamid.out1', 'delivered', null],
      ['wamid.out2', 'failed', '131047'],
    ]);
  });

  it('caps and cleans the text so one message never becomes a large prompt', () => {
    expect(sanitizeText('a\u0000b\u0007c\nd')).toBe('abc\nd');
    expect(sanitizeText('x'.repeat(1200))).toHaveLength(1001);
  });

  it('a status never goes back, and FAILED only replaces an undelivered message', () => {
    expect(nextStatus('QUEUED', 'sent')).toBe('SENT');
    expect(nextStatus('SENT', 'read')).toBe('READ');
    expect(nextStatus('READ', 'delivered')).toBeNull();
    expect(nextStatus('DELIVERED', 'sent')).toBeNull();
    expect(nextStatus('SENT', 'failed')).toBe('FAILED');
    expect(nextStatus('DELIVERED', 'failed')).toBeNull();
    expect(nextStatus('FAILED', 'read')).toBeNull();
    expect(nextStatus('RECEIVED', 'read')).toBeNull();
  });

  it('the simulator builds a delivery the parser reads back', () => {
    const built = buildInboundPayload({
      phoneNumberId: 'sim-1',
      displayPhoneNumber: '+55 00 90000-0000',
      waId: '5500999990001',
      profileName: 'Cliente teste',
      providerMessageId: 'wamid.sim.1',
      body: 'quero 1 smash',
      timestamp: at,
    });
    expect(parseWebhook(built).messages).toEqual([
      expect.objectContaining({
        phoneNumberId: 'sim-1',
        waId: '5500999990001',
        body: 'quero 1 smash',
        profileName: 'Cliente teste',
      }),
    ]);
  });
});
