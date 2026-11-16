import { randomUUID } from 'crypto';
import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma, WhatsappConversationStatus } from '@prisma/client';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { startOfDayInTimeZone, todayInTimeZone } from '../../common/util/timezone.util';
import { AuditService } from '../audit/audit.service';
import { AssistantProviderRegistry } from './assistant/assistant-engine.service';
import { WhatsappQueueService } from './queue/whatsapp-queue.service';
import { WhatsappWorkerService } from './queue/whatsapp-worker.service';
import { windowOpen } from './sender/whatsapp-sender';
import { WhatsappIngestService } from './whatsapp-ingest.service';
import { buildInboundPayload } from './webhook/whatsapp-payload';
import { SimulateMessageDto, UpdateWhatsappSettingsDto } from './dto/whatsapp.dto';

const conversationNotFound = () =>
  new NotFoundException({ code: 'NOT_FOUND', message: 'Conversa não encontrada.' });

// The attendance panel (Atendimento > WhatsApp). Every query is scoped by the tenant of the JWT;
// a conversation of another restaurant is "not found", never "forbidden".
@Injectable()
export class WhatsappPanelService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly queue: WhatsappQueueService,
    private readonly worker: WhatsappWorkerService,
    private readonly ingest: WhatsappIngestService,
    private readonly registry: AssistantProviderRegistry,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  // ---- settings ----------------------------------------------------------------------------

  async getSettings(user: AuthenticatedRequestUser) {
    const [connection, tenant] = await Promise.all([
      this.prisma.whatsappConnection.findUnique({ where: { tenantId: user.tenantId } }),
      this.prisma.tenant.findUniqueOrThrow({
        where: { id: user.tenantId },
        select: { timezone: true },
      }),
    ]);
    const dayStart = startOfDayInTimeZone(todayInTimeZone(tenant.timezone), tenant.timezone);
    const [repliesToday, tokens, conversations] = await Promise.all([
      this.prisma.whatsappMessage.count({
        where: { tenantId: user.tenantId, author: 'ASSISTANT', createdAt: { gte: dayStart } },
      }),
      this.prisma.whatsappMessage.aggregate({
        where: { tenantId: user.tenantId, author: 'ASSISTANT', createdAt: { gte: dayStart } },
        _sum: { inputTokens: true, outputTokens: true },
      }),
      this.prisma.whatsappConversation.groupBy({
        by: ['status'],
        where: { tenantId: user.tenantId },
        _count: true,
      }),
    ]);
    const ai = this.config.get('whatsapp', { infer: true }).ai;
    const provider = this.registry.activeName;
    return {
      connection: connection
        ? {
            mode: connection.mode,
            displayPhoneNumber: connection.displayPhoneNumber,
            phoneNumberId: connection.phoneNumberId,
            createdAt: connection.createdAt.toISOString(),
          }
        : null,
      settings: connection
        ? {
            assistantEnabled: connection.assistantEnabled,
            greetingMessage: connection.greetingMessage,
            behaviorInstructions: connection.behaviorInstructions,
            aiDailyReplyLimit: connection.aiDailyReplyLimit,
          }
        : null,
      ai: { provider, model: provider === 'anthropic' ? ai.model : null },
      usageToday: {
        assistantReplies: repliesToday,
        inputTokens: tokens._sum.inputTokens ?? 0,
        outputTokens: tokens._sum.outputTokens ?? 0,
      },
      conversations: {
        ai: conversations.find((c) => c.status === 'AI')?._count ?? 0,
        human: conversations.find((c) => c.status === 'HUMAN')?._count ?? 0,
      },
      cloudSendingEnabled: this.config.get('whatsapp', { infer: true }).cloudEnabled,
    };
  }

  // A simulated number for the restaurant (the only kind this version creates). The real Cloud API
  // number is connected later, after approval, by the platform.
  async createSimulatedConnection(user: AuthenticatedRequestUser) {
    const existing = await this.prisma.whatsappConnection.findUnique({
      where: { tenantId: user.tenantId },
    });
    if (existing) return this.getSettings(user);
    const suffix = String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
    const connection = await this.prisma.whatsappConnection.create({
      data: {
        tenantId: user.tenantId,
        mode: 'SIMULATED',
        phoneNumberId: `sim-${randomUUID()}`,
        displayPhoneNumber: `+55 00 9${suffix.slice(0, 4)}-${suffix.slice(4)}`,
        greetingMessage: 'Olá! Sou o assistente virtual do restaurante. 😊',
      },
    });
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'whatsapp.connection.create',
      entity: 'WhatsappConnection',
      entityId: connection.id,
      afterData: { mode: connection.mode },
    });
    return this.getSettings(user);
  }

  async updateSettings(user: AuthenticatedRequestUser, dto: UpdateWhatsappSettingsDto) {
    const connection = await this.requireConnection(user.tenantId);
    const data = {
      ...(dto.assistantEnabled !== undefined ? { assistantEnabled: dto.assistantEnabled } : {}),
      ...(dto.greetingMessage !== undefined
        ? { greetingMessage: dto.greetingMessage?.trim() || null }
        : {}),
      ...(dto.behaviorInstructions !== undefined
        ? { behaviorInstructions: dto.behaviorInstructions?.trim() || null }
        : {}),
      ...(dto.aiDailyReplyLimit !== undefined ? { aiDailyReplyLimit: dto.aiDailyReplyLimit } : {}),
    };
    const updated = await this.prisma.whatsappConnection.update({
      where: { id: connection.id },
      data,
    });
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'whatsapp.settings.update',
      entity: 'WhatsappConnection',
      entityId: connection.id,
      beforeData: {
        assistantEnabled: connection.assistantEnabled,
        aiDailyReplyLimit: connection.aiDailyReplyLimit,
      },
      afterData: {
        assistantEnabled: updated.assistantEnabled,
        aiDailyReplyLimit: updated.aiDailyReplyLimit,
        greetingChanged: connection.greetingMessage !== updated.greetingMessage,
        behaviorChanged: connection.behaviorInstructions !== updated.behaviorInstructions,
      },
    });
    return this.getSettings(user);
  }

  // ---- conversations -----------------------------------------------------------------------

  async listConversations(user: AuthenticatedRequestUser, status?: WhatsappConversationStatus) {
    const rows = await this.prisma.whatsappConversation.findMany({
      where: { tenantId: user.tenantId, ...(status ? { status } : {}) },
      orderBy: [{ lastMessageAt: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      include: {
        contact: {
          select: { waId: true, profileName: true, optedOutAt: true, lastInboundAt: true },
        },
        assignedUser: { select: { id: true, name: true } },
        messages: {
          orderBy: [{ providerTimestamp: 'desc' }, { createdAt: 'desc' }],
          take: 1,
          select: { body: true, author: true, providerTimestamp: true },
        },
      },
    });
    return rows.map((c) => ({
      id: c.id,
      status: c.status,
      contact: {
        name: c.contact.profileName,
        waId: c.contact.waId,
        optedOut: c.contact.optedOutAt !== null,
      },
      assignedUser: c.assignedUser,
      unreadCount: c.unreadCount,
      lastMessage: c.messages[0]
        ? {
            body: c.messages[0].body.slice(0, 160),
            author: c.messages[0].author,
            at: c.messages[0].providerTimestamp.toISOString(),
          }
        : null,
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
      windowOpen: windowOpen(c.contact.lastInboundAt),
    }));
  }

  async getConversation(user: AuthenticatedRequestUser, id: string) {
    const c = await this.prisma.whatsappConversation.findFirst({
      where: { id, tenantId: user.tenantId },
      include: {
        contact: {
          select: { waId: true, profileName: true, optedOutAt: true, lastInboundAt: true },
        },
        assignedUser: { select: { id: true, name: true } },
      },
    });
    if (!c) throw conversationNotFound();
    const messages = await this.prisma.whatsappMessage.findMany({
      where: { conversationId: c.id, tenantId: user.tenantId },
      orderBy: [{ providerTimestamp: 'asc' }, { createdAt: 'asc' }],
      take: 300,
      include: { authorUser: { select: { name: true } } },
    });
    return {
      id: c.id,
      status: c.status,
      contact: {
        name: c.contact.profileName,
        waId: c.contact.waId,
        optedOut: c.contact.optedOutAt !== null,
      },
      assignedUser: c.assignedUser,
      unreadCount: c.unreadCount,
      windowOpen: windowOpen(c.contact.lastInboundAt),
      cartItems: Array.isArray(c.cart) ? c.cart.length : 0,
      messages: messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        author: m.author,
        authorName: m.authorUser?.name ?? null,
        body: m.body,
        type: m.type,
        status: m.status,
        at: m.providerTimestamp.toISOString(),
        errorCode: m.errorCode,
        aiProvider: m.aiProvider,
      })),
    };
  }

  async markRead(user: AuthenticatedRequestUser, id: string) {
    const updated = await this.prisma.whatsappConversation.updateMany({
      where: { id, tenantId: user.tenantId },
      data: { unreadCount: 0 },
    });
    if (updated.count === 0) throw conversationNotFound();
    return { ok: true };
  }

  // A person answers. The conversation becomes theirs (the assistant stops), and every customer
  // message so far counts as answered.
  async reply(user: AuthenticatedRequestUser, id: string, text: string) {
    const c = await this.prisma.whatsappConversation.findFirst({
      where: { id, tenantId: user.tenantId },
      include: { contact: true },
    });
    if (!c) throw conversationNotFound();
    if (c.contact.optedOutAt) {
      throw new ConflictException({
        code: 'OPTED_OUT',
        message: 'O cliente pediu para não receber mensagens.',
      });
    }
    if (!windowOpen(c.contact.lastInboundAt)) {
      throw new ConflictException({
        code: 'WINDOW_CLOSED',
        message:
          'Passaram 24 horas desde a última mensagem do cliente. O WhatsApp só permite responder com um modelo aprovado.',
      });
    }
    const now = new Date();
    const message = await this.prisma.$transaction(async (tx) => {
      const created = await tx.whatsappMessage.create({
        data: {
          tenantId: user.tenantId,
          conversationId: c.id,
          direction: 'OUTBOUND',
          author: 'AGENT',
          authorUserId: user.userId,
          body: text.trim(),
          status: 'QUEUED',
          providerTimestamp: now,
        },
      });
      await tx.whatsappMessage.updateMany({
        where: { conversationId: c.id, direction: 'INBOUND', handledAt: null },
        data: { handledAt: now },
      });
      await tx.whatsappConversation.update({
        where: { id: c.id },
        data: {
          status: 'HUMAN',
          assignedUserId: c.assignedUserId ?? user.userId,
          lastMessageAt: now,
          unreadCount: 0,
        },
      });
      await this.queue.enqueue(
        {
          tenantId: user.tenantId,
          conversationId: c.id,
          type: 'SEND',
          dedupeKey: `send:${created.id}`,
          messageId: created.id,
        },
        tx,
      );
      return created;
    });
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'whatsapp.message.agent_reply',
      entity: 'WhatsappConversation',
      entityId: c.id,
      afterData: {
        messageId: message.id,
        length: message.body.length,
        tookOver: c.status === 'AI',
      },
    });
    this.worker.kick();
    return { id: message.id, status: message.status };
  }

  async assume(user: AuthenticatedRequestUser, id: string) {
    const c = await this.prisma.whatsappConversation.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!c) throw conversationNotFound();
    await this.prisma.whatsappConversation.update({
      where: { id: c.id },
      data: { status: 'HUMAN', assignedUserId: user.userId },
    });
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'whatsapp.conversation.assume',
      entity: 'WhatsappConversation',
      entityId: c.id,
      beforeData: { status: c.status, assignedUserId: c.assignedUserId },
      afterData: { status: 'HUMAN', assignedUserId: user.userId },
    });
    return this.getConversation(user, id);
  }

  // Back to the assistant. Messages the team left unanswered are NOT answered by the assistant
  // afterwards (it would reply to something old out of context); it answers the next one.
  async release(user: AuthenticatedRequestUser, id: string) {
    const c = await this.prisma.whatsappConversation.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!c) throw conversationNotFound();
    const now = new Date();
    await this.prisma.$transaction([
      this.prisma.whatsappMessage.updateMany({
        where: { conversationId: c.id, direction: 'INBOUND', handledAt: null },
        data: { handledAt: now },
      }),
      this.prisma.whatsappConversation.update({
        where: { id: c.id },
        data: { status: 'AI', assignedUserId: null, aiFailures: 0, dialogState: Prisma.DbNull },
      }),
    ]);
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'whatsapp.conversation.release',
      entity: 'WhatsappConversation',
      entityId: c.id,
      beforeData: { status: c.status, assignedUserId: c.assignedUserId },
      afterData: { status: 'AI' },
    });
    return this.getConversation(user, id);
  }

  // ---- simulator ---------------------------------------------------------------------------

  // Plays a customer message through the SAME path as a Meta delivery (payload of the Cloud API
  // shape -> ingest -> queue -> assistant -> sender), for a SIMULATED connection only.
  async simulate(user: AuthenticatedRequestUser, dto: SimulateMessageDto) {
    const connection = await this.requireConnection(user.tenantId);
    if (connection.mode !== 'SIMULATED') {
      throw new ConflictException({
        code: 'NOT_SIMULATED',
        message: 'O simulador só funciona com o número simulado.',
      });
    }
    const waId = `5500${dto.contactPhone.replace(/\D/g, '').slice(-9).padStart(9, '0')}`;
    const payload = buildInboundPayload({
      phoneNumberId: connection.phoneNumberId,
      displayPhoneNumber: connection.displayPhoneNumber,
      waId,
      profileName: dto.contactName.trim(),
      providerMessageId: `wamid.sim.${randomUUID()}`,
      body: dto.text,
      timestamp: new Date(),
    });
    const raw = JSON.stringify(payload);
    const result = await this.ingest.ingest(payload, raw);
    this.worker.kick();
    const contact = await this.prisma.whatsappContact.findUnique({
      where: { connectionId_waId: { connectionId: connection.id, waId } },
      include: { conversation: { select: { id: true } } },
    });
    return { conversationId: contact?.conversation?.id ?? null, waId, stored: result.stored };
  }

  private async requireConnection(tenantId: string) {
    const connection = await this.prisma.whatsappConnection.findUnique({ where: { tenantId } });
    if (!connection) {
      throw new NotFoundException({
        code: 'NO_CONNECTION',
        message: 'O WhatsApp ainda não foi configurado para este restaurante.',
      });
    }
    return connection;
  }
}
