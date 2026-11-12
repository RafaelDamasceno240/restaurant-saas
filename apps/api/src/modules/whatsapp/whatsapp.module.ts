import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { OrderCreationModule } from '../order-creation/order-creation.module';
import { PublicMenuModule } from '../public-menu/public-menu.module';
import {
  AssistantEngineService,
  AssistantProviderRegistry,
} from './assistant/assistant-engine.service';
import { WhatsappQueueService } from './queue/whatsapp-queue.service';
import { WhatsappWorkerService } from './queue/whatsapp-worker.service';
import { WhatsappCheckoutService } from './whatsapp-checkout.service';
import { WhatsappIngestService } from './whatsapp-ingest.service';
import { PublicWhatsappCartController, WhatsappPanelController } from './whatsapp-panel.controller';
import { WhatsappPanelService } from './whatsapp-panel.service';
import { WhatsappReplyService } from './whatsapp-reply.service';
import { WhatsappSendService } from './whatsapp-send.service';
import { WhatsappWebhookController } from './whatsapp-webhook.controller';

// WhatsApp assistant: webhook -> ingest -> queue -> assistant (provider + toolbox + guards) ->
// sender, plus the attendance panel, the simulator and the checkout links.
@Module({
  imports: [AuditModule, OrderCreationModule, PublicMenuModule],
  controllers: [WhatsappWebhookController, WhatsappPanelController, PublicWhatsappCartController],
  providers: [
    AssistantProviderRegistry,
    AssistantEngineService,
    WhatsappQueueService,
    WhatsappWorkerService,
    WhatsappIngestService,
    WhatsappReplyService,
    WhatsappSendService,
    WhatsappPanelService,
    WhatsappCheckoutService,
  ],
  exports: [AssistantProviderRegistry, WhatsappWorkerService],
})
export class WhatsappModule {}
