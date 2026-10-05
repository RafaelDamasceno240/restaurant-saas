import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { PaymentMethod, Prisma, ReceivableEntry, ReceivableEntryType } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { CashRegisterService } from '../cash/cash-register.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { addDays, dateOnlyToDate, dateToDateOnly, DEFAULT_TIME_ZONE, todayInTimeZone } from '../../common/util/timezone.util';
import { customerInactive, customerNotFound } from '../customers/customer-errors';
import {
  allocatePayment,
  availableCreditCents,
  buildInstallmentPlan,
  InstallmentPlanItem,
  InstallmentState,
  isInstallmentOverdue,
  MAX_RECEIVABLE_CENTS,
  openCentsOf,
  summarizeInstallments,
  validateTerms,
} from './receivable-calculations';
import {
  creditCustomerRequired,
  creditLimitExceeded,
  creditNotAllowed,
  customerOverdue,
  entryAlreadyReversed,
  entryNotReversible,
  installmentNotFound,
  invalidTerms,
  nothingToCharge,
  orderHasReceivable,
  overpayment,
  receivableEntryNotFound,
  receivableHasPayments,
  receivableIdempotencyKeyReused,
  receivableNotFound,
  receivableNotOpen,
  refundBranchRequired,
} from './receivable-errors';
import {
  CancelReceivableDto,
  CreateReceivableDto,
  ListReceivablesQueryDto,
  RegisterReceivablePaymentDto,
  ReverseReceivablePaymentDto,
  SetCreditLimitDto,
} from './dto/receivables.dto';

type Tx = Prisma.TransactionClient;

const TRANSACTION_OPTIONS = { timeout: 20_000, maxWait: 10_000 };
const DEFAULT_PAGE_SIZE = 20;
// A sale on account with no terms given: one installment, due in 30 days.
const DEFAULT_DUE_IN_DAYS = 30;
const ORDER_CANCELLED_REASON = 'Pedido cancelado';
const CASH_CLOSED_FOR_RECEIPT = 'Não há caixa aberto nesta unidade. Abra o caixa para receber em dinheiro.';
const CASH_CLOSED_FOR_REFUND = 'Não há caixa aberto nesta unidade. Abra o caixa para devolver o dinheiro deste pagamento.';

interface LockedAccount {
  id: string;
  tenantId: string;
  customerId: string;
  creditLimitCents: number;
  balanceCents: number;
}

interface NewEntry {
  type: ReceivableEntryType;
  amountCents: number;
  receivableId: string;
  paymentMethod?: PaymentMethod | null;
  branchId?: string | null;
  cashMovementId?: string | null;
  reversedEntryId?: string | null;
  reason?: string | null;
  idempotencyKey?: string | null;
  createdByUserId: string;
}

export interface CreditTerms {
  installments: number;
  firstDueDate: string;
}

// A sale on account that passed every check and holds the credit-account lock, waiting for the
// order it belongs to to exist.
export interface CreditReservation {
  account: LockedAccount;
  totalCents: number;
  plan: InstallmentPlanItem[];
  actorUserId: string;
}

const DETAIL = {
  customer: { select: { id: true, name: true, phone: true } },
  branch: { select: { id: true, name: true } },
  order: { select: { id: true, orderNumber: true } },
  installments: { orderBy: { number: 'asc' as const } },
} satisfies Prisma.ReceivableInclude;

const ENTRIES = {
  orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
  include: {
    createdBy: { select: { id: true, name: true } },
    reversal: { select: { id: true } },
    allocations: { select: { amountCents: true, installment: { select: { number: true } } } },
  },
} satisfies Prisma.Receivable$entriesArgs;

type ReceivableWithDetail = Prisma.ReceivableGetPayload<{ include: typeof DETAIL }>;
type EntryWithView = Prisma.ReceivableEntryGetPayload<{ include: (typeof ENTRIES)['include'] }>;

const toStates = (installments: { id: string; number: number; dueDate: Date; amountCents: number; paidCents: number }[]): InstallmentState[] =>
  installments.map((installment) => ({
    id: installment.id,
    number: installment.number,
    dueDate: dateToDateOnly(installment.dueDate),
    amountCents: installment.amountCents,
    paidCents: installment.paidCents,
  }));

