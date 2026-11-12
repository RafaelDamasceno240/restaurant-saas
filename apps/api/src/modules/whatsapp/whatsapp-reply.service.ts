import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, WhatsappJob } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { startOfDayInTimeZone, todayInTimeZone } from '../../common/util/timezone.util';
import { wantsHuman, wantsOptOut } from './assistant/assistant-guards';
import { AssistantEngineService } from './assistant/assistant-engine.service';
import { CartLine, ToolboxState } from './assistant/assistant-toolbox';
import { HistoryEntry } from './assistant/assistant-provider';
import { WhatsappQueueService } from './queue/whatsapp-queue.service';

// Answers a conversation. One worker at a time per conversation (a lease on the row), every
// customer message answered once (the reply's inReplyToId is UNIQUE), and the reply, the cart,
// the checkout link and the next job written in ONE transaction: a crash or a duplicate job can
// never leave half a turn behind or send the same answer twice.

export const LEASE_MS = 60_000;
export const MAX_MESSAGES_PER_TURN = 8;
export const MAX_ASSISTANT_REPLIES_PER_HOUR = 30;
const HISTORY_MESSAGES = 30;

export const HANDOFF_TEXT =
  'Certo! Já chamei alguém da nossa equipe. Em instantes vão te responder por aqui. 🙂';
export const LIMIT_TEXT = 'Nossa equipe vai continuar o seu atendimento por aqui em instantes. 🙂';
export const FAILURE_TEXT =
  'Tive um problema para responder agora. Já chamei alguém da equipe para te ajudar.';
export const OPT_OUT_TEXT =
  'Pronto, você não vai mais receber mensagens nossas por aqui. Se quiser falar com a gente de novo, é só mandar uma mensagem.';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

export type ReplyOutcome = 'done' | 'busy';

function readCart(value: Prisma.JsonValue | null): CartLine[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((l): l is Prisma.JsonObject => typeof l === 'object' && l !== null && !Array.isArray(l))
    .map((l) => ({
      productId: String(l.productId ?? ''),
      quantity: Number(l.quantity ?? 0),
      options: Array.isArray(l.options)
        ? (l.options as Prisma.JsonObject[]).map((o) => ({
            optionId: String(o.optionId ?? ''),
            quantity: Number(o.quantity ?? 1),
          }))
        : [],
      notes: typeof l.notes === 'string' ? l.notes : null,
    }))
    .filter((l) => l.productId && l.quantity > 0);
}

@Injectable()
export class WhatsappReplyService {
  private readonly logger = new Logger(WhatsappReplyService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: WhatsappQueueService,
    private readonly engine: AssistantEngineService,
    private readonly audit: AuditService,
  ) {}

  async process(job: WhatsappJob): Promise<ReplyOutcome> {
    const leased = await this.prisma.whatsappConversation.updateMany({
      where: {
        id: job.conversationId,
        tenantId: job.tenantId,
        OR: [{ processingUntil: null }, { processingUntil: { lt: new Date() } }],
      },
      data: { processingUntil: new Date(Date.now() + LEASE_MS) },
    });
    if (leased.count === 0) return 'busy';
    try {
      await this.answer(job);
      return 'done';
    } finally {
      await this.prisma.whatsappConversation.update({
        where: { id: job.conversationId },
        data: { processingUntil: null },
      });
    }
  }

