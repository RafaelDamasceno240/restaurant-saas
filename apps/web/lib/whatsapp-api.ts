import { apiFetch } from './api-client';

// Atendimento > WhatsApp. The API decides everything (who may read, answer or configure; what the
// assistant says; every price). These calls only carry what a person typed.

export type ConversationStatus = 'AI' | 'HUMAN';
export type MessageAuthor = 'CUSTOMER' | 'ASSISTANT' | 'AGENT' | 'SYSTEM';
export type MessageStatus = 'RECEIVED' | 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED';

export interface WhatsappSettings {
  connection: {
    mode: 'SIMULATED' | 'CLOUD';
    displayPhoneNumber: string;
    phoneNumberId: string;
    createdAt: string;
  } | null;
  settings: {
    assistantEnabled: boolean;
    greetingMessage: string | null;
    behaviorInstructions: string | null;
    aiDailyReplyLimit: number;
  } | null;
  ai: { provider: string; model: string | null };
  usageToday: { assistantReplies: number; inputTokens: number; outputTokens: number };
  conversations: { ai: number; human: number };
  cloudSendingEnabled: boolean;
}

export interface ConversationSummary {
  id: string;
  status: ConversationStatus;
  contact: { name: string | null; waId: string; optedOut: boolean };
  assignedUser: { id: string; name: string } | null;
  unreadCount: number;
  lastMessage: { body: string; author: MessageAuthor; at: string } | null;
  lastMessageAt: string | null;
  windowOpen: boolean;
}

export interface ChatMessage {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  author: MessageAuthor;
  authorName: string | null;
  body: string;
  type: string;
  status: MessageStatus;
  at: string;
  errorCode: string | null;
  aiProvider: string | null;
}

export interface ConversationDetail extends Omit<
  ConversationSummary,
  'lastMessage' | 'lastMessageAt'
> {
  cartItems: number;
  messages: ChatMessage[];
}

export interface SettingsInput {
  assistantEnabled?: boolean;
  greetingMessage?: string | null;
  behaviorInstructions?: string | null;
  aiDailyReplyLimit?: number;
}

export interface SharedCart {
  restaurant: { name: string; slug: string };
  expiresAt: string;
  subtotalCents: number;
  items: {
    productId: string;
    name: string;
    // The photo the public menu shows (resolved by the server), or null.
    imageUrl?: string | null;
    quantity: number;
    unitPriceCents: number;
    options: {
      optionId: string;
      groupName: string;
      name: string;
      priceCents: number;
      quantity: number;
    }[];
    notes: string | null;
    available: boolean;
    problem: string | null;
  }[];
}

export const whatsappApi = {
  settings: (token: string) =>
    apiFetch<WhatsappSettings>('/whatsapp/settings', { accessToken: token }),
  updateSettings: (token: string, input: SettingsInput) =>
    apiFetch<WhatsappSettings>('/whatsapp/settings', {
      method: 'PUT',
      body: input,
      accessToken: token,
    }),
  createSimulatedConnection: (token: string) =>
    apiFetch<WhatsappSettings>('/whatsapp/connection/simulated', {
      method: 'POST',
      accessToken: token,
    }),

  conversations: (token: string, status?: ConversationStatus) =>
    apiFetch<ConversationSummary[]>(`/whatsapp/conversations${status ? `?status=${status}` : ''}`, {
      accessToken: token,
    }),
  conversation: (token: string, id: string) =>
    apiFetch<ConversationDetail>(`/whatsapp/conversations/${id}`, { accessToken: token }),
  markRead: (token: string, id: string) =>
    apiFetch<{ ok: boolean }>(`/whatsapp/conversations/${id}/read`, {
      method: 'POST',
      accessToken: token,
    }),
  reply: (token: string, id: string, text: string) =>
    apiFetch<{ id: string }>(`/whatsapp/conversations/${id}/messages`, {
      method: 'POST',
      body: { text },
      accessToken: token,
    }),
  assume: (token: string, id: string) =>
    apiFetch<ConversationDetail>(`/whatsapp/conversations/${id}/assume`, {
      method: 'POST',
      accessToken: token,
    }),
  release: (token: string, id: string) =>
    apiFetch<ConversationDetail>(`/whatsapp/conversations/${id}/release`, {
      method: 'POST',
      accessToken: token,
    }),

  simulate: (token: string, input: { contactName: string; contactPhone: string; text: string }) =>
    apiFetch<{ conversationId: string | null; waId: string; stored: number }>(
      '/whatsapp/simulator/messages',
      {
        method: 'POST',
        body: input,
        accessToken: token,
      },
    ),

  // Public: the token in the link is the only credential.
  sharedCart: (slug: string, token: string) =>
    apiFetch<SharedCart>(
      `/public/whatsapp-carts/${encodeURIComponent(slug)}/${encodeURIComponent(token)}`,
    ),
};
