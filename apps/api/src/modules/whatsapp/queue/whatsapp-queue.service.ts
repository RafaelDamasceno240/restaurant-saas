import { Injectable } from '@nestjs/common';
import { Prisma, WhatsappJob, WhatsappJobType } from '@prisma/client';
import { PrismaService } from '../../../prisma/prisma.service';

// A durable queue on PostgreSQL (no new infrastructure): jobs are rows, claimed one at a time with
// FOR UPDATE SKIP LOCKED, so two API instances never take the same job. Each job has a dedupe key
// ("reply:<message id>", "send:<message id>"), so the same work is never queued twice, and failed
// jobs come back with exponential backoff until maxAttempts. A job left RUNNING by a process that
// died is taken again after STALE_LOCK_MS.

export const STALE_LOCK_MS = 5 * 60 * 1000;
const MAX_BACKOFF_MS = 5 * 60 * 1000;

export function backoffMs(attempts: number): number {
  return Math.min(2 ** Math.max(attempts - 1, 0) * 2_000, MAX_BACKOFF_MS);
}

type Tx = Prisma.TransactionClient | PrismaService;

@Injectable()
export class WhatsappQueueService {
  constructor(private readonly prisma: PrismaService) {}

  // Inside the caller's transaction when given one: the job exists if and only if the data that
  // asked for it was committed. A second enqueue with the same key is a no-op.
  async enqueue(
    input: {
      tenantId: string;
      conversationId: string;
      type: WhatsappJobType;
      dedupeKey: string;
      messageId?: string;
      runAt?: Date;
    },
    tx: Tx = this.prisma,
  ): Promise<void> {
    await tx.whatsappJob.createMany({
      data: [
        {
          tenantId: input.tenantId,
          conversationId: input.conversationId,
          type: input.type,
          dedupeKey: input.dedupeKey,
          messageId: input.messageId ?? null,
          runAt: input.runAt ?? new Date(),
        },
      ],
      skipDuplicates: true,
    });
  }

  async claimNext(now: Date = new Date()): Promise<WhatsappJob | null> {
    const staleBefore = new Date(now.getTime() - STALE_LOCK_MS);
    const rows = await this.prisma.$queryRaw<WhatsappJob[]>`
      UPDATE "whatsapp_jobs" SET "status" = 'RUNNING', "lockedAt" = ${now}, "attempts" = "attempts" + 1, "updatedAt" = ${now}
      WHERE "id" = (
        SELECT "id" FROM "whatsapp_jobs"
        WHERE ("status" = 'PENDING' AND "runAt" <= ${now})
           OR ("status" = 'RUNNING' AND "lockedAt" < ${staleBefore})
        ORDER BY "runAt" ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
      )
      RETURNING *`;
    return rows[0] ?? null;
  }

  async complete(jobId: string): Promise<void> {
    await this.prisma.whatsappJob.update({
      where: { id: jobId },
      data: { status: 'DONE', lockedAt: null, lastError: null },
    });
  }

  // Not an attempt: the conversation was busy, try again in a moment.
  async postpone(job: WhatsappJob, delayMs: number): Promise<void> {
    await this.prisma.whatsappJob.update({
      where: { id: job.id },
      data: {
        status: 'PENDING',
        lockedAt: null,
        attempts: { decrement: 1 },
        runAt: new Date(Date.now() + delayMs),
      },
    });
  }

  async fail(job: WhatsappJob, error: string, retryable: boolean): Promise<'retry' | 'failed'> {
    const lastError = error.slice(0, 500);
    if (retryable && job.attempts < job.maxAttempts) {
      await this.prisma.whatsappJob.update({
        where: { id: job.id },
        data: {
          status: 'PENDING',
          lockedAt: null,
          lastError,
          runAt: new Date(Date.now() + backoffMs(job.attempts)),
        },
      });
      return 'retry';
    }
    await this.prisma.whatsappJob.update({
      where: { id: job.id },
      data: { status: 'FAILED', lockedAt: null, lastError },
    });
    return 'failed';
  }
}
