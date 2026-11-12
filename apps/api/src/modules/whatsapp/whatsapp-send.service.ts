import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappJob } from '@prisma/client';
import { AppConfig } from '../../config/configuration';
import { PrismaService } from '../../prisma/prisma.service';
import {
  CloudApiSender,
  SimulatedSender,
  WhatsappSender,
  decryptToken,
  windowOpen,
} from './sender/whatsapp-sender';

export class RetryableSendError extends Error {}

// Hands one QUEUED outbound message to its connection's sender. Never sends twice: a message that
// is no longer QUEUED is left alone, and the SEND job of a message is unique.
@Injectable()
export class WhatsappSendService {
  private readonly simulated: WhatsappSender = new SimulatedSender();
  private readonly cloud: WhatsappSender;
  private readonly cloudEnabled: boolean;
  private readonly encryptionKey: string | null;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<AppConfig, true>,
  ) {
    const whatsapp = config.get('whatsapp', { infer: true });
    this.cloudEnabled = whatsapp.cloudEnabled;
    this.encryptionKey = whatsapp.tokenEncryptionKey;
    this.cloud = new CloudApiSender(whatsapp.graphApiVersion);
  }

  async process(job: WhatsappJob): Promise<void> {
    if (!job.messageId) return;
    const message = await this.prisma.whatsappMessage.findFirst({
      where: { id: job.messageId, tenantId: job.tenantId },
      include: { conversation: { include: { contact: { include: { connection: true } } } } },
    });
    if (!message || message.direction !== 'OUTBOUND' || message.status !== 'QUEUED') return;
    const contact = message.conversation.contact;
    const connection = contact.connection;

    const refuse = (errorCode: string, errorMessage: string) =>
      this.prisma.whatsappMessage.update({
        where: { id: message.id },
        data: { status: 'FAILED', errorCode, errorMessage },
      });

    if (contact.optedOutAt && message.type !== 'optout_confirmation') {
      await refuse('OPTED_OUT', 'O cliente pediu para não receber mensagens.');
      return;
    }
    if (!windowOpen(contact.lastInboundAt)) {
      await refuse('WINDOW_CLOSED', 'Passaram 24 horas desde a última mensagem do cliente.');
      return;
    }

    let sender: WhatsappSender;
    let accessToken: string | null = null;
    if (connection.mode === 'SIMULATED') {
      sender = this.simulated;
    } else {
      if (!this.cloudEnabled) {
        await refuse('CLOUD_DISABLED', 'Envio pela Cloud API desativado neste ambiente.');
        return;
      }
      sender = this.cloud;
      if (connection.accessTokenEncrypted && this.encryptionKey) {
        accessToken = decryptToken(connection.accessTokenEncrypted, this.encryptionKey);
      }
    }

    const result = await sender.send({
      phoneNumberId: connection.phoneNumberId,
      to: contact.waId,
      body: message.body,
      accessToken,
    });
    if (result.ok) {
      await this.prisma.whatsappMessage.update({
        where: { id: message.id },
        data: {
          status: result.delivered ? 'DELIVERED' : 'SENT',
          providerMessageId: result.providerMessageId,
          errorCode: null,
          errorMessage: null,
        },
      });
      return;
    }
    if (result.retryable && job.attempts < job.maxAttempts) {
      await this.prisma.whatsappMessage.update({
        where: { id: message.id },
        data: { errorCode: result.code, errorMessage: result.message },
      });
      throw new RetryableSendError(result.message);
    }
    await refuse(result.code, result.message);
  }
}
