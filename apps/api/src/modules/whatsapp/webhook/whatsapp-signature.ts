import { createHmac, timingSafeEqual } from 'crypto';

// Meta signs every webhook delivery with the App Secret: header X-Hub-Signature-256 is
// "sha256=" + HMAC-SHA256(app secret, raw request body), hex. The RAW bytes matter: a body parsed
// and serialized again would not match, so the controller reads req.rawBody.

export const SIGNATURE_HEADER = 'x-hub-signature-256';

export function signPayload(rawBody: Buffer | string, appSecret: string): string {
  return `sha256=${createHmac('sha256', appSecret).update(rawBody).digest('hex')}`;
}

export function isValidSignature(
  rawBody: Buffer | undefined,
  header: string | string[] | undefined,
  appSecret: string | null,
): boolean {
  if (!appSecret || !rawBody || typeof header !== 'string') return false;
  if (!/^sha256=[0-9a-f]{64}$/i.test(header)) return false;
  const expected = Buffer.from(signPayload(rawBody, appSecret), 'utf8');
  const received = Buffer.from(header.toLowerCase(), 'utf8');
  // Same length is guaranteed by the pattern above; timingSafeEqual still needs it checked.
  return expected.length === received.length && timingSafeEqual(expected, received);
}

// GET handshake when the webhook is registered in the Meta app: echo hub.challenge only for the
// right verify token.
export function verifySubscription(
  query: Record<string, unknown>,
  verifyToken: string | null,
): string | null {
  if (!verifyToken) return null;
  const mode = query['hub.mode'];
  const token = query['hub.verify_token'];
  const challenge = query['hub.challenge'];
  if (mode !== 'subscribe' || typeof token !== 'string' || typeof challenge !== 'string')
    return null;
  const a = Buffer.from(token);
  const b = Buffer.from(verifyToken);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return /^[\w-]{1,200}$/.test(challenge) ? challenge : null;
}
