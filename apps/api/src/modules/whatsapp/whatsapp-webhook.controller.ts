import {
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Post,
  Query,
  RawBodyRequest,
  Req,
  Res,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiExcludeController } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { AppConfig } from '../../config/configuration';
import { Public } from '../../common/decorators/public.decorator';
import { WhatsappIngestService } from './whatsapp-ingest.service';
import { WhatsappWorkerService } from './queue/whatsapp-worker.service';
import {
  SIGNATURE_HEADER,
  isValidSignature,
  verifySubscription,
} from './webhook/whatsapp-signature';

// The official webhook of the WhatsApp Business Platform. Public (Meta has no JWT) and not rate
// limited per IP (Meta delivers in bursts); every POST must carry a valid X-Hub-Signature-256
// computed with the App Secret over the raw body, or it is refused before anything is read.
@ApiExcludeController()
@Public()
@SkipThrottle()
@Controller('whatsapp/webhook')
export class WhatsappWebhookController {
  private readonly appSecret: string | null;
  private readonly verifyToken: string | null;

  constructor(
    private readonly ingest: WhatsappIngestService,
    private readonly worker: WhatsappWorkerService,
    config: ConfigService<AppConfig, true>,
  ) {
    const whatsapp = config.get('whatsapp', { infer: true });
    this.appSecret = whatsapp.appSecret;
    this.verifyToken = whatsapp.verifyToken;
  }

  @Get()
  verify(@Query() query: Record<string, unknown>, @Res() res: Response) {
    const challenge = verifySubscription(query, this.verifyToken);
    if (challenge === null)
      throw new ForbiddenException({ code: 'FORBIDDEN', message: 'Verificação recusada.' });
    res.status(200).type('text/plain').send(challenge);
  }

  @Post()
  @HttpCode(200)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers(SIGNATURE_HEADER) signature: string | undefined,
  ) {
    if (!this.appSecret) {
      throw new ServiceUnavailableException({
        code: 'WEBHOOK_NOT_CONFIGURED',
        message: 'Webhook do WhatsApp não configurado.',
      });
    }
    if (!isValidSignature(req.rawBody, signature, this.appSecret)) {
      throw new UnauthorizedException({
        code: 'INVALID_SIGNATURE',
        message: 'Assinatura inválida.',
      });
    }
    const result = await this.ingest.ingest(req.body, req.rawBody!);
    this.worker.kick();
    return {
      received: true,
      stored: result.stored,
      duplicates: result.duplicates + (result.duplicateDelivery ? 1 : 0),
    };
  }
}