  private async answer(job: WhatsappJob): Promise<void> {
    const conversation = await this.prisma.whatsappConversation.findFirst({
      where: { id: job.conversationId, tenantId: job.tenantId },
      include: {
        contact: { include: { connection: true } },
        tenant: { select: { slug: true, timezone: true } },
      },
    });
    if (!conversation) return;
    const connection = conversation.contact.connection;

    const pending = await this.prisma.whatsappMessage.findMany({
      where: { conversationId: conversation.id, direction: 'INBOUND', handledAt: null },
      orderBy: [{ providerTimestamp: 'asc' }, { createdAt: 'asc' }],
    });
    if (pending.length === 0) return; // already answered (duplicate or later job)
    // A person took over, or the assistant was switched off: the messages wait for the team.
    if (conversation.status !== 'AI' || !connection.assistantEnabled) return;

    const turn = pending.slice(-MAX_MESSAGES_PER_TURN);
    const customerText = turn.map((m) => m.body).join('\n');
    const last = turn[turn.length - 1];
    const base = {
      tenantId: conversation.tenantId,
      conversationId: conversation.id,
      pendingIds: pending.map((m) => m.id),
      lastId: last.id,
    };

    if (wantsOptOut(last.body)) {
      await this.writeReply({ ...base, text: OPT_OUT_TEXT, type: 'optout_confirmation' });
      return;
    }
    if (turn.some((m) => wantsHuman(m.body))) {
      await this.writeReply({ ...base, text: HANDOFF_TEXT, handoffReason: 'pedido do cliente' });
      return;
    }

    // Cost control: per restaurant per day, and per conversation per hour.
    const dayStart = startOfDayInTimeZone(
      todayInTimeZone(conversation.tenant.timezone),
      conversation.tenant.timezone,
    );
    const [today, lastHour] = await Promise.all([
      this.prisma.whatsappMessage.count({
        where: {
          tenantId: conversation.tenantId,
          author: 'ASSISTANT',
          createdAt: { gte: dayStart },
        },
      }),
      this.prisma.whatsappMessage.count({
        where: {
          conversationId: conversation.id,
          author: 'ASSISTANT',
          createdAt: { gte: new Date(Date.now() - 3_600_000) },
        },
      }),
    ]);
    if (today >= connection.aiDailyReplyLimit) {
      await this.writeReply({
        ...base,
        text: LIMIT_TEXT,
        handoffReason: 'limite diário do assistente',
        countsAsAssistant: false,
      });
      return;
    }
    if (lastHour >= MAX_ASSISTANT_REPLIES_PER_HOUR) {
      await this.writeReply({
        ...base,
        text: LIMIT_TEXT,
        handoffReason: 'limite de mensagens da conversa',
        countsAsAssistant: false,
      });
      return;
    }

    const earlier = await this.prisma.whatsappMessage.findMany({
      where: {
        conversationId: conversation.id,
        id: { notIn: base.pendingIds },
        author: { in: ['CUSTOMER', 'ASSISTANT', 'AGENT'] },
      },
      orderBy: [{ providerTimestamp: 'desc' }, { createdAt: 'desc' }],
      take: HISTORY_MESSAGES,
      select: { author: true, body: true, direction: true },
    });
    const history: HistoryEntry[] = earlier
      .reverse()
      .map((m) => ({ role: m.author === 'CUSTOMER' ? 'customer' : 'assistant', text: m.body }));
    const isFirstContact = !earlier.some((m) => m.direction === 'OUTBOUND');

    const state: ToolboxState = {
      cart: readCart(conversation.cart),
      cartVersion: conversation.cartVersion,
      awaitingConfirmationVersion: conversation.awaitingConfirmationVersion,
      handoffReason: null,
      checkoutLink: null,
    };

    let output: Awaited<ReturnType<AssistantEngineService['respond']>>;
    try {
      output = await this.engine.respond({
        tenantId: conversation.tenantId,
        tenantSlug: conversation.tenant.slug,
        contactWaId: conversation.contact.waId,
        customerText,
        history,
        state,
        dialogState: conversation.dialogState,
        greeting: connection.greetingMessage,
        isFirstContact,
        behaviorInstructions: connection.behaviorInstructions,
      });
    } catch (error) {
      // Retried by the queue; on the last attempt a person takes over instead of silence.
      if (job.attempts < job.maxAttempts) throw error;
      this.logger.error(
        `assistant failed for conversation ${conversation.id}: ${(error as Error).message}`,
      );
      await this.writeReply({
        ...base,
        text: FAILURE_TEXT,
        handoffReason: 'falha do assistente',
        failure: true,
        countsAsAssistant: false,
      });
      return;
    }

    await this.writeReply({
      ...base,
      text: output.text,
      handoffReason: output.state.handoffReason,
      state: output.state,
      dialogState: output.dialogState,
      ai: {
        provider: output.provider,
        model: output.model,
        inputTokens: output.inputTokens,
        outputTokens: output.outputTokens,
      },
      notes: { fellBack: output.fellBack, guardTriggered: output.guardTriggered },
    });
  }

