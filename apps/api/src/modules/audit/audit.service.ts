import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface AuditEntry {
  tenantId?: string | null;
  userId?: string | null;
  action: string;
  entity: string;
  entityId?: string | null;
  beforeData?: unknown;
  afterData?: unknown;
  ip?: string | null;
  userAgent?: string | null;
}

// Centralized audit writer. Failures here are logged but never allowed to
// break the request that triggered them (auditing is best-effort by design
// in Phase 01 — it must not become a reason for a login/registration to
// fail).
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(entry: AuditEntry): Promise<void> {
    try {
      await this.prisma.auditLog.create({
        data: {
          tenantId: entry.tenantId ?? null,
          userId: entry.userId ?? null,
          action: entry.action,
          entity: entry.entity,
          entityId: entry.entityId ?? null,
          beforeData: entry.beforeData as never,
          afterData: entry.afterData as never,
          ip: entry.ip ?? null,
          userAgent: entry.userAgent ?? null,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to write audit log for action "${entry.action}"`, error as Error);
    }
  }
}