// `today` is the restaurant's calendar day: "overdue" is always relative to it.
function toReceivableView(receivable: ReceivableWithDetail, today: string) {
  const states = toStates(receivable.installments);
  const isOpen = receivable.status === 'OPEN';
  const summary = isOpen
    ? summarizeInstallments(states, today)
    : { openCents: 0, overdueCents: 0, nextDueDate: null, daysOverdue: 0 };
  return {
    id: receivable.id,
    description: receivable.description,
    status: receivable.status,
    totalCents: receivable.totalCents,
    paidCents: receivable.paidCents,
    openCents: summary.openCents,
    overdueCents: summary.overdueCents,
    overdue: summary.overdueCents > 0,
    daysOverdue: summary.daysOverdue,
    nextDueDate: summary.nextDueDate,
    customer: receivable.customer,
    branch: receivable.branch,
    order: receivable.order,
    createdAt: receivable.createdAt,
    settledAt: receivable.settledAt,
    cancelledAt: receivable.cancelledAt,
    cancelReason: receivable.cancelReason,
    installments: states.map((installment) => ({
      id: installment.id,
      number: installment.number,
      dueDate: installment.dueDate,
      amountCents: installment.amountCents,
      paidCents: installment.paidCents,
      openCents: openCentsOf(installment),
      overdue: isOpen && isInstallmentOverdue(installment, today),
    })),
  };
}

function toEntryView(entry: EntryWithView) {
  return {
    id: entry.id,
    type: entry.type,
    amountCents: entry.amountCents,
    balanceAfterCents: entry.balanceAfterCents,
    paymentMethod: entry.paymentMethod,
    reason: entry.reason,
    reversedEntryId: entry.reversedEntryId,
    reversed: entry.reversal !== null,
    // Which installments a payment covered.
    allocations: entry.allocations.map((allocation) => ({
      installmentNumber: allocation.installment.number,
      amountCents: allocation.amountCents,
    })),
    createdBy: entry.createdBy,
    createdAt: entry.createdAt,
  };
}

