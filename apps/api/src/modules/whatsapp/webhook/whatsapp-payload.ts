// Reads a WhatsApp Business Platform (Cloud API) webhook delivery into plain events. Pure and
// defensive: anything that is not the documented shape is skipped, never thrown on, because Meta
// retries a delivery that does not get a 200 and a malformed part must not block the rest.
//
// Shape (field "messages"):
// { object: "whatsapp_business_account", entry: [{ id, changes: [{ field: "messages", value: {
//     messaging_product: "whatsapp", metadata: { display_phone_number, phone_number_id },
//     contacts: [{ wa_id, profile: { name } }],
//     messages: [{ id, from, timestamp, type, text: { body } | interactive | button | ... }],
//     statuses: [{ id, status, timestamp, recipient_id, errors?: [{ code, title }] }] } }] }] }

export const MAX_INBOUND_BODY = 1000;

export interface InboundMessageEvent {
  phoneNumberId: string;
  providerMessageId: string;
  waId: string;
  profileName: string | null;
  type: string;
  body: string;
  timestamp: Date;
}

export type ProviderStatus = 'sent' | 'delivered' | 'read' | 'failed';

export interface StatusEvent {
  phoneNumberId: string;
  providerMessageId: string;
  status: ProviderStatus;
  timestamp: Date;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface ParsedWebhook {
  messages: InboundMessageEvent[];
  statuses: StatusEvent[];
}

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === 'string' && v.length > 0 ? v : null);
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

// Control characters other than line breaks and tabs are dropped; the length is capped so one
// message can never become a large prompt.
export function sanitizeText(text: string, max = MAX_INBOUND_BODY): string {
  // eslint-disable-next-line no-control-regex
  const clean = text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

function readTimestamp(value: unknown, fallback: Date): Date {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return fallback;
  return new Date(seconds * 1000);
}

function readBody(message: Json): { type: string; body: string } {
  const type = str(message.type) ?? 'unknown';
  if (type === 'text' && isObject(message.text)) {
    return { type, body: sanitizeText(str(message.text.body) ?? '') };
  }
  if (type === 'interactive' && isObject(message.interactive)) {
    const reply = message.interactive.button_reply ?? message.interactive.list_reply;
    if (isObject(reply)) return { type, body: sanitizeText(str(reply.title) ?? '') };
  }
  if (type === 'button' && isObject(message.button)) {
    return { type, body: sanitizeText(str(message.button.text) ?? '') };
  }
  // Audio, image, location, sticker...: kept as a note for the team, never interpreted.
  return { type, body: `[mensagem do tipo "${type.slice(0, 20)}" não suportada pelo assistente]` };
}

const STATUSES: ProviderStatus[] = ['sent', 'delivered', 'read', 'failed'];

export function parseWebhook(payload: unknown, now: Date = new Date()): ParsedWebhook {
  const result: ParsedWebhook = { messages: [], statuses: [] };
  if (!isObject(payload) || payload.object !== 'whatsapp_business_account') return result;

  for (const entry of list(payload.entry)) {
    if (!isObject(entry)) continue;
    for (const change of list(entry.changes)) {
      if (!isObject(change) || change.field !== 'messages' || !isObject(change.value)) continue;
      const value = change.value;
      if (value.messaging_product !== 'whatsapp' || !isObject(value.metadata)) continue;
      const phoneNumberId = str(value.metadata.phone_number_id);
      if (!phoneNumberId) continue;

      const names = new Map<string, string>();
      for (const contact of list(value.contacts)) {
        if (!isObject(contact)) continue;
        const waId = str(contact.wa_id);
        const name = isObject(contact.profile) ? str(contact.profile.name) : null;
        if (waId && name) names.set(waId, sanitizeText(name, 80));
      }

      for (const message of list(value.messages)) {
        if (!isObject(message)) continue;
        const providerMessageId = str(message.id);
        const waId = str(message.from);
        if (!providerMessageId || !waId || !/^\d{8,15}$/.test(waId)) continue;
        const { type, body } = readBody(message);
        if (!body) continue;
        result.messages.push({
          phoneNumberId,
          providerMessageId: providerMessageId.slice(0, 200),
          waId,
          profileName: names.get(waId) ?? null,
          type,
          body,
          timestamp: readTimestamp(message.timestamp, now),
        });
      }

      for (const status of list(value.statuses)) {
        if (!isObject(status)) continue;
        const providerMessageId = str(status.id);
        const value = str(status.status) as ProviderStatus | null;
        if (!providerMessageId || !value || !STATUSES.includes(value)) continue;
        const error = list(status.errors).find(isObject);
        result.statuses.push({
          phoneNumberId,
          providerMessageId,
          status: value,
          timestamp: readTimestamp(status.timestamp, now),
          errorCode: error && error.code !== undefined ? String(error.code).slice(0, 40) : null,
          errorMessage: error
            ? sanitizeText(str(error.title) ?? str(error.message) ?? '', 300) || null
            : null,
        });
      }
    }
  }
  return result;
}

// A status never goes back: "read" that arrives before "delivered" stays "read". FAILED only
// replaces a message that was not delivered yet.
const RANK: Record<string, number> = { QUEUED: 0, SENT: 1, DELIVERED: 2, READ: 3 };

export function nextStatus(
  current: 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'RECEIVED',
  incoming: ProviderStatus,
): 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | null {
  const target = incoming.toUpperCase() as 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';
  if (current === 'RECEIVED') return null;
  if (target === 'FAILED')
    return current === 'DELIVERED' || current === 'READ' || current === 'FAILED' ? null : 'FAILED';
  if (current === 'FAILED') return null;
  return RANK[target] > RANK[current] ? target : null;
}

// Builds a delivery in the same shape, for the simulator and the tests.
export function buildInboundPayload(input: {
  phoneNumberId: string;
  displayPhoneNumber: string;
  waId: string;
  profileName: string;
  providerMessageId: string;
  body: string;
  timestamp: Date;
}): Json {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'simulated-waba',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                display_phone_number: input.displayPhoneNumber,
                phone_number_id: input.phoneNumberId,
              },
              contacts: [{ wa_id: input.waId, profile: { name: input.profileName } }],
              messages: [
                {
                  from: input.waId,
                  id: input.providerMessageId,
                  timestamp: String(Math.floor(input.timestamp.getTime() / 1000)),
                  type: 'text',
                  text: { body: input.body },
                },
              ],
            },
          },
        ],
      },
    ],
  };
}
