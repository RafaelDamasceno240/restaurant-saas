import { Injectable } from '@nestjs/common';
import { CashbackEntry, CashbackEntryType, CashbackProgram, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { isConcludedOrderStatus } from '../../common/util/order-conclusion.util';
import { customerNotFound } from '../customers/customer-errors';
import {
  cashbackCreditWithinLimit,
  cashbackExpiresAt,
  earnedCashbackCents,
  isCashbackExpired,
  MAX_CASHBACK_BALANCE_CENTS,
  maxUsableCashbackCents,
} from './cashback-calculations';
import {
  cashbackBalanceLimit,
  cashbackCustomerRequired,
  cashbackDisabled,
  cashbackEntryAlreadyReversed,
  cashbackEntryNotFound,
  cashbackEntryNotReversible,
  cashbackExceedsOrder,
  cashbackIdempotencyKeyReused,
  insufficientCashback,
  orderHasCashback,
} from './cashback-errors';
import {
  AdjustCashbackDto,
  ListCashbackEntriesQueryDto,
  ReverseCashbackEntryDto,
  UpdateCashbackProgramDto,
} from './dto/cashback.dto';

type Tx = Prisma.TransactionClient;

const TRANSACTION_OPTIONS = { timeout: 20_000, maxWait: 10_000 };
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_EARN_RATE_BPS = 500;
const ORDER_CANCELLED_REASON = 'Pedido cancelado';
const EXPIRE_BATCH_SIZE = 200;

interface LockedAccount {
  id: string;
  tenantId: string;
  customerId: string;
  balanceCents: number;
  lastActivityAt: Date | null;
}

interface NewEntry {
  type: CashbackEntryType;
  amountCents: number;
  orderId?: string | null;
  branchId?: string | null;
  reversedEntryId?: string | null;
  reason?: string | null;
  idempotencyKey?: string | null;
  createdByUserId: string | null;
}

// A use that passed every check and holds the account lock, waiting for the order it pays for
// to exist (the entry needs the order id).
export interface CashbackReservation {
  account: LockedAccount;
  amountCents: number;
  branchId: string;
  actorUserId: string | null;
}

const ENTRY_VIEW = {
  order: { select: { orderNumber: true } },
  createdBy: { select: { id: true, name: true } },
  reversal: { select: { id: true } },
} satisfies Prisma.CashbackEntryInclude;

type EntryWithView = Prisma.CashbackEntryGetPayload<{ include: typeof ENTRY_VIEW }>;

function toEntryView(entry: EntryWithView) {
  return {
    id: entry.id,
    type: entry.type,
    amountCents: entry.amountCents,
    balanceAfterCents: entry.balanceAfterCents,
    orderId: entry.orderId,
    orderNumber: entry.order?.orderNumber ?? null,
    reason: entry.reason,
    reversedEntryId: entry.reversedEntryId,
    reversed: entry.reversal !== null,
    createdBy: entry.createdBy,
    createdAt: entry.createdAt,
  };
}

const programView = (program: CashbackProgram | null) => ({
  enabled: program?.enabled ?? false,
  earnRateBps: program?.earnRateBps ?? DEFAULT_EARN_RATE_BPS,
  expireAfterDays: program?.expireAfterDays ?? null,
});

// ===========================================================================================
// Cashback (Fase 11, fatia 5): money owed by the restaurant to a customer, in integer cents.
// The rule, in one place (also in docs/CASHBACK.md):
//
//   EARN        a CONCLUDED order of a linked customer gives back
//               floor((subtotal - discount - cashbackUsed) * earnRateBps / 10000), once per order;
//   USE         the balance pays for the ITEMS of an order of the same customer (never the
//               delivery fee); the amount is validated here, against the LOCKED balance, inside
//               the transaction that creates the order; once per order;
//   REVERSAL    undoes one entry, once. A cancelled order gets back the cashback it used this
//               way, in the transaction that cancels it;
//   ADJUSTMENT  management credits or debits by hand, always with a reason;
//   EXPIRATION  with an expiration rule, a balance left without a credit or a use for the
//               configured number of days is written off. It is settled lazily: every operation
//               that locks an account writes the EXPIRATION first, so an expired balance is
//               never spent, and reads report it as unavailable.
//
// Invariants enforced here AND by the database (CHECKs, unique indexes, append-only trigger):
//   - the ledger is the source of truth; the account balance is its running total and changes
//     ONLY in the transaction that appends an entry, with the account row locked FOR UPDATE;
//   - the balance never goes below zero;
//   - an entry is never edited or removed;
//   - client-triggered writes are idempotent by key; order-triggered ones by order;
//   - every movement is audited in the SAME transaction;
//   - everything is scoped by the tenant of the token.
// Lock order in the order flows: cash session -> coupon -> CASHBACK account -> loyalty account.
// The cashback account always comes before the loyalty account (OrderEffectsService calls this
// service first), so two orders of the same customer can never wait on each other in a cycle.
// ===========================================================================================
@Injectable()
export class CashbackService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  // ---- program ----------------------------------------------------------------------------

  async getProgram(user: AuthenticatedRequestUser) {
    return programView(await this.prisma.cashbackProgram.findUnique({ where: { tenantId: user.tenantId } }));
  }

  async updateProgram(user: AuthenticatedRequestUser, dto: UpdateCashbackProgramDto) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.cashbackProgram.findUnique({ where: { tenantId: user.tenantId } });
      const data = { enabled: dto.enabled, earnRateBps: dto.earnRateBps, expireAfterDays: dto.expireAfterDays };
      const program = await tx.cashbackProgram.upsert({
        where: { tenantId: user.tenantId },
        update: data,
        create: { tenantId: user.tenantId, ...data },
      });
      const changed =
        !before ||
        before.enabled !== program.enabled ||
        before.earnRateBps !== program.earnRateBps ||
        before.expireAfterDays !== program.expireAfterDays;
      if (changed) {
        await this.audit.recordTx(tx, {
          tenantId: user.tenantId,
          userId: user.userId,
          action: 'CASHBACK_PROGRAM_UPDATED',
          entity: 'CashbackProgram',
          entityId: user.tenantId,
          beforeData: before ? programView(before) : null,
          afterData: programView(program),
        });
      }
      return programView(program);
    }, TRANSACTION_OPTIONS);
  }

  // ---- account: balance and statement -------------------------------------------------------

  // `balanceCents` is what can be spent NOW: a balance past its expiration counts as zero even
  // before the EXPIRATION entry is written (it is written by the next operation on the account).
  async getAccount(user: AuthenticatedRequestUser, customerId: string) {
    await this.loadCustomer(user.tenantId, customerId);
    const [account, stored] = await Promise.all([
      this.prisma.cashbackAccount.findFirst({ where: { customerId, tenantId: user.tenantId } }),
      this.prisma.cashbackProgram.findUnique({ where: { tenantId: user.tenantId } }),
    ]);
    const program = programView(stored);
    const state = { balanceCents: account?.balanceCents ?? 0, lastActivityAt: account?.lastActivityAt ?? null };
    const expired = isCashbackExpired(state, program.expireAfterDays, new Date());
    return {
      customerId,
      balanceCents: expired ? 0 : state.balanceCents,
      // Still on the ledger, but already past the expiration: not spendable.
      expiredPendingCents: expired ? state.balanceCents : 0,
      expiresAt: expired ? null : cashbackExpiresAt(state, program.expireAfterDays),
      program,
    };
  }

  async listEntries(user: AuthenticatedRequestUser, customerId: string, query: ListCashbackEntriesQueryDto) {
    await this.loadCustomer(user.tenantId, customerId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const where: Prisma.CashbackEntryWhereInput = { tenantId: user.tenantId, customerId };
    const [total, rows] = await this.prisma.$transaction([
      this.prisma.cashbackEntry.count({ where }),
      this.prisma.cashbackEntry.findMany({
        where,
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

  async adjust(user: AuthenticatedRequestUser, customerId: string, dto: AdjustCashbackDto) {
    await this.loadCustomer(user.tenantId, customerId);

    return this.idempotent(user.tenantId, dto.idempotencyKey, async (tx) => {
      const account = await this.lockAccount(tx, user.tenantId, customerId);
      // The replay comes first: a repeated request answers with what already happened.
      const replay = await this.findByKey(tx, user.tenantId, dto.idempotencyKey);
      if (replay) {
        return this.replayOf(
          replay,
          replay.type === 'ADJUSTMENT' && replay.customerId === customerId && replay.amountCents === dto.amountCents,
        );
      }
      await this.settleExpirationInTx(tx, account, new Date());

      const entry = await this.append(tx, account, {
        type: 'ADJUSTMENT',
        amountCents: dto.amountCents,
        reason: dto.reason,
        idempotencyKey: dto.idempotencyKey,
        createdByUserId: user.userId,
      });
      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'CASHBACK_ADJUSTED',
        entity: 'CashbackEntry',
        entityId: entry.id,
        afterData: { customerId, amountCents: entry.amountCents, balanceAfterCents: entry.balanceAfterCents, reason: dto.reason },
      });
      return { entry, replay: false };
    });
  }

  // Undoes a credit by purchase or a manual adjustment. A USE is not undone here: the cashback
  // an order spent goes back when that order is cancelled, never on its own (the order would
  // keep a discount nobody paid for). Refused when it would leave the balance below zero.
  async reverse(user: AuthenticatedRequestUser, entryId: string, dto: ReverseCashbackEntryDto) {
    const target = await this.prisma.cashbackEntry.findFirst({ where: { id: entryId, tenantId: user.tenantId } });
    if (!target) throw cashbackEntryNotFound();

    return this.idempotent(user.tenantId, dto.idempotencyKey, async (tx) => {
      const account = await this.lockAccount(tx, user.tenantId, target.customerId);
      const replay = await this.findByKey(tx, user.tenantId, dto.idempotencyKey);
      if (replay) return this.replayOf(replay, replay.type === 'REVERSAL' && replay.reversedEntryId === entryId);

      if (target.type === 'USE') {
        throw cashbackEntryNotReversible('O cashback usado em um pedido só volta ao cliente quando o pedido é cancelado.');
      }
      if (target.type === 'REVERSAL' || target.type === 'EXPIRATION') {
        throw cashbackEntryNotReversible('Esta movimentação não pode ser estornada. Registre um ajuste.');
      }
      const alreadyReversed = await tx.cashbackEntry.findUnique({ where: { reversedEntryId: entryId }, select: { id: true } });
      if (alreadyReversed) throw cashbackEntryAlreadyReversed();
      await this.settleExpirationInTx(tx, account, new Date());

      const entry = await this.append(tx, account, {
        type: 'REVERSAL',
        amountCents: -target.amountCents,
        reversedEntryId: target.id,
        orderId: target.orderId,
        branchId: target.branchId,
        reason: dto.reason,
        idempotencyKey: dto.idempotencyKey,
        createdByUserId: user.userId,
      });
      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'CASHBACK_ENTRY_REVERSED',
        entity: 'CashbackEntry',
        entityId: entry.id,
        afterData: {
          customerId: target.customerId,
          reversedEntryId: target.id,
          reversedType: target.type,
          amountCents: entry.amountCents,
          balanceAfterCents: entry.balanceAfterCents,
          reason: dto.reason,
        },
      });
      return { entry, replay: false };
    });
  }

  // Writes off every balance of the tenant that is past its expiration. There is no scheduler in
  // this version: expired balances are already unusable (every operation settles the account it
  // touches first); this only brings the ledger up to date for the ones nobody touched.
  async expireIdleBalances(user: AuthenticatedRequestUser) {
    const program = await this.prisma.cashbackProgram.findUnique({ where: { tenantId: user.tenantId } });
    if (!program?.expireAfterDays) return { expiredAccounts: 0, expiredCents: 0, moreToProcess: false };

    const now = new Date();
    const idleSince = new Date(now.getTime() - program.expireAfterDays * 86_400_000);
    const candidates = await this.prisma.cashbackAccount.findMany({
      where: { tenantId: user.tenantId, balanceCents: { gt: 0 }, lastActivityAt: { lte: idleSince } },
      select: { customerId: true },
      orderBy: { lastActivityAt: 'asc' },
      take: EXPIRE_BATCH_SIZE,
    });

    let expiredAccounts = 0;
    let expiredCents = 0;
    for (const candidate of candidates) {
      // One short transaction per account: the lock is taken, the state re-read, and nothing is
      // written if a purchase or a use arrived in the meantime.
      const written = await this.prisma.$transaction(async (tx) => {
        const account = await this.lockAccount(tx, user.tenantId, candidate.customerId);
        return this.settleExpirationInTx(tx, account, now, user.userId);
      }, TRANSACTION_OPTIONS);
      if (written) {
        expiredAccounts += 1;
        expiredCents += -written.amountCents;
      }
    }
    return { expiredAccounts, expiredCents, moreToProcess: candidates.length === EXPIRE_BATCH_SIZE };
  }

  // ---- order integration (inside the order's transaction) -----------------------------------

  // Step 1 of spending cashback on an order: lock the customer's account and check the amount
  // against the balance it really has now. Nothing is written yet (the order does not exist);
  // the lock is held until the transaction ends, so the balance checked here is the balance
  // commitUseInTx() debits.
  async reserveUseInTx(
    tx: Tx,
    input: {
      tenantId: string;
      customerId: string | null;
      branchId: string;
      requestedCents: number;
      subtotalCents: number;
      discountCents: number;
      actorUserId: string | null;
    },
  ): Promise<CashbackReservation> {
    if (!input.customerId) throw cashbackCustomerRequired();
    const program = await tx.cashbackProgram.findUnique({ where: { tenantId: input.tenantId } });
    if (!program?.enabled) throw cashbackDisabled();

    const maxForOrder = input.subtotalCents - input.discountCents;
    if (!Number.isInteger(input.requestedCents) || input.requestedCents < 1 || input.requestedCents > maxForOrder) {
      throw cashbackExceedsOrder(Math.max(0, maxForOrder));
    }

    const account = await this.lockAccount(tx, input.tenantId, input.customerId);
    await this.settleExpirationInTx(tx, account, new Date());
    const usable = maxUsableCashbackCents(input, account.balanceCents);
    if (input.requestedCents > usable) throw insufficientCashback(account.balanceCents, input.requestedCents);

    return { account, amountCents: input.requestedCents, branchId: input.branchId, actorUserId: input.actorUserId };
  }

  // Step 2: the order exists; write the USE entry that points at it.
  async commitUseInTx(tx: Tx, reservation: CashbackReservation, orderId: string): Promise<CashbackEntry> {
    const { account } = reservation;
    const entry = await this.append(tx, account, {
      type: 'USE',
      amountCents: -reservation.amountCents,
      orderId,
      branchId: reservation.branchId,
      createdByUserId: reservation.actorUserId,
    });
    await this.audit.recordTx(tx, {
      tenantId: account.tenantId,
      userId: reservation.actorUserId,
      action: 'CASHBACK_USED',
      entity: 'CashbackEntry',
      entityId: entry.id,
      afterData: {
        customerId: account.customerId,
        orderId,
        amountCents: entry.amountCents,
        balanceAfterCents: entry.balanceAfterCents,
      },
    });
    return entry;
  }

  // Credits the cashback of a concluded order. Safe to call more than once and for orders that
  // earn nothing; runs on the caller's transaction.
  async earnForOrderInTx(tx: Tx, input: { tenantId: string; orderId: string; actorUserId: string | null }) {
    const program = await tx.cashbackProgram.findUnique({ where: { tenantId: input.tenantId } });
    if (!program?.enabled) return null;

    const order = await tx.order.findFirst({
      where: { id: input.orderId, tenantId: input.tenantId },
      select: {
        id: true,
        branchId: true,
        customerId: true,
        status: true,
        subtotalCents: true,
        discountCents: true,
        cashbackUsedCents: true,
      },
    });
    if (!order?.customerId || !isConcludedOrderStatus(order.status)) return null;

    const earned = earnedCashbackCents(order, program.earnRateBps);
    if (earned < 1) return null;

    // "Once per order" also covers an EARN that was reversed later.
    const already = await tx.cashbackEntry.findFirst({ where: { orderId: order.id, type: 'EARN' }, select: { id: true } });
    if (already) return null;

    const account = await this.lockAccount(tx, input.tenantId, order.customerId);
    await this.settleExpirationInTx(tx, account, new Date());
    const amountCents = cashbackCreditWithinLimit(account.balanceCents, earned);
    if (amountCents < 1) return null;

    const entry = await this.append(tx, account, {
      type: 'EARN',
      amountCents,
      orderId: order.id,
      branchId: order.branchId,
      createdByUserId: input.actorUserId,
    });
    await this.audit.recordTx(tx, {
      tenantId: input.tenantId,
      userId: input.actorUserId,
      action: 'CASHBACK_EARNED',
      entity: 'CashbackEntry',
      entityId: entry.id,
      afterData: {
        customerId: order.customerId,
        orderId: order.id,
        amountCents: entry.amountCents,
        balanceAfterCents: entry.balanceAfterCents,
        earnRateBps: program.earnRateBps,
      },
    });
    return entry;
  }

  // A cancelled order gives back the cashback it spent, in the transaction that cancels it:
  // cancelled and refunded commit together. Safe to call for orders that used none, and it
  // never refunds twice (the reversal is unique per entry).
  async refundUseForOrderInTx(tx: Tx, input: { tenantId: string; orderId: string; actorUserId: string | null }) {
    const use = await tx.cashbackEntry.findFirst({
      where: { orderId: input.orderId, tenantId: input.tenantId, type: 'USE' },
      include: { reversal: { select: { id: true } } },
    });
    if (!use || use.reversal) return null;

    const account = await this.lockAccount(tx, input.tenantId, use.customerId);
    // Not settled for expiration first on purpose: the refund is itself activity, and money
    // handed back by a cancellation must not be written off in the same breath.
    const entry = await this.append(tx, account, {
      type: 'REVERSAL',
      amountCents: -use.amountCents,
      reversedEntryId: use.id,
      orderId: use.orderId,
      branchId: use.branchId,
      reason: ORDER_CANCELLED_REASON,
      createdByUserId: input.actorUserId,
    });
    await this.audit.recordTx(tx, {
      tenantId: input.tenantId,
      userId: input.actorUserId,
      action: 'CASHBACK_USE_REFUNDED',
      entity: 'CashbackEntry',
      entityId: entry.id,
      afterData: {
        customerId: use.customerId,
        orderId: input.orderId,
        reversedEntryId: use.id,
        amountCents: entry.amountCents,
        balanceAfterCents: entry.balanceAfterCents,
      },
    });
    return entry;
  }

  // An order whose cashback is still standing (spent and not refunded, or earned and not
  // reversed) cannot change customer: the money would stay on an account the order no longer
  // names.
  async assertOrderCustomerCanChangeInTx(tx: Tx, orderId: string): Promise<void> {
    const standing = await tx.cashbackEntry.findFirst({
      where: { orderId, type: { in: ['EARN', 'USE'] }, reversal: { is: null } },
      select: { id: true },
    });
    if (standing) throw orderHasCashback();
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

  // Created on first use (INSERT ... ON CONFLICT DO NOTHING) and then locked: from here to the
  // end of the transaction nobody else reads-then-writes this balance.
  private async lockAccount(tx: Tx, tenantId: string, customerId: string): Promise<LockedAccount> {
    await tx.cashbackAccount.createMany({ data: [{ tenantId, customerId }], skipDuplicates: true });
    const rows = await tx.$queryRaw<{ id: string; balanceCents: number; lastActivityAt: Date | null }[]>`
      SELECT "id", "balanceCents", "lastActivityAt" FROM "cashback_accounts"
       WHERE "customerId" = ${customerId} AND "tenantId" = ${tenantId}
         FOR UPDATE`;
    if (rows.length === 0) throw customerNotFound();
    return { id: rows[0].id, tenantId, customerId, balanceCents: rows[0].balanceCents, lastActivityAt: rows[0].lastActivityAt };
  }

  // With the account locked: if its balance is past the expiration, write it off now. Called
  // before any movement that could spend or add to the balance, so an expired balance is never
  // used and a fresh credit is never mixed with money that should already be gone.
  private async settleExpirationInTx(tx: Tx, account: LockedAccount, now: Date, actorUserId: string | null = null) {
    if (account.balanceCents <= 0) return null;
    const program = await tx.cashbackProgram.findUnique({ where: { tenantId: account.tenantId } });
    const expireAfterDays = program?.expireAfterDays ?? null;
    if (!isCashbackExpired(account, expireAfterDays, now)) return null;

    const entry = await this.append(tx, account, {
      type: 'EXPIRATION',
      amountCents: -account.balanceCents,
      createdByUserId: actorUserId,
    });
    await this.audit.recordTx(tx, {
      tenantId: account.tenantId,
      userId: actorUserId,
      action: 'CASHBACK_EXPIRED',
      entity: 'CashbackEntry',
      entityId: entry.id,
      afterData: {
        customerId: account.customerId,
        amountCents: entry.amountCents,
        balanceAfterCents: entry.balanceAfterCents,
        expireAfterDays,
        lastActivityAt: account.lastActivityAt,
      },
    });
    return entry;
  }

  // The only place a balance changes: append the entry with the balance it leaves, then store
  // that same balance on the (locked) account. Credits and uses also move the expiration clock.
  private async append(tx: Tx, account: LockedAccount, data: NewEntry): Promise<CashbackEntry> {
    const balanceAfterCents = account.balanceCents + data.amountCents;
    if (balanceAfterCents < 0) throw insufficientCashback(account.balanceCents, -data.amountCents);
    if (balanceAfterCents > MAX_CASHBACK_BALANCE_CENTS) throw cashbackBalanceLimit();

    const entry = await tx.cashbackEntry.create({
      data: {
        tenantId: account.tenantId,
        accountId: account.id,
        customerId: account.customerId,
        type: data.type,
        amountCents: data.amountCents,
        balanceAfterCents,
        orderId: data.orderId ?? null,
        branchId: data.branchId ?? null,
        reversedEntryId: data.reversedEntryId ?? null,
        reason: data.reason ?? null,
        idempotencyKey: data.idempotencyKey ?? null,
        createdByUserId: data.createdByUserId,
      },
    });
    const isActivity = data.type === 'USE' || data.amountCents > 0;
    const lastActivityAt = isActivity ? entry.createdAt : account.lastActivityAt;
    await tx.cashbackAccount.update({
      where: { id: account.id },
      data: { balanceCents: balanceAfterCents, lastActivityAt },
    });
    account.balanceCents = balanceAfterCents;
    account.lastActivityAt = lastActivityAt;
    return entry;
  }

  private findByKey(tx: Tx | PrismaService, tenantId: string, idempotencyKey: string) {
    return tx.cashbackEntry.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } } });
  }

  private replayOf(existing: CashbackEntry, sameOperation: boolean) {
    if (!sameOperation) throw cashbackIdempotencyKeyReused();
    return { entry: existing, replay: true };
  }

  // Same scheme as the points ledger: the key is re-checked INSIDE the transaction after the
  // account lock, so a simultaneous duplicate waits and then finds the entry; the unique index
  // on (tenantId, idempotencyKey) is the last barrier.
  private async idempotent(
    tenantId: string,
    idempotencyKey: string,
    work: (tx: Tx) => Promise<{ entry: CashbackEntry; replay: boolean }>,
  ) {
    let result: { entry: CashbackEntry; replay: boolean };
    try {
      result = await this.prisma.$transaction(work, TRANSACTION_OPTIONS);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String((error.meta?.target as string[] | string | undefined) ?? '');
        if (target.includes('reversedEntryId')) throw cashbackEntryAlreadyReversed();
        const existing = await this.findByKey(this.prisma, tenantId, idempotencyKey);
        if (existing) throw cashbackIdempotencyKeyReused();
      }
      throw error;
    }
    const view = await this.prisma.cashbackEntry.findUniqueOrThrow({ where: { id: result.entry.id }, include: ENTRY_VIEW });
    return { ...toEntryView(view), idempotentReplay: result.replay };
  }
}