// ===========================================================================================
// Fiado / contas a receber (Fase 11, fatia 6): money a customer owes the restaurant, in integer
// cents. The rule, in one place (also in docs/RECEIVABLES.md):
//
//   - a customer buys on account only with a credit limit > 0, within that limit, and with no
//     installment overdue;
//   - a sale on account (order paid ON_ACCOUNT) or a manual charge opens a RECEIVABLE, split
//     into 1 to 12 monthly installments with due dates;
//   - a PAYMENT (total or partial, CASH/PIX/CARD) is spread over the installments, the one due
//     first paid first, never beyond what is open; cash goes through the open cash session;
//   - a payment can be REVERSED (once, with a reason): the installments and the receivable go
//     back to what they were; a receivable without payments can be CANCELLED;
//   - "overdue" is not a stored state: an installment is overdue when it still owes something
//     and its due date is before TODAY in the restaurant's time zone.
//
// Invariants enforced here AND by the database (CHECKs, unique indexes, append-only triggers):
//   - receivable_entries is the source of truth; CreditAccount.balanceCents (the open debt) is
//     its running total and changes ONLY in the transaction that appends an entry, with the
//     account row locked FOR UPDATE. Receivable.paidCents and Installment.paidCents are kept in
//     that same transaction and are derivable from the entries and their allocations;
//   - nothing is ever paid beyond its total, and no balance goes below zero;
//   - an entry is never edited or removed;
//   - payments, reversals and manual charges are idempotent by key; a sale on account is
//     idempotent with its order;
//   - every movement is audited in the SAME transaction;
//   - everything is scoped by the tenant of the token, and by the branches the user can see.
// Lock order: cash session (when cash is involved) -> ... -> credit account. The same order as
// the sale flow (cash -> coupon -> cashback account -> credit account), so no cycle.
// ===========================================================================================
@Injectable()
export class ReceivablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchAccess: BranchAccessService,
    private readonly cashRegister: CashRegisterService,
  ) {}

  // ---- credit account: limit, debt and what is still available ---------------------------------

  async getAccount(user: AuthenticatedRequestUser, customerId: string) {
    await this.loadCustomer(user.tenantId, customerId);
    const [account, today] = await Promise.all([
      this.prisma.creditAccount.findFirst({ where: { customerId, tenantId: user.tenantId } }),
      this.tenantToday(this.prisma, user.tenantId),
    ]);
    const overdueCents = await this.overdueCentsOf(this.prisma, user.tenantId, customerId, today);
    const creditLimitCents = account?.creditLimitCents ?? 0;
    const balanceCents = account?.balanceCents ?? 0;
    return {
      customerId,
      creditLimitCents,
      balanceCents,
      availableCents: availableCreditCents(creditLimitCents, balanceCents),
      overdueCents,
      // What a sale on account would be told right now.
      canBuyOnAccount: creditLimitCents > 0 && overdueCents === 0 && balanceCents < creditLimitCents,
    };
  }

  // 0 withdraws the right to buy on account; a limit below the current debt is allowed (it only
  // blocks new sales until the debt goes down).
  async setLimit(user: AuthenticatedRequestUser, customerId: string, dto: SetCreditLimitDto) {
    await this.loadCustomer(user.tenantId, customerId);
    await this.prisma.$transaction(async (tx) => {
      const account = await this.lockAccount(tx, user.tenantId, customerId);
      if (account.creditLimitCents === dto.creditLimitCents) return;
      await tx.creditAccount.update({ where: { id: account.id }, data: { creditLimitCents: dto.creditLimitCents } });
      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'RECEIVABLE_LIMIT_UPDATED',
        entity: 'CreditAccount',
        entityId: account.id,
        beforeData: { creditLimitCents: account.creditLimitCents },
        afterData: { customerId, creditLimitCents: dto.creditLimitCents, balanceCents: account.balanceCents },
      });
    }, TRANSACTION_OPTIONS);
    return this.getAccount(user, customerId);
  }

  // ---- reads ---------------------------------------------------------------------------------

  async list(user: AuthenticatedRequestUser, query: ListReceivablesQueryDto) {
    if (query.branchId) await this.branchAccess.assertAccess(user, query.branchId);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
    const status = query.status ?? 'open';
    const today = await this.tenantToday(this.prisma, user.tenantId);
    const scope = await this.visibility(user);

    const search = query.search?.trim();
    const digits = search?.replace(/\D/g, '') ?? '';
    const where: Prisma.ReceivableWhereInput = {
      ...scope,
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(search
        ? {
            OR: [
              { description: { contains: escapeLike(search), mode: 'insensitive' } },
              { customer: { name: { contains: escapeLike(search), mode: 'insensitive' } } },
              { order: { orderNumber: { contains: escapeLike(search), mode: 'insensitive' } } },
              ...(digits.length >= 3 ? [{ customer: { phone: { contains: digits } } }] : []),
            ],
          }
        : {}),
      ...this.statusFilter(status, today),
    };

    const [total, rows, summary] = await Promise.all([
      this.prisma.receivable.count({ where }),
      this.prisma.receivable.findMany({
        where,
        // Newest first; the id breaks ties so pages never overlap.
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: DETAIL,
      }),
      this.summary(scope, today),
    ]);
    return {
      data: rows.map((row) => toReceivableView(row, today)),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
      summary,
      today,
    };
  }

  async findOne(user: AuthenticatedRequestUser, id: string) {
    const [today, scope] = await Promise.all([this.tenantToday(this.prisma, user.tenantId), this.visibility(user)]);
    const receivable = await this.prisma.receivable.findFirst({
      where: { id, ...scope },
      include: { ...DETAIL, entries: ENTRIES },
    });
    if (!receivable) throw receivableNotFound();
    return { ...toReceivableView(receivable, today), entries: receivable.entries.map(toEntryView), today };
  }

  // ---- manual charge -------------------------------------------------------------------------

  // A debt that did not come from a sale of this system. Management only; it is not checked
  // against the credit limit (the limit governs what the counter may SELL on account).
  async create(user: AuthenticatedRequestUser, dto: CreateReceivableDto) {
    await this.branchAccess.assertAccess(user, dto.branchId);
    const customer = await this.loadCustomer(user.tenantId, dto.customerId);
    const sameRequest = (entry: ReceivableEntry) =>
      entry.type === 'CHARGE' && entry.customerId === dto.customerId && entry.amountCents === dto.totalCents;

    const early = await this.findByKey(this.prisma, user.tenantId, dto.idempotencyKey);
    if (early) {
      if (!sameRequest(early)) throw receivableIdempotencyKeyReused();
      return { ...(await this.findOne(user, early.receivableId)), idempotentReplay: true };
    }
    if (!customer.active) throw customerInactive();

    const today = await this.tenantToday(this.prisma, user.tenantId);
    const problem = validateTerms({ totalCents: dto.totalCents, installments: dto.installments, firstDueDate: dto.firstDueDate, today });
    if (problem) throw invalidTerms(problem);
    const plan = buildInstallmentPlan(dto.totalCents, dto.installments, dto.firstDueDate);

    return this.idempotent(user, dto.idempotencyKey, async (tx) => {
      const account = await this.lockAccount(tx, user.tenantId, dto.customerId);
      const replay = await this.findByKey(tx, user.tenantId, dto.idempotencyKey);
      if (replay) return this.replayOf(replay, sameRequest(replay));

      const { entry } = await this.openReceivableInTx(tx, account, {
        branchId: dto.branchId,
        orderId: null,
        description: dto.description,
        totalCents: dto.totalCents,
        plan,
        createdByUserId: user.userId,
        idempotencyKey: dto.idempotencyKey,
      });
      return { entry, replay: false };
    });
  }

  // ---- payment -------------------------------------------------------------------------------

  // Receives money for a receivable: all of what is open or part of it. The amount is spread
  // over the installments here, on the rows read under the lock; a cash payment also writes its
  // movement in the open cash session of the branch, in this same transaction.
  async registerPayment(user: AuthenticatedRequestUser, id: string, dto: RegisterReceivablePaymentDto) {
    await this.branchAccess.assertAccess(user, dto.branchId);
    const visible = await this.loadVisible(user, id);
    const sameRequest = (entry: ReceivableEntry) =>
      entry.type === 'PAYMENT' && entry.receivableId === id && entry.amountCents === -dto.amountCents && entry.paymentMethod === dto.method;

    // A plain retry is answered before anything else is asked (an open cash session included).
    const early = await this.findByKey(this.prisma, user.tenantId, dto.idempotencyKey);
    if (early) {
      if (!sameRequest(early)) throw receivableIdempotencyKeyReused();
      return { ...(await this.findOne(user, id)), idempotentReplay: true };
    }

    return this.idempotent(user, dto.idempotencyKey, async (tx) => {
      // Lock order: cash session first, then the credit account.
      const sessionId =
        dto.method === 'CASH'
          ? await this.cashRegister.lockOpenSessionForSale(tx, user.tenantId, dto.branchId, CASH_CLOSED_FOR_RECEIPT)
          : null;
      const account = await this.lockAccount(tx, user.tenantId, visible.customerId);
      const replay = await this.findByKey(tx, user.tenantId, dto.idempotencyKey);
      if (replay) return this.replayOf(replay, sameRequest(replay));

      // Read AFTER the lock: this is the state the payment is checked against.
      const receivable = await tx.receivable.findFirst({ where: { id, tenantId: user.tenantId }, include: { installments: true } });
      if (!receivable) throw receivableNotFound();
      if (receivable.status !== 'OPEN') throw receivableNotOpen();
      const states = toStates(receivable.installments);
      const target = dto.installmentId ? states.find((installment) => installment.id === dto.installmentId) : null;
      if (dto.installmentId && !target) throw installmentNotFound();

      const allocations = allocatePayment(states, dto.amountCents, dto.installmentId);
      if (!allocations) throw overpayment(target ? openCentsOf(target) : receivable.totalCents - receivable.paidCents);

      const movement = sessionId
        ? await this.cashRegister.recordReceivableCash(tx, {
            sessionId,
            tenantId: user.tenantId,
            type: 'RECEIVABLE_PAYMENT',
            amountCents: dto.amountCents,
            reason: `Recebimento de fiado: ${receivable.description}`.slice(0, 200),
            userId: user.userId,
          })
        : null;

      const entry = await this.append(tx, account, {
        type: 'PAYMENT',
        amountCents: -dto.amountCents,
        receivableId: id,
        paymentMethod: dto.method,
        branchId: dto.branchId,
        cashMovementId: movement?.id ?? null,
        idempotencyKey: dto.idempotencyKey,
        createdByUserId: user.userId,
      });
      await tx.receivablePaymentAllocation.createMany({
        data: allocations.map((allocation) => ({ entryId: entry.id, ...allocation })),
      });
      for (const allocation of allocations) {
        await tx.receivableInstallment.update({
          where: { id: allocation.installmentId },
          data: { paidCents: { increment: allocation.amountCents } },
        });
      }
      const paidCents = receivable.paidCents + dto.amountCents;
      const settled = paidCents === receivable.totalCents;
      await tx.receivable.update({
        where: { id },
        data: { paidCents, status: settled ? 'PAID' : 'OPEN', settledAt: settled ? entry.createdAt : null },
      });

      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'RECEIVABLE_PAYMENT_RECORDED',
        entity: 'ReceivableEntry',
        entityId: entry.id,
        afterData: {
          receivableId: id,
          customerId: receivable.customerId,
          amountCents: dto.amountCents,
          method: dto.method,
          branchId: dto.branchId,
          cashMovementId: movement?.id ?? null,
          paidCents,
          settled,
          balanceAfterCents: entry.balanceAfterCents,
        },
      });
      return { entry, replay: false };
    });
  }

  // Undoes a payment entered by mistake (or a returned one): the installments it paid and the
  // receivable go back to what they were, and the debt comes back. For a cash payment the money
  // leaves the drawer of the branch given, which must have an open session.
  async reversePayment(user: AuthenticatedRequestUser, entryId: string, dto: ReverseReceivablePaymentDto) {
    const scope = await this.visibility(user);
    const target = await this.prisma.receivableEntry.findFirst({
      where: { id: entryId, tenantId: user.tenantId, receivable: scope },
      include: { allocations: true },
    });
    if (!target) throw receivableEntryNotFound();
    if (dto.branchId) await this.branchAccess.assertAccess(user, dto.branchId);
    const sameRequest = (entry: ReceivableEntry) => entry.type === 'REVERSAL' && entry.reversedEntryId === entryId;

    const early = await this.findByKey(this.prisma, user.tenantId, dto.idempotencyKey);
    if (early) {
      if (!sameRequest(early)) throw receivableIdempotencyKeyReused();
      return { ...(await this.findOne(user, target.receivableId)), idempotentReplay: true };
    }
    if (target.type !== 'PAYMENT') throw entryNotReversible();
    if (target.paymentMethod === 'CASH' && !dto.branchId) throw refundBranchRequired();

    return this.idempotent(user, dto.idempotencyKey, async (tx) => {
      const sessionId =
        target.paymentMethod === 'CASH'
          ? await this.cashRegister.lockOpenSessionForSale(tx, user.tenantId, dto.branchId as string, CASH_CLOSED_FOR_REFUND)
          : null;
      const account = await this.lockAccount(tx, user.tenantId, target.customerId);
      const replay = await this.findByKey(tx, user.tenantId, dto.idempotencyKey);
      if (replay) return this.replayOf(replay, sameRequest(replay));

      const alreadyReversed = await tx.receivableEntry.findUnique({ where: { reversedEntryId: entryId }, select: { id: true } });
      if (alreadyReversed) throw entryAlreadyReversed();
      const receivable = await tx.receivable.findFirst({ where: { id: target.receivableId, tenantId: user.tenantId } });
      if (!receivable) throw receivableNotFound();

      const refunded = -target.amountCents; // a payment is negative; what goes back is positive
      const movement = sessionId
        ? await this.cashRegister.recordReceivableCash(tx, {
            sessionId,
            tenantId: user.tenantId,
            type: 'RECEIVABLE_REFUND',
            amountCents: refunded,
            reason: `Estorno de recebimento de fiado: ${dto.reason}`.slice(0, 200),
            userId: user.userId,
          })
        : null;

      const entry = await this.append(tx, account, {
        type: 'REVERSAL',
        amountCents: refunded,
        receivableId: target.receivableId,
        branchId: dto.branchId ?? target.branchId,
        cashMovementId: movement?.id ?? null,
        reversedEntryId: target.id,
        reason: dto.reason,
        idempotencyKey: dto.idempotencyKey,
        createdByUserId: user.userId,
      });
      for (const allocation of target.allocations) {
        await tx.receivableInstallment.update({
          where: { id: allocation.installmentId },
          data: { paidCents: { decrement: allocation.amountCents } },
        });
      }
      const paidCents = receivable.paidCents - refunded;
      await tx.receivable.update({
        where: { id: receivable.id },
        data: { paidCents, status: 'OPEN', settledAt: null },
      });

      await this.audit.recordTx(tx, {
        tenantId: user.tenantId,
        userId: user.userId,
        action: 'RECEIVABLE_PAYMENT_REVERSED',
        entity: 'ReceivableEntry',
        entityId: entry.id,
        afterData: {
          receivableId: receivable.id,
          customerId: receivable.customerId,
          reversedEntryId: target.id,
          amountCents: refunded,
          method: target.paymentMethod,
          cashMovementId: movement?.id ?? null,
          paidCents,
          balanceAfterCents: entry.balanceAfterCents,
          reason: dto.reason,
        },
      });
      return { entry, replay: false };
    });
  }

  // ---- cancellation --------------------------------------------------------------------------

  // Removes a debt nobody paid anything of (a charge entered twice, a sale that was not to be on
  // account). With payments it is refused: they are reversed first, one by one, each on record.
  // Idempotent by state: cancelling a cancelled receivable changes nothing.
  async cancel(user: AuthenticatedRequestUser, id: string, dto: CancelReceivableDto) {
    const visible = await this.loadVisible(user, id);
    await this.prisma.$transaction(async (tx) => {
      const account = await this.lockAccount(tx, user.tenantId, visible.customerId);
      await this.cancelInTx(tx, account, id, dto.reason, user.userId);
    }, TRANSACTION_OPTIONS);
    return this.findOne(user, id);
  }

  // ---- order integration (inside the order's transaction) --------------------------------------

  // Step 1 of selling on account: lock the customer's credit account and check the rule against
  // what it really is now - a limit, nothing overdue, room for this sale. Nothing is written
  // yet (the order does not exist); the lock is held until the transaction ends.
  async reserveSaleInTx(
    tx: Tx,
    input: { tenantId: string; customerId: string | null; totalCents: number; terms: CreditTerms | null; actorUserId: string | null },
  ): Promise<CreditReservation> {
    if (!input.customerId) throw creditCustomerRequired();
    if (!input.actorUserId) {
      // Only the staff flows sell on account, and they always know who is selling.
      throw new InternalServerErrorException('sale on account without an acting user');
    }
    if (!Number.isInteger(input.totalCents) || input.totalCents < 1) throw nothingToCharge();

    const today = await this.tenantToday(tx, input.tenantId);
    const terms = input.terms ?? { installments: 1, firstDueDate: addDays(today, DEFAULT_DUE_IN_DAYS) };
    const problem = validateTerms({ totalCents: input.totalCents, ...terms, today });
    if (problem) throw invalidTerms(problem);

    const account = await this.lockAccount(tx, input.tenantId, input.customerId);
    if (account.creditLimitCents <= 0) throw creditNotAllowed();
    const overdueCents = await this.overdueCentsOf(tx, input.tenantId, input.customerId, today);
    if (overdueCents > 0) throw customerOverdue(overdueCents);
    if (account.balanceCents + input.totalCents > account.creditLimitCents) {
      throw creditLimitExceeded({
        creditLimitCents: account.creditLimitCents,
        balanceCents: account.balanceCents,
        requestedCents: input.totalCents,
      });
    }

    return {
      account,
      totalCents: input.totalCents,
      plan: buildInstallmentPlan(input.totalCents, terms.installments, terms.firstDueDate),
      actorUserId: input.actorUserId,
    };
  }

  // Step 2: the order exists; open its receivable.
  async commitSaleInTx(tx: Tx, reservation: CreditReservation, order: { id: string; orderNumber: string; branchId: string }) {
    return this.openReceivableInTx(tx, reservation.account, {
      branchId: order.branchId,
      orderId: order.id,
      description: `Pedido ${order.orderNumber}`,
      totalCents: reservation.totalCents,
      plan: reservation.plan,
      createdByUserId: reservation.actorUserId,
      idempotencyKey: null,
    });
  }

  // Whether the debt of an order was opened with the terms a repeated request states (the
  // idempotent replay of a sale compares them). Terms left out mean the default, which is one
  // installment whatever its date.
  async saleHasTerms(tenantId: string, orderId: string, terms: CreditTerms | null): Promise<boolean> {
    const installments = await this.prisma.receivableInstallment.findMany({
      where: { receivable: { orderId, tenantId } },
      orderBy: { number: 'asc' },
      select: { dueDate: true },
    });
    if (installments.length === 0) return false;
    if (!terms) return installments.length === 1;
    return installments.length === terms.installments && dateToDateOnly(installments[0].dueDate) === terms.firstDueDate;
  }

  // A cancelled order takes its debt with it, in the transaction that cancels it. If money was
  // already received for it the cancellation is refused: the payments are reversed first.
  async cancelForOrderInTx(tx: Tx, input: { tenantId: string; orderId: string; actorUserId: string | null }) {
    const receivable = await tx.receivable.findFirst({
      where: { orderId: input.orderId, tenantId: input.tenantId },
      select: { id: true, customerId: true, status: true, createdByUserId: true },
    });
    if (!receivable || receivable.status === 'CANCELLED') return;
    const account = await this.lockAccount(tx, input.tenantId, receivable.customerId);
    await this.cancelInTx(tx, account, receivable.id, ORDER_CANCELLED_REASON, input.actorUserId ?? receivable.createdByUserId);
  }

  // An order sold on account is owed by the customer it names: it cannot change customer while
  // that debt exists.
  async assertOrderCustomerCanChangeInTx(tx: Tx, orderId: string): Promise<void> {
    const receivable = await tx.receivable.findFirst({ where: { orderId, status: { not: 'CANCELLED' } }, select: { id: true } });
    if (receivable) throw orderHasReceivable();
  }

  // ---- internals -----------------------------------------------------------------------------

  private async tenantToday(db: Tx | PrismaService, tenantId: string): Promise<string> {
    const tenant = await db.tenant.findUnique({ where: { id: tenantId }, select: { timezone: true } });
    return todayInTimeZone(tenant?.timezone ?? DEFAULT_TIME_ZONE);
  }

  private async loadCustomer(tenantId: string, customerId: string) {
    const customer = await this.prisma.customer.findFirst({ where: { id: customerId, tenantId }, select: { id: true, active: true } });
    if (!customer) throw customerNotFound();
    return customer;
  }

  // Receivables the caller may see: the tenant's, and - unless OWNER/ADMIN - only those of the
  // branches they are linked to.
  private async visibility(user: AuthenticatedRequestUser): Promise<Prisma.ReceivableWhereInput> {
    const allowed = await this.branchAccess.accessibleBranchIds(user);
    return { tenantId: user.tenantId, ...(allowed ? { branchId: { in: allowed } } : {}) };
  }

  private async loadVisible(user: AuthenticatedRequestUser, id: string) {
    const receivable = await this.prisma.receivable.findFirst({
      where: { id, ...(await this.visibility(user)) },
      select: { id: true, customerId: true },
    });
    if (!receivable) throw receivableNotFound();
    return receivable;
  }

  private statusFilter(status: string, today: string): Prisma.ReceivableWhereInput {
    switch (status) {
      case 'open':
        return { status: 'OPEN' };
      case 'overdue':
        return { status: 'OPEN', installments: { some: this.overdueInstallment(today) } };
      case 'paid':
        return { status: 'PAID' };
      case 'cancelled':
        return { status: 'CANCELLED' };
      default:
        return {};
    }
  }

  // An installment that still owes something and was due before today.
  private overdueInstallment(today: string): Prisma.ReceivableInstallmentWhereInput {
    return {
      dueDate: { lt: dateOnlyToDate(today) },
      paidCents: { lt: this.prisma.receivableInstallment.fields.amountCents },
    };
  }

  // Sum of what is overdue for one customer (all branches: the limit is the customer's).
  private async overdueCentsOf(db: Tx | PrismaService, tenantId: string, customerId: string, today: string): Promise<number> {
    const rows = await db.receivableInstallment.findMany({
      where: { ...this.overdueInstallment(today), receivable: { tenantId, customerId, status: 'OPEN' } },
      select: { amountCents: true, paidCents: true },
    });
    return rows.reduce((total, row) => total + (row.amountCents - row.paidCents), 0);
  }

  // The cards above the list: what is open, what is overdue, how many customers owe.
  private async summary(scope: Prisma.ReceivableWhereInput, today: string) {
    const open: Prisma.ReceivableWhereInput = { ...scope, status: 'OPEN' };
    const [totals, overdue, debtors] = await Promise.all([
      this.prisma.receivable.aggregate({ where: open, _sum: { totalCents: true, paidCents: true }, _count: { _all: true } }),
      this.prisma.receivableInstallment.findMany({
        where: { ...this.overdueInstallment(today), receivable: open },
        select: { amountCents: true, paidCents: true, receivableId: true },
      }),
      this.prisma.receivable.groupBy({ by: ['customerId'], where: open, orderBy: { customerId: 'asc' } }),
    ]);
    return {
      openCents: (totals._sum.totalCents ?? 0) - (totals._sum.paidCents ?? 0),
      openCount: totals._count._all,
      overdueCents: overdue.reduce((total, row) => total + (row.amountCents - row.paidCents), 0),
      overdueCount: new Set(overdue.map((row) => row.receivableId)).size,
      customersInDebt: debtors.length,
    };
  }

  // Created on first use (INSERT ... ON CONFLICT DO NOTHING) and then locked: from here to the
  // end of the transaction nobody else reads-then-writes this customer's debt or limit.
  private async lockAccount(tx: Tx, tenantId: string, customerId: string): Promise<LockedAccount> {
    await tx.creditAccount.createMany({ data: [{ tenantId, customerId }], skipDuplicates: true });
    const rows = await tx.$queryRaw<{ id: string; creditLimitCents: number; balanceCents: number }[]>`
      SELECT "id", "creditLimitCents", "balanceCents" FROM "credit_accounts"
       WHERE "customerId" = ${customerId} AND "tenantId" = ${tenantId}
         FOR UPDATE`;
    if (rows.length === 0) throw customerNotFound();
    return { id: rows[0].id, tenantId, customerId, creditLimitCents: rows[0].creditLimitCents, balanceCents: rows[0].balanceCents };
  }

  // The only place the debt changes: append the entry with the balance it leaves, then store
  // that same balance on the (locked) account.
  private async append(tx: Tx, account: LockedAccount, data: NewEntry): Promise<ReceivableEntry> {
    const balanceAfterCents = account.balanceCents + data.amountCents;
    if (balanceAfterCents < 0 || balanceAfterCents > MAX_RECEIVABLE_CENTS) {
      // Unreachable while the callers check the receivable first; never let it reach the CHECK.
      throw overpayment(account.balanceCents);
    }
    const entry = await tx.receivableEntry.create({
      data: {
        tenantId: account.tenantId,
        accountId: account.id,
        customerId: account.customerId,
        receivableId: data.receivableId,
        type: data.type,
        amountCents: data.amountCents,
        balanceAfterCents,
        paymentMethod: data.paymentMethod ?? null,
        branchId: data.branchId ?? null,
        cashMovementId: data.cashMovementId ?? null,
        reversedEntryId: data.reversedEntryId ?? null,
        reason: data.reason ?? null,
        idempotencyKey: data.idempotencyKey ?? null,
        createdByUserId: data.createdByUserId,
      },
    });
    await tx.creditAccount.update({ where: { id: account.id }, data: { balanceCents: balanceAfterCents } });
    account.balanceCents = balanceAfterCents;
    return entry;
  }

  // Receivable + its installments + the CHARGE entry, and the audit row, as one unit.
  private async openReceivableInTx(
    tx: Tx,
    account: LockedAccount,
    input: {
      branchId: string;
      orderId: string | null;
      description: string;
      totalCents: number;
      plan: InstallmentPlanItem[];
      createdByUserId: string;
      idempotencyKey: string | null;
    },
  ) {
    const receivable = await tx.receivable.create({
      data: {
        tenantId: account.tenantId,
        branchId: input.branchId,
        customerId: account.customerId,
        accountId: account.id,
        orderId: input.orderId,
        description: input.description,
        totalCents: input.totalCents,
        createdByUserId: input.createdByUserId,
        installments: {
          create: input.plan.map((item) => ({
            tenantId: account.tenantId,
            number: item.number,
            dueDate: dateOnlyToDate(item.dueDate),
            amountCents: item.amountCents,
          })),
        },
      },
    });
    const entry = await this.append(tx, account, {
      type: 'CHARGE',
      amountCents: input.totalCents,
      receivableId: receivable.id,
      branchId: input.branchId,
      idempotencyKey: input.idempotencyKey,
      createdByUserId: input.createdByUserId,
    });
    await this.audit.recordTx(tx, {
      tenantId: account.tenantId,
      userId: input.createdByUserId,
      action: 'RECEIVABLE_CREATED',
      entity: 'Receivable',
      entityId: receivable.id,
      afterData: {
        customerId: account.customerId,
        branchId: input.branchId,
        orderId: input.orderId,
        totalCents: input.totalCents,
        installments: input.plan.length,
        firstDueDate: input.plan[0].dueDate,
        balanceAfterCents: entry.balanceAfterCents,
      },
    });
    return { receivable, entry };
  }

  // With the account locked: cancel one receivable that received nothing.
  private async cancelInTx(tx: Tx, account: LockedAccount, receivableId: string, reason: string, actorUserId: string) {
    const receivable = await tx.receivable.findFirst({ where: { id: receivableId, tenantId: account.tenantId } });
    if (!receivable) throw receivableNotFound();
    if (receivable.status === 'CANCELLED') return;
    if (receivable.status === 'PAID' || receivable.paidCents > 0) throw receivableHasPayments();

    const charge = await tx.receivableEntry.findFirst({ where: { receivableId, type: 'CHARGE' }, select: { id: true } });
    if (!charge) throw receivableNotFound();
    const entry = await this.append(tx, account, {
      type: 'REVERSAL',
      amountCents: -receivable.totalCents,
      receivableId,
      branchId: receivable.branchId,
      reversedEntryId: charge.id,
      reason,
      createdByUserId: actorUserId,
    });
    await tx.receivable.update({
      where: { id: receivableId },
      data: { status: 'CANCELLED', cancelledAt: entry.createdAt, cancelReason: reason },
    });
    await this.audit.recordTx(tx, {
      tenantId: account.tenantId,
      userId: actorUserId,
      action: 'RECEIVABLE_CANCELLED',
      entity: 'Receivable',
      entityId: receivableId,
      beforeData: { status: receivable.status },
      afterData: {
        status: 'CANCELLED',
        customerId: receivable.customerId,
        orderId: receivable.orderId,
        totalCents: receivable.totalCents,
        balanceAfterCents: entry.balanceAfterCents,
        reason,
      },
    });
  }

  private findByKey(db: Tx | PrismaService, tenantId: string, idempotencyKey: string) {
    return db.receivableEntry.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey } } });
  }

  private replayOf(existing: ReceivableEntry, sameOperation: boolean) {
    if (!sameOperation) throw receivableIdempotencyKeyReused();
    return { entry: existing, replay: true };
  }

  // Runs one keyed movement and answers with the receivable it touched. The key is re-checked
  // INSIDE the transaction after the locks (see the callers); the unique index on
  // (tenantId, idempotencyKey) is the last barrier.
  private async idempotent(
    user: AuthenticatedRequestUser,
    idempotencyKey: string,
    work: (tx: Tx) => Promise<{ entry: ReceivableEntry; replay: boolean }>,
  ) {
    let result: { entry: ReceivableEntry; replay: boolean };
    try {
      result = await this.prisma.$transaction(work, TRANSACTION_OPTIONS);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const target = String((error.meta?.target as string[] | string | undefined) ?? '');
        if (target.includes('reversedEntryId')) throw entryAlreadyReversed();
        const existing = await this.findByKey(this.prisma, user.tenantId, idempotencyKey);
        if (existing) throw receivableIdempotencyKeyReused();
      }
      throw error;
    }
    return { ...(await this.findOne(user, result.entry.receivableId)), entryId: result.entry.id, idempotentReplay: result.replay };
  }
}

// Prisma's `contains` does not escape LIKE wildcards.
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (char) => '\\' + char);
}