  private async writeReply(input: {
    tenantId: string;
    conversationId: string;
    pendingIds: string[];
    lastId: string;
    text: string;
    type?: string;
    handoffReason?: string | null;
    state?: ToolboxState;
    dialogState?: unknown;
    ai?: {
      provider: string;
      model: string | null;
      inputTokens: number | null;
      outputTokens: number | null;
    };
    notes?: { fellBack: boolean; guardTriggered: boolean };
    failure?: boolean;
    countsAsAssistant?: boolean;
  }): Promise<void> {
    const now = new Date();
    const link = input.state?.checkoutLink ?? null;
    let replyId: string;
    try {
      replyId = await this.prisma.$transaction(async (tx) => {
        const reply = await tx.whatsappMessage.create({
          data: {
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            direction: 'OUTBOUND',
            // Limit and failure notices are the system's, so they do not count as assistant replies.
            author: input.countsAsAssistant === false ? 'SYSTEM' : 'ASSISTANT',
            type: input.type ?? 'text',
            body: input.text,
            status: 'QUEUED',
            providerTimestamp: now,
            inReplyToId: input.lastId,
            aiProvider: input.ai?.provider ?? null,
            aiModel: input.ai?.model ?? null,
            inputTokens: input.ai?.inputTokens ?? null,
            outputTokens: input.ai?.outputTokens ?? null,
          },
        });
        await tx.whatsappMessage.updateMany({
          where: { id: { in: input.pendingIds }, handledAt: null },
          data: { handledAt: now },
        });
        if (link) {
          await tx.whatsappCheckoutLink.create({
            data: {
              tenantId: input.tenantId,
              conversationId: input.conversationId,
              tokenHash: hashToken(link.token),
              cart: link.cart as unknown as Prisma.InputJsonValue,
              expiresAt: link.expiresAt,
            },
          });
        }
        await tx.whatsappConversation.update({
          where: { id: input.conversationId },
          data: {
            lastMessageAt: now,
            ...(input.handoffReason ? { status: 'HUMAN' } : {}),
            ...(input.failure
              ? { aiFailures: { increment: 1 } }
              : input.ai
                ? { aiFailures: 0 }
                : {}),
            ...(input.state
              ? {
                  cart: input.state.cart as unknown as Prisma.InputJsonValue,
                  cartVersion: input.state.cartVersion,
                  awaitingConfirmationVersion: input.state.awaitingConfirmationVersion,
                }
              : {}),
            ...(input.dialogState !== undefined
              ? { dialogState: (input.dialogState ?? Prisma.DbNull) as Prisma.InputJsonValue }
              : {}),
          },
        });
        await this.queue.enqueue(
          {
            tenantId: input.tenantId,
            conversationId: input.conversationId,
            type: 'SEND',
            dedupeKey: `send:${reply.id}`,
            messageId: reply.id,
          },
          tx,
        );
        return reply.id;
      });
    } catch (error) {
      if (isUniqueViolation(error)) return; // these messages were answered by another run
      throw error;
    }

    if (input.handoffReason) {
      await this.audit.record({
        tenantId: input.tenantId,
        action: 'whatsapp.handoff',
        entity: 'WhatsappConversation',
        entityId: input.conversationId,
        afterData: { reason: input.handoffReason, status: 'HUMAN' },
      });
    }
    if (link) {
      await this.audit.record({
        tenantId: input.tenantId,
        action: 'whatsapp.checkout_link.create',
        entity: 'WhatsappConversation',
        entityId: input.conversationId,
        afterData: {
          messageId: replyId,
          items: link.cart.length,
          expiresAt: link.expiresAt.toISOString(),
        },
      });
    }
    if (input.notes?.guardTriggered || input.notes?.fellBack) {
      await this.audit.record({
        tenantId: input.tenantId,
        action: 'whatsapp.assistant.guard',
        entity: 'WhatsappMessage',
        entityId: replyId,
        afterData: input.notes,
      });
    }
  }
}
