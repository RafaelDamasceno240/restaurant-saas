import { Injectable } from '@nestjs/common';
import { LoyaltyEntry, LoyaltyEntryType, LoyaltyReward, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { isConcludedOrderStatus } from '../../common/util/order-conclusion.util';
import { customerInactive, customerNotFound } from '../customers/customer-errors';
import { creditWithinLimit, earnedPoints, MAX_POINTS_BALANCE } from './loyalty-calculations';
import {
  balanceLimitReached,
  entryAlreadyReversed,
  entryNotFound,
  entryNotReversible,
  idempotencyKeyReused,
  insufficientPoints,
  orderHasLoyaltyPoints,
  programDisabled,
  rewardInactive,
  rewardNotFound,
} from './loyalty-errors';
import {
  AdjustLoyaltyPointsDto,
  CreateLoyaltyRewardDto,
  ListLoyaltyEntriesQueryDto,
  ListLoyaltyRewardsQueryDto,
  RedeemLoyaltyRewardDto,
  ReverseLoyaltyEntryDto,
  UpdateLoyaltyProgramDto,
  UpdateLoyaltyRewardDto,
} from './dto/loyalty.dto';

type Tx = Prisma.TransactionClient;

const TRANSACTION_OPTIONS = { timeout: 20_000, maxWait: 10_000 };
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_POINTS_PER_REAL = 1;

interface LockedAccount {
  id: string;
  tenantId: string;
  customerId: string;
  balancePoints: number;
}

interface NewEntry {
  type: LoyaltyEntryType;
  points: number;
  orderId?: string | null;
  rewardId?: string | null;
  branchId?: string | null;
  reversedEntryId?: string | null;
  reason?: string | null;
  idempotencyKey?: string | null;
  createdByUserId: string | null;
}

const ENTRY_VIEW = {
  order: { select: { orderNumber: true } },
  reward: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  reversal: { select: { id: true } },
} satisfies Prisma.LoyaltyEntryInclude;

type EntryWithView = Prisma.LoyaltyEntryGetPayload<{ include: typeof ENTRY_VIEW }>;

function toEntryView(entry: EntryWithView) {
  return {
    id: entry.id,
    type: entry.type,
    points: entry.points,
    balanceAfter: entry.balanceAfter,
    orderId: entry.orderId,
    orderNumber: entry.order?.orderNumber ?? null,
    reward: entry.reward,
    reason: entry.reason,
    reversedEntryId: entry.reversedEntryId,
    // An entry that was undone stays in the statement; this is how the screen marks it.
    reversed: entry.reversal !== null,
    createdBy: entry.createdBy,
    createdAt: entry.createdAt,
  };
}

function toRewardView(reward: LoyaltyReward) {
  return {
    id: reward.id,
    name: reward.name,
    description: reward.description,
    pointsCost: reward.pointsCost,
    active: reward.active,
    createdAt: reward.createdAt,
    updatedAt: reward.updatedAt,
  };
}

// ===========================================================================================
// Loyalty points (Fase 11, fatia 4). The rule, in one place (also in docs/LOYALTY.md):
//
//   EARN        a CONCLUDED order (COMPLETED/DELIVERED) of a linked customer earns
//               floor((subtotal - discount) / 100) * pointsPerReal points, once per order;
//   REDEEM      points are exchanged for a reward of the catalogue (the reward decides how many);
//   ADJUSTMENT  management credits or debits points by hand, always with a reason;
//   REVERSAL    undoes exactly one earlier entry, once.
//
// Invariants enforced here AND by the database (CHECKs, unique indexes, append-only trigger):
//   - the ledger is the source of truth; the account balance is its running total and changes
//     ONLY in the transaction that appends an entry, with the account row locked FOR UPDATE;
//   - the balance never goes below zero: a debit larger than the balance is refused;
//   - an entry is never edited or removed; a mistake is corrected by another entry;
//   - every client-triggered write carries an idempotency key and is audited in the SAME
//     transaction (no entry without its audit row, no audit row without its entry);
//   - everything is scoped by the tenant of the token.
// Lock order: whatever the caller already holds (order row, cash session, coupon) and then the
// loyalty account, always last - so there is no cycle with the order flows.
// ===========================================================================================
@Injectable()
export class LoyaltyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  // ---- program ----------------------------------------------------------------------------

  async getProgram(user: AuthenticatedRequestUser) {
    const program = await this.prisma.loyaltyProgram.findUnique({ where: { tenantId: user.tenantId } });
    return {
      enabled: program?.enabled ?? false,
      pointsPerReal: program?.pointsPerReal ?? DEFAULT_POINTS_PER_REAL,
    };
  }

  async updateProgram(user: AuthenticatedRequestUser, dto: UpdateLoyaltyProgramDto) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.loyaltyProgram.findUnique({ where: { tenantId: user.tenantId } });
      const program = await tx.loyaltyProgram.upsert({
        where: { tenantId: user.tenantId },
        update: { enabled: dto.enabled, pointsPerReal: dto.pointsPerReal },
        create: { tenantId: user.tenantId, enabled: dto.enabled, pointsPerReal: dto.pointsPerReal },
      });
      const changed =
        !before || before.enabled !== program.enabled || before.pointsPerReal !== program.pointsPerReal;
      if (changed) {
        await this.audit.recordTx(tx, {
          tenantId: user.tenantId,
          userId: user.userId,
          action: 'LOYALTY_PROGRAM_UPDATED',
          entity: 'LoyaltyProgram',
          entityId: user.tenantId,
          beforeData: before ? { enabled: before.enabled, pointsPerReal: before.pointsPerReal } : null,
          afterData: { enabled: program.enabled, pointsPerReal: program.pointsPerReal },
        });
      }
      return { enabled: program.enabled, pointsPerReal: program.pointsPerReal };
    }, TRANSACTION_OPTIONS);
  }

  // ---- rewards ----------------------------------------------------------------------------

  async listRewards(user: AuthenticatedRequestUser, query: ListLoyaltyRewardsQueryDto) {
    const status = query.status ?? 'active';
    const rewards = await this.prisma.loyaltyReward.findMany({
      where: { tenantId: user.tenantId, ...(status === 'all' ? {} : { active: status === 'active' }) },
      orderBy: [{ pointsCost: 'asc' }, { name: 'asc' }, { id: 'asc' }],
    });
    return { data: rewards.map(toRewardView) };
  }

  async createReward(user: AuthenticatedRequestUser, dto: CreateLoyaltyRewardDto) {
    return this.prisma.$transaction(async (tx) => {
      const reward = await tx.loyaltyReward.create({
        data: {
          tenantId: user.tenantId,
          name: dto.name,
          description: dto.description ?? null,
          pointsCost: dto.pointsCost,
        },
      });
      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'LOYALTY_REWARD_CREATED',
        entity: 'LoyaltyReward',
        entityId: reward.id,
        afterData: { name: reward.name, pointsCost: reward.pointsCost },
      });
      return toRewardView(reward);
    }, TRANSACTION_OPTIONS);
  }

  async updateReward(user: AuthenticatedRequestUser, id: string, dto: UpdateLoyaltyRewardDto) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.loyaltyReward.findFirst({ where: { id, tenantId: user.tenantId } });
      if (!current) throw rewardNotFound();
      const next = {
        name: dto.name ?? current.name,
        description: dto.description !== undefined ? (dto.description ?? null) : current.description,
        pointsCost: dto.pointsCost ?? current.pointsCost,
        active: dto.active ?? current.active,
      };
      const changed = (Object.keys(next) as (keyof typeof next)[]).filter((key) => next[key] !== current[key]);
      if (changed.length === 0) return toRewardView(current);

      const reward = await tx.loyaltyReward.update({ where: { id }, data: next });
      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'LOYALTY_REWARD_UPDATED',
        entity: 'LoyaltyReward',
        entityId: id,
        beforeData: { name: current.name, pointsCost: current.pointsCost, active: current.active },
        afterData: { name: reward.name, pointsCost: reward.pointsCost, active: reward.active, fields: changed },
      });
      return toRewardView(reward);
    }, TRANSACTION_OPTIONS);
  }

  // ---- account: balance and statement -------------------------------------------------------

  async getAccount(user: AuthenticatedRequestUser, customerId: string) {
    await this.loadCustomer(user.tenantId, customerId);
    const [account, program] = await Promise.all([
      this.prisma.loyaltyAccount.findFirst({ where: { customerId, tenantId: user.tenantId } }),
      this.getProgram(user),
    ]);
    return { customerId, balancePoints: account?.balancePoints ?? 0, program };
  }

  async listEntries(user: AuthenticatedRequestUser, customerId: string, query: ListLoyaltyEntriesQueryDto) {
    await this.loadCustomer(user.tenantId, customerId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.LoyaltyEntryWhereInput = { tenantId: user.tenantId, customerId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.loyaltyEntry.count({ where }),
      this.prisma.loyaltyEntry.findMany({
        where,
        // Newest first; the id breaks ties so pages never overlap.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: ENTRY_VIEW,
      }),
    ]);
    return {
      data: rows.map(toEntryView),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  // ---- client-triggered movements -----------------------------------------------------------

  // Exchanges points for a reward. The reward's cost, read inside the transaction, is the amount
  // debited: nothing about points travels from the client.
  async redeem(user: AuthenticatedRequestUser, customerId: string, dto: RedeemLoyaltyRewardDto) {
    await this.branchAccess.assertAccess(user, dto.branchId);
    const customer = await this.loadCustomer(user.tenantId, customerId);

    return this.idempotent(user.tenantId, dto.idempotencyKey, async (tx) => {
      const account = await this.lockAccount(tx, user.tenantId, customerId);
      // The replay comes first: a repeated request answers with what already happened, even
      // if the program was switched off or the customer deactivated since.
      const replay = await this.findByKey(tx, user.tenantId, dto.idempotencyKey);
      if (replay) {
        return this.replayOf(
          replay,
          replay.type === 'REDEEM' && replay.customerId === customerId && replay.rewardId === dto.rewardId,
        );
      }
      if (!customer.active) throw customerInactive();
      const program = await tx.loyaltyProgram.findUnique({ where: { tenantId: user.tenantId } });
      if (!program?.enabled) throw programDisabled();

      const reward = await tx.loyaltyReward.findFirst({ where: { id: dto.rewardId, tenantId: user.tenantId } });
      if (!reward) throw rewardNotFound();
      if (!reward.active) throw rewardInactive();

      const entry = await this.append(tx, account, {
        type: 'REDEEM',
        points: -reward.pointsCost,
        rewardId: reward.id,
        branchId: dto.branchId,
        idempotencyKey: dto.idempotencyKey,
        createdByUserId: user.userId,
      });
      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'LOYALTY_POINTS_REDEEMED',
        entity: 'LoyaltyEntry',
        entityId: entry.id,
        afterData: {
          customerId,
          rewardId: reward.id,
          points: entry.points,
          balanceAfter: entry.balanceAfter,
          branchId: dto.branchId,
        },
      });
      return { entry, replay: false };
    });
  }

  async adjust(user: AuthenticatedRequestUser, customerId: string, dto: AdjustLoyaltyPointsDto) {
    await this.loadCustomer(user.tenantId, customerId);

    return this.idempotent(user.tenantId, dto.idempotencyKey, async (tx) => {
      const account = await this.lockAccount(tx, user.tenantId, customerId);
      const replay = await this.findByKey(tx, user.tenantId, dto.idempotencyKey);
      if (replay) {
        return this.replayOf(
          replay,
          replay.type === 'ADJUSTMENT' && replay.customerId === customerId && replay.points === dto.points,
        );
      }

      const entry = await this.append(tx, account, {
        type: 'ADJUSTMENT',
        points: dto.points,
        reason: dto.reason,
        idempotencyKey: dto.idempotencyKey,
        createdByUserId: user.userId,
      });
      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'LOYALTY_POINTS_ADJUSTED',
        entity: 'LoyaltyEntry',
        entityId: entry.id,
        afterData: { customerId, points: entry.points, balanceAfter: entry.balanceAfter, reason: dto.reason },
      });
      return { entry, replay: false };
    });
  }

  // Undoes one entry with the opposite movement. Refused when it would leave the balance below
  // zero (e.g. reversing an EARN whose points were already spent): the points have to be dealt
  // with first, the ledger never goes negative to make a reversal fit.
  async reverse(user: AuthenticatedRequestUser, entryId: string, dto: ReverseLoyaltyEntryDto) {
    const target = await this.prisma.loyaltyEntry.findFirst({ where: { id: entryId, tenantId: user.tenantId } });
    if (!target) throw entryNotFound();

    return this.idempotent(user.tenantId, dto.idempotencyKey, async (tx) => {
      const account = await this.lockAccount(tx, user.tenantId, target.customerId);
      const replay = await this.findByKey(tx, user.tenantId, dto.idempotencyKey);
      if (replay) return this.replayOf(replay, replay.type === 'REVERSAL' && replay.reversedEntryId === entryId);

      if (target.type === 'REVERSAL') throw entryNotReversible();
      // Read after the lock: every write to this account is serialized by it.
      const alreadyReversed = await tx.loyaltyEntry.findUnique({ where: { reversedEntryId: entryId }, select: { id: true } });
      if (alreadyReversed) throw entryAlreadyReversed();

      const entry = await this.append(tx, account, {
        type: 'REVERSAL',
        points: -target.points,
        reversedEntryId: target.id,
        // Kept on the reversal too, so the statement shows what it refers to.
        orderId: target.orderId,
        rewardId: target.rewardId,
        branchId: target.branchId,
        reason: dto.reason,
        idempotencyKey: dto.idempotencyKey,
        createdByUserId: user.userId,
      });
      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'LOYALTY_ENTRY_REVERSED',
        entity: 'LoyaltyEntry',
        entityId: entry.id,
        afterData: {
          customerId: target.customerId,
          reversedEntryId: target.id,
          reversedType: target.type,
          points: entry.points,
          balanceAfter: entry.balanceAfter,
          reason: dto.reason,
        },
      });
      return { entry, replay: false };
    });
  }

  // ---- order integration (called by OrderEffectsService inside the order's transaction) -----

  // Credits the points of a concluded order. Safe to call more than once and for orders that
  // earn nothing: it only writes when the program is enabled, the order is concluded, a
  // customer is linked, the purchase is worth at least one point and the order has not earned
  // before. Runs on the caller's transaction, so the points exist if and only if the order
  // really reached that state.
  async earnForOrderInTx(tx: Tx, input: { tenantId: string; orderId: string; actorUserId: string | null }) {
    const program = await tx.loyaltyProgram.findUnique({ where: { tenantId: input.tenantId } });
    if (!program?.enabled) return null;

    const order = await tx.order.findFirst({
      where: { id: input.orderId, tenantId: input.tenantId },
      select: { id: true, branchId: true, customerId: true, status: true, subtotalCents: true, discountCents: true },
    });
    if (!order?.customerId || !isConcludedOrderStatus(order.status)) return null;

    const earned = earnedPoints(order, program.pointsPerReal);
    if (earned < 1) return null;

    // "Once per order" also covers an EARN that was reversed later: the order is not paid twice.
    const already = await tx.loyaltyEntry.findFirst({ where: { orderId: order.id, type: 'EARN' }, select: { id: true } });
    if (already) return null;

    const account = await this.lockAccount(tx, input.tenantId, order.customerId);
    const points = creditWithinLimit(account.balancePoints, earned);
    if (points < 1) return null;

    const entry = await this.append(tx, account, {
      type: 'EARN',
      points,
      orderId: order.id,
      branchId: order.branchId,
      createdByUserId: input.actorUserId,
    });
    await this.audit.recordTx(tx, {
      tenantId: input.tenantId,
      userId: input.actorUserId,
      action: 'LOYALTY_POINTS_EARNED',
      entity: 'LoyaltyEntry',
      entityId: entry.id,
      afterData: {
        customerId: order.customerId,
        orderId: order.id,
        points: entry.points,
        balanceAfter: entry.balanceAfter,
        pointsPerReal: program.pointsPerReal,
      },
    });
    return entry;
  }

  // An order whose points are still standing cannot change customer: the points would stay
  // with someone the order no longer names. After the EARN is reversed the change is allowed.
  async assertOrderCustomerCanChangeInTx(tx: Tx, orderId: string): Promise<void> {
    const earn = await tx.loyaltyEntry.findFirst({
      where: { orderId, type: 'EARN' },
      select: { id: true, reversal: { select: { id: true } } },
    });
    if (earn && !earn.reversal) throw orderHasLoyaltyPoints();
  }

  // ---- internals ----------------------------------------------------------------------------

  private async loadCustomer(tenantId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenantId },
      select: { id: true, active: true },
    });
    if (!customer) throw customerNotFound();
    return customer;
  }

  // The account is created on first use (INSERT ... ON CONFLICT DO NOTHING: two first movements
  // of the same customer cannot both create it) and then locked. From here to the end of the
  // transaction nobody else reads-then-writes this balance.
  private async lockAccount(tx: Tx, tenantId: string, customerId: string): Promise<LockedAccount> {
    await tx.loyaltyAccount.createMany({ data: [{ tenantId, customerId }], skipDuplicates: true });
    const rows = await tx.$queryRaw<{ id: string; balancePoints: number }[]>`
      SELECT "id", "balancePoints" FROM "loyalty_accounts"
       WHERE "customerId" = ${customerId} AND "tenantId" = ${tenantId}
         FOR UPDATE`;
    if (rows.length === 0) throw customerNotFound();
    return { id: rows[0].id, tenantId, customerId, balancePoints: rows[0].balancePoints };
  }

  // The only place a balance changes: append the entry with the balance it leaves, then store
  // that same balance on the (locked) account.
  private async append(tx: Tx, account: LockedAccount, data: NewEntry): Promise<LoyaltyEntry> {
    const balanceAfter = account.balancePoints + data.points;
    if (balanceAfter < 0) throw insufficientPoints(account.balancePoints, -data.points);
    if (balanceAfter > MAX_POINTS_BALANCE) throw balanceLimitReached();

    const entry = await tx.loyaltyEntry.create({
      data: {
        tenantId: account.tenantId,
        accountId: account.id,
        customerId: account.customerId,
        type: data.type,
        points: data.points,
        balanceAfter,
        orderId: data.orderId ?? null,
        rewardId: data.rewardId ?? null,
        branchId: data.branchId ?? null,
        reversedEntryId: data.reversedEntryId ?? null,
        reason: data.reason ?? null,
        idempotencyKey: data.idempotencyKey ?? null,
        createdByUserId: data.createdByUserId,
      },
    });
    await tx.loyaltyAccount.update({ where: { id: account.id }, data: { balancePoints: balanceAfter } });
    account.balancePoints = balanceAfter;
    return entry;
  }

  private findByKey(tx: Tx | PrismaService, tenantId: string, idempotencyKey: string) {
    return tx.loyaltyEntry.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } } });
  }

  // A key seen before answers with the entry it produced - provided it is the SAME operation.
  private replayOf(existing: LoyaltyEntry, sameOperation: boolean) {
    if (!sameOperation) throw idempotencyKeyReused();
    return { entry: existing, replay: true };
  }

  // Runs one keyed movement. The key is checked again INSIDE the transaction, after the account
  // lock (see the callers): a duplicate that arrives while the first is still running waits for
  // the lock and then finds the entry, instead of failing on a balance the first one already
  // used. The unique index on (tenantId, idempotencyKey) is the last barrier.
  private async idempotent(
    tenantId: string,
    idempotencyKey: string,
    work: (tx: Tx) => Promise<{ entry: LoyaltyEntry; replay: boolean }>,
  ) {
    let result: { entry: LoyaltyEntry; replay: boolean };
    try {
      result = await this.prisma.$transaction(work, TRANSACTION_OPTIONS);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String((error.meta?.target as string[] | string | undefined) ?? '');
        if (target.includes('reversedEntryId')) throw entryAlreadyReversed();
        const existing = await this.findByKey(this.prisma, tenantId, idempotencyKey);
        if (existing) throw idempotencyKeyReused();
      }
      throw error;
    }
    const view = await this.prisma.loyaltyEntry.findUniqueOrThrow({ where: { id: result.entry.id }, include: ENTRY_VIEW });
    return { ...toEntryView(view), idempotentReplay: result.replay };
  }
}
