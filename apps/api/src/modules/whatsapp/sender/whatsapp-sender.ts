import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from 'crypto';

// How an outbound message leaves the server. SIMULATED connections never leave it (the simulator
// reads the stored message). The Cloud API sender is real code against
// POST https://graph.facebook.com/<version>/<phone number id>/messages, but it only runs when
// WHATSAPP_CLOUD_ENABLED=true AND the connection is CLOUD with a token: in this version neither
// exists, so no message can reach Meta.

export interface SendRequest {
  phoneNumberId: string;
  to: string;
  body: string;
  accessToken: string | null;
}

export type SendResult =
  | { ok: true; providerMessageId: string; delivered: boolean }
  | { ok: false; retryable: boolean; code: string; message: string };

export interface WhatsappSender {
  send(request: SendRequest): Promise<SendResult>;
}

export class SimulatedSender implements WhatsappSender {
  async send(): Promise<SendResult> {
    return { ok: true, providerMessageId: `sim.${randomUUID()}`, delivered: true };
  }
}

type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}>;

export class CloudApiSender implements WhatsappSender {
  constructor(
    private readonly graphApiVersion: string,
    private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike,
  ) {}

  async send(request: SendRequest): Promise<SendResult> {
    if (!request.accessToken)
      return {
        ok: false,
        retryable: false,
        code: 'NO_TOKEN',
        message: 'Conexão sem token de acesso.',
      };
    const url = `https://graph.facebook.com/${this.graphApiVersion}/${encodeURIComponent(request.phoneNumberId)}/messages`;
    let response: Awaited<ReturnType<FetchLike>>;
    try {
      response = await this.fetchImpl(url, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${request.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: request.to,
          type: 'text',
          text: { preview_url: true, body: request.body },
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return {
        ok: false,
        retryable: true,
        code: 'NETWORK',
        message: 'Falha de rede ao falar com a Cloud API.',
      };
    }
    const data = (await response.json().catch(() => null)) as {
      messages?: { id?: string }[];
      error?: { code?: number; message?: string };
    } | null;
    if (response.ok && data?.messages?.[0]?.id) {
      return { ok: true, providerMessageId: data.messages[0].id, delivered: false };
    }
    const code = String(data?.error?.code ?? response.status);
    // 429 and 5xx are the provider's problem and pass; 4xx (bad number, window closed,
    // invalid token) will fail the same way again.
    const retryable = response.status === 429 || response.status >= 500;
    // The provider's text is never trusted to be free of the token or the number: only the code.
    return {
      ok: false,
      retryable,
      code,
      message: `Cloud API recusou o envio (HTTP ${response.status}, código ${code}).`,
    };
  }
}

// ---- access tokens at rest -----------------------------------------------------------------

function key(base64Key: string): Buffer {
  const buffer = Buffer.from(base64Key, 'base64');
  if (buffer.length !== 32)
    throw new Error('WHATSAPP_TOKEN_ENCRYPTION_KEY must be 32 bytes in base64');
  return buffer;
}

export function encryptToken(token: string, base64Key: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(base64Key), iv);
  const data = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    data.toString('base64'),
  ].join('.');
}

export function decryptToken(sealed: string, base64Key: string): string {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('unknown token format');
  const decipher = createDecipheriv('aes-256-gcm', key(base64Key), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString(
    'utf8',
  );
}

// The Cloud API only accepts free-form replies within 24 hours of the customer's last message.
export const SERVICE_WINDOW_MS = 24 * 60 * 60 * 1000;

export function windowOpen(lastInboundAt: Date | null, now: Date = new Date()): boolean {
  return lastInboundAt !== null && now.getTime() - lastInboundAt.getTime() < SERVICE_WINDOW_MS;
}
