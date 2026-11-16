import type { CartItem, CartState } from './cart-types';
import { lineKey } from './cart-logic';
import type {
  ChatMessage,
  ConversationStatus,
  MessageAuthor,
  MessageStatus,
  SharedCart,
} from './whatsapp-api';

export const MESSAGE_MAX = 1000;

export const STATUS_LABEL: Record<ConversationStatus, string> = {
  AI: 'Assistente',
  HUMAN: 'Atendente',
};

export const AUTHOR_LABEL: Record<MessageAuthor, string> = {
  CUSTOMER: 'Cliente',
  ASSISTANT: 'Assistente',
  AGENT: 'Atendente',
  SYSTEM: 'Sistema',
};

export const DELIVERY_LABEL: Record<MessageStatus, string> = {
  RECEIVED: 'Recebida',
  QUEUED: 'Na fila',
  SENT: 'Enviada',
  DELIVERED: 'Entregue',
  READ: 'Lida',
  FAILED: 'Não enviada',
};

const ERROR_LABEL: Record<string, string> = {
  OPTED_OUT: 'o cliente pediu para não receber mensagens',
  WINDOW_CLOSED: 'passaram 24 horas desde a última mensagem do cliente',
  CLOUD_DISABLED: 'envio pela Cloud API desativado neste ambiente',
};

export function failureReason(message: Pick<ChatMessage, 'status' | 'errorCode'>): string | null {
  if (message.status !== 'FAILED') return null;
  return ERROR_LABEL[message.errorCode ?? ''] ?? 'falha no envio';
}

// "5511987654321" -> "+55 (11) 98765-4321"; the simulated numbers ("5500...") read as such.
export function formatWaId(waId: string): string {
  const d = waId.replace(/\D/g, '');
  if (d.length === 13 && d.startsWith('55'))
    return `+55 (${d.slice(2, 4)}) ${d.slice(4, 9)}-${d.slice(9)}`;
  if (d.length === 12 && d.startsWith('55'))
    return `+55 (${d.slice(2, 4)}) ${d.slice(4, 8)}-${d.slice(8)}`;
  return `+${d}`;
}

export function contactLabel(contact: { name: string | null; waId: string }): string {
  return contact.name?.trim() || formatWaId(contact.waId);
}

export function timeLabel(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  const sameDay = at.toDateString() === now.toDateString();
  const time = at.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return sameDay
    ? time
    : `${at.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${time}`;
}

// What the composer may do, and why not.
export function replyBlock(conversation: {
  windowOpen: boolean;
  contact: { optedOut: boolean };
}): string | null {
  if (conversation.contact.optedOut) return 'O cliente pediu para não receber mensagens.';
  if (!conversation.windowOpen) {
    return 'Passaram 24 horas desde a última mensagem do cliente: o WhatsApp só permite responder com um modelo aprovado.';
  }
  return null;
}

export function validateReply(text: string): string | null {
  const t = text.trim();
  if (!t) return 'Escreva a mensagem.';
  if (t.length > MESSAGE_MAX) return `No máximo ${MESSAGE_MAX} caracteres.`;
  return null;
}

// WhatsApp-style *bold*, kept as plain text segments for safe rendering (never HTML).
export function boldSegments(text: string): { text: string; bold: boolean }[] {
  const parts: { text: string; bold: boolean }[] = [];
  const re = /\*([^*\n]+)\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) parts.push({ text: text.slice(last, m.index), bold: false });
    parts.push({ text: m[1], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push({ text: text.slice(last), bold: false });
  return parts;
}

// The cart of a checkout link, as the public cart of THIS site (same shape the menu builds), so
// the existing cart and checkout pages take it from there. Unavailable lines are left out; the
// prices shown are the server's of now, and the checkout prices everything again anyway.
export function cartFromShared(shared: SharedCart): CartState {
  const items: CartItem[] = shared.items
    .filter((i) => i.available)
    .map((i) => {
      const options = i.options.map((o) => ({
        optionId: o.optionId,
        groupName: o.groupName,
        name: o.name,
        priceCents: o.priceCents,
        quantity: o.quantity,
      }));
      return {
        lineId: lineKey(i.productId, options, i.notes),
        productId: i.productId,
        name: i.name,
        priceCents: i.unitPriceCents,
        // Same photo as the public menu (resolved by the server); none when the product has none.
        imageUrl: i.imageUrl ?? null,
        quantity: i.quantity,
        options,
        notes: i.notes,
      };
    });
  return { restaurantSlug: shared.restaurant.slug, restaurantName: shared.restaurant.name, items };
}
