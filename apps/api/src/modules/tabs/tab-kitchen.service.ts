import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, TabItemStatus } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { TabsService } from './tabs.service';
import { isValidTabItemTransition } from './tab-item-rules';
import { AdvanceTabRoundDto } from './dto/advance-tab-round.dto';

// When each production step happened, on the item itself (who did it is in the audit log).
const STEP_TIMESTAMP: Partial<Record<TabItemStatus, 'preparingAt' | 'readyAt' | 'servedAt'>> = {
  PREPARING: 'preparingAt',
  READY: 'readyAt',
  SERVED: 'servedAt',
};

// ===========================================================================
// B9: production of table items. The kitchen works round by round (the cards of the kitchen
// board); the waiter delivers item by item. Production is not billing: none of this needs the tab
// to be open (a bill paid up front still has its food made and delivered), none of it touches the
// stock (consumed when the round was sent) or the money.
// Locks: only the item rows (FOR UPDATE, in id order). A cancellation locks the tab and then the
// item, so the two serialize on the item and never wait on each other in a cycle.
// ===========================================================================
@Injectable()
export class TabKitchenService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchAccess: BranchAccessService,
    private readonly tabs: TabsService,
  ) {}

  async advanceRound(user: AuthenticatedRequestUser, roundId: string, dto: AdvanceTabRoundDto) {
    const round = await this.prisma.tabRound.findFirst({
      where: { id: roundId, tenantId: user.tenantId },
      select: { id: true, tabId: true, branchId: true, number: true },
    });
    if (!round) throw new NotFoundException({ code: 'TAB_ROUND_NOT_FOUND', message: 'Rodada não encontrada.' });
    await this.branchAccess.assertAccess(user, round.branchId);
    if (!isValidTabItemTransition(dto.from, dto.to)) {
      throw new ConflictException({ code: 'INVALID_STATUS_TRANSITION', message: 'Não é possível mover a rodada para esse estado.' });
    }

    const itemIds = await this.prisma.$transaction(async (tx) => {
      // The WHERE is re-checked after each lock is granted: items another screen moved (or a
      // cancellation emptied) meanwhile are simply not returned.
      const rows = await tx.$queryRaw<{ id: string }[]>`
        SELECT "id" FROM "tab_items"
        WHERE "roundId" = ${round.id} AND "status" = ${dto.from}::"TabItemStatus"
        ORDER BY "id" FOR UPDATE`;
      if (rows.length === 0) {
        throw new ConflictException({
          code: 'TAB_ROUND_ALREADY_MOVED',
          message: 'Esta rodada já foi atualizada (em outra tela ou por um cancelamento).',
        });
      }
      const ids = rows.map((row) => row.id);
      await this.moveItemsInTx(tx, ids, dto.to);
      return ids;
    });

    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'TAB_ROUND_STATUS_CHANGED',
      entity: 'TabRound',
      entityId: round.id,
      beforeData: { status: dto.from },
      afterData: { status: dto.to, tabId: round.tabId, number: round.number, tabItemIds: itemIds },
    });
    return { roundId: round.id, from: dto.from, to: dto.to, itemIds };
  }

  // The waiter took this item to the table. From any state still in production.
  async serveItem(user: AuthenticatedRequestUser, tabId: string, itemId: string) {
    const tab = await this.tabs.findTabForWrite(user, tabId);
    const before = await this.prisma.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ status: TabItemStatus }[]>`
        SELECT "status" FROM "tab_items" WHERE "id" = ${itemId} AND "tabId" = ${tab.id} FOR UPDATE`;
      if (rows.length === 0) throw this.tabs.itemNotFound();
      if (!isValidTabItemTransition(rows[0].status, 'SERVED')) {
        throw new ConflictException({
          code: 'TAB_ITEM_NOT_IN_PRODUCTION',
          message: 'Este item já foi entregue ou cancelado.',
        });
      }
      await this.moveItemsInTx(tx, [itemId], 'SERVED');
      return rows[0].status;
    });

    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'TAB_ITEM_SERVED',
      entity: 'TabItem',
      entityId: itemId,
      beforeData: { status: before },
      afterData: { status: 'SERVED', tabId: tab.id },
    });
    return this.tabs.findOneForTenant(user, tab.id);
  }

  private async moveItemsInTx(tx: Prisma.TransactionClient, ids: string[], to: TabItemStatus) {
    const stamp = STEP_TIMESTAMP[to];
    await tx.tabItem.updateMany({
      where: { id: { in: ids } },
      data: { status: to, ...(stamp ? { [stamp]: new Date() } : {}) },
    });
  }
}
