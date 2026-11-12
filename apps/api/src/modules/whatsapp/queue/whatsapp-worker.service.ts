import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { WhatsappJob } from '@prisma/client';
import { AppConfig } from '../../../config/configuration';
import { AssistantProviderError } from '../assistant/assistant-provider';
import { WhatsappReplyService } from '../whatsapp-reply.service';
import { RetryableSendError, WhatsappSendService } from '../whatsapp-send.service';
import { WhatsappQueueService } from './whatsapp-queue.service';

const POLL_MS = 1_000;
const BUSY_RETRY_MS = 1_500;

// Runs the queue inside the API process, one job at a time (low memory, no extra service). Woken
// right after a webhook or a panel action (kick) and every second for retries. In the test
// environment it never runs by itself: the suites call drain() and see the result at once.
@Injectable()
export class WhatsappWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WhatsappWorkerService.name);
  private readonly auto: boolean;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<number> | null = null;
  private again = false;

  constructor(
    private readonly queue: WhatsappQueueService,
    private readonly reply: WhatsappReplyService,
    private readonly send: WhatsappSendService,
    config: ConfigService<AppConfig, true>,
  ) {
    this.auto =
      config.get('whatsapp', { infer: true }).workerEnabled &&
      config.get('env', { infer: true }) !== 'test';
  }

  onModuleInit(): void {
    if (!this.auto) return;
    this.timer = setInterval(() => this.kick(), POLL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  kick(): void {
    if (!this.auto) return;
    if (this.running) {
      this.again = true;
      return;
    }
    void this.drain().catch((error) =>
      this.logger.error(`queue drain failed: ${(error as Error).message}`),
    );
  }

  // Processes every job that is due, then returns how many ran. Concurrent calls share one run.
  async drain(maxJobs = 200): Promise<number> {
    if (this.running) {
      await this.running;
    }
    this.running = this.run(maxJobs);
    try {
      return await this.running;
    } finally {
      this.running = null;
      if (this.again) {
        this.again = false;
        this.kick();
      }
    }
  }

  private async run(maxJobs: number): Promise<number> {
    let done = 0;
    while (done < maxJobs) {
      const job = await this.queue.claimNext();
      if (!job) break;
      await this.process(job);
      done += 1;
    }
    return done;
  }

  private async process(job: WhatsappJob): Promise<void> {
    try {
      if (job.type === 'REPLY') {
        const outcome = await this.reply.process(job);
        if (outcome === 'busy') {
          await this.queue.postpone(job, BUSY_RETRY_MS);
          return;
        }
      } else {
        await this.send.process(job);
      }
      await this.queue.complete(job.id);
    } catch (error) {
      const retryable =
        error instanceof RetryableSendError ||
        (error instanceof AssistantProviderError ? error.retryable : true);
      const outcome = await this.queue.fail(job, (error as Error).message ?? 'error', retryable);
      this.logger.warn(
        `job ${job.type} ${job.id} ${outcome} (attempt ${job.attempts}): ${(error as Error).message}`,
      );
    }
  }
}
