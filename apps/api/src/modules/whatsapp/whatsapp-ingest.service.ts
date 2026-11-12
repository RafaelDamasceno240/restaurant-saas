import { createHash } from 'crypto';
import { Injectable, Logger } from '@nestjs/common';
import { Prisma, WhatsappConnection } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { wantsOptOut } from './assistant/assistant-guards';
import { WhatsappQueueService } from './queue/whatsapp-queue.service';
import {
  InboundMessageEvent,
  StatusEvent,
  nextStatus,
  parseWebhook,
} from './webhook/whatsapp-payload';

export interface IngestResult {
  duplicateDelivery: boolean;
  stored: number;
  duplicates: number;
  unknownNumber: number;
  statuses: number;
}

const isUniqueViolation = (error: unknown) =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

// Stores what a webhook delivery carries. Idempotent at two levels: the same delivery (same
// bytes) is recognised by its hash, and the same message inside another delivery by its wamid
// (unique per restaurant). The restaurant comes ONLY from the phone number id of the delivery,
// never from anything the customer wrote.
@Injectable()
export class WhatsappIngestService {
  private readonly logger = new Logger(WhatsappIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly queue: WhatsappQueueService,
  ) {}

  async ingest(payload: unknown, rawBody: Buffer | string): Promise<IngestResult> {
    const payloadHash = createHash('sha256').update(rawBody).digest('hex');
    const parsed = parseWebhook(payload);
    const result: IngestResult = {
      duplicateDelivery: false,
      stored: 0,
      duplicates: 0,
      unknownNumber: 0,
      statuses: 0,
    };

    let eventId: string;
    try {
      const event = await this.prisma.whatsappWebhookEvent.create({
        data: {
          payloadHash,
          messagesCount: parsed.messages.length,
          statusesCount: parsed.statuses.length,
        },
      });
      eventId = event.id;
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const seen = await this.prisma.whatsappWebhookEvent.update({
        where: { payloadHash },
        data: { duplicates: { increment: 1 } },
      });
      // A delivery that failed half-way is processed again (Meta retries it); the messages already
      // stored are recognised one by one below.
      if (seen.processedAt) {
        result.duplicateDelivery = true;
        return result;
      }
      eventId = seen.id;
    }

    const connections = new Map<string, WhatsappConnection | null>();
    const connectionFor = async (phoneNumberId: string) => {
      if (!connections.has(phoneNumberId)) {
        connections.set(
          phoneNumberId,
          await this.prisma.whatsappConnection.findUnique({ where: { phoneNumberId } }),
        );
      }
      return connections.get(phoneNumberId) ?? null;
    };

    try {
      // Oldest first, so the thread and the counters are built in the customer's order.
      for (const message of [...parsed.messages].sort(
        (a, b) => a.timestamp.getTime() - b.timestamp.getTime(),
      )) {
        const connection = await connectionFor(message.phoneNumberId);
        if (!connection) {
          result.unknownNumber += 1;
          continue;
        }
        const outcome = await this.storeInbound(connection, message);
        if (outcome === 'stored') result.stored += 1;
        else result.duplicates += 1;
      }
      for (const status of parsed.statuses) {
        const connection = await connectionFor(status.phoneNumberId);
        if (connection && (await this.applyStatus(connection.tenantId, status)))
          result.statuses += 1;
      }
      await this.prisma.whatsappWebhookEvent.update({
        where: { id: eventId },
        data: { processedAt: new Date() },
      });
    } catch (error) {
      await this.prisma.whatsappWebhookEvent
        .update({ where: { id: eventId }, data: { error: (error as Error).message.slice(0, 500) } })
        .catch(() => undefined);
      throw error;
    }
    return result;
  }

  private async storeInbound(
    connection: WhatsappConnection,
    event: InboundMessageEvent,
  ): Promise<'stored' | 'duplicate'> {
    const tenantId = connection.tenantId;
    const known = await this.prisma.whatsappMessage.findUnique({
      where: {
        tenantId_providerMessageId: { tenantId, providerMessageId: event.providerMessageId },
      },
      select: { id: true },
    });
    if (known) return 'duplicate';

    try {
      await this.prisma.$transaction(async (tx) => {
        const contact = await tx.whatsappContact.upsert({
          where: { connectionId_waId: { connectionId: connection.id, waId: event.waId } },
          create: {
            tenantId,
            connectionId: connection.id,
            waId: event.waId,
            profileName: event.profileName,
          },
          update: event.profileName ? { profileName: event.profileName } : {},
        });
        const conversation = await tx.whatsappConversation.upsert({
          where: { contactId: contact.id },
          create: { tenantId, contactId: contact.id },
          update: {},
        });
        const message = await tx.whatsappMessage.create({
          data: {
            tenantId,
            conversationId: conversation.id,
            direction: 'INBOUND',
            author: 'CUSTOMER',
            providerMessageId: event.providerMessageId,
            type: event.type,
            body: event.body,
            status: 'RECEIVED',
            providerTimestamp: event.timestamp,
          },
        });

        const later = (current: Date | null) =>
          current && current > event.timestamp ? current : event.timestamp;
        const optOut = event.type === 'text' && wantsOptOut(event.body);
        await tx.whatsappContact.update({
          where: { id: contact.id },
          data: {
            lastInboundAt: later(contact.lastInboundAt),
            // "parar" opts out; any other message written later by the customer opts back in.
            optedOutAt: optOut
              ? new Date()
              : contact.optedOutAt && event.timestamp > contact.optedOutAt
                ? null
                : contact.optedOutAt,
          },
        });
        await tx.whatsappConversation.update({
          where: { id: conversation.id },
          data: {
            lastInboundAt: later(conversation.lastInboundAt),
            lastMessageAt: later(conversation.lastMessageAt),
            unreadCount: { increment: 1 },
          },
        });
        // The assistant answers only conversations it is in charge of, of a restaurant that has it
        // on. Otherwise the message waits for a person in the panel.
        if (connection.assistantEnabled && conversation.status === 'AI') {
          await this.queue.enqueue(
            {
              tenantId,
              conversationId: conversation.id,
              type: 'REPLY',
              dedupeKey: `reply:${message.id}`,
              messageId: message.id,
            },
            tx,
          );
        }
      });
    } catch (error) {
      // Two deliveries of the same message at the same moment: the second one loses the race.
      if (isUniqueViolation(error)) return 'duplicate';
      throw error;
    }
    return 'stored';
  }

  private async applyStatus(tenantId: string, event: StatusEvent): Promise<boolean> {
    const message = await this.prisma.whatsappMessage.findUnique({
      where: {
        tenantId_providerMessageId: { tenantId, providerMessageId: event.providerMessageId },
      },
      select: { id: true, status: true, direction: true },
    });
    if (!message || message.direction !== 'OUTBOUND') return false;
    const status = nextStatus(message.status, event.status);
    if (!status) return false;
    await this.prisma.whatsappMessage.update({
      where: { id: message.id },
      data: {
        status,
        ...(status === 'FAILED'
          ? { errorCode: event.errorCode, errorMessage: event.errorMessage }
          : {}),
      },
    });
    if (status === 'FAILED')
      this.logger.warn(
        `outbound message ${message.id} failed at the provider (${event.errorCode})`,
      );
    return true;
  }
}
