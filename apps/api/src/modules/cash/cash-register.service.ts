import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { OpenCashSessionDto } from './dto/open-session.dto';
import { CloseCashSessionDto } from './dto/close-session.dto';
import { CreateCashMovementDto } from './dto/create-movement.dto';
import { ListCashSessionsQueryDto } from './dto/list-sessions-query.dto';
import {
  computeCashTotals,
  computeDifferenceCents,
  computeExpectedBalanceCents,
} from './cash-calculations';

type Tx = Prisma.TransactionClient;

const sessionDetailInclude = {
  branch: { select: { name: true } },
  openedBy: { select: { id: true, name: true } },
  closedBy: { select: { id: true, name: true } },
  movements: {
    orderBy: { createdAt: 'desc' as const },
    include: {
      createdBy: { select: { id: true, name: true } },
      order: { select: { orderNumber: true } },
    },
  },
} satisfies Prisma.CashRegisterSessionInclude;

type SessionWithDetail = Prisma.CashRegisterSessionGetPayload<{ include: typeof sessionDetailInclude }>;

// ===========================================================================
// Financial module. Invariants enforced here:
//  - every money value is integer cents, computed server-side only;
//  - opening is serialized per branch (SELECT ... FOR UPDATE on the branch row)
//    + a partial unique index as DB-level backstop (prisma/sql/...);
//  - closing / adding a movement / recording a CASH sale all lock the SESSION
//    row FOR UPDATE and re-check status inside the transaction, so a movement
//    can never land in a session that is being closed, and a session can
//    never be closed twice;
//  - movements are append-only (no update/delete path exists; DB trigger too);
//  - tenantId always from the JWT; branch always re-validated via
//    BranchAccessService.
// ===========================================================================
@Injectable()
export class CashRegisterService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  async open(user: AuthenticatedRequestUser, dto: OpenCashSessionDto) {
    await this.branchAccess.assertAccess(user, dto.branchId);

    let sessionId: string;
    try {
      sessionId = await this.prisma.$transaction(async (tx) => {
        // Serializes concurrent openings for THIS branch: the second request
        // blocks here until the first commits, and then its check below sees
        // the committed OPEN session (READ COMMITTED re-reads after the lock).
        await tx.$queryRaw`SELECT id FROM "branches" WHERE id = ${dto.branchId} FOR UPDATE`;
        const existing = await tx.cashRegisterSession.findFirst({
          where: { tenantId: user.tenantId, branchId: dto.branchId, status: 'OPEN' },
          select: { id: true },
        });
        if (existing) throw this.alreadyOpen();
        const created = await tx.cashRegisterSession.create({
          data: {
            tenantId: user.tenantId,
            branchId: dto.branchId,
            openedByUserId: user.userId,
            status: 'OPEN',
            openingBalanceCents: dto.openingBalanceCents,
            notes: dto.notes?.trim() || null,
          },
          select: { id: true },
        });
        return created.id;
      });
    } catch (error) {
      // Backstop: the partial unique index fired (should be unreachable
      // given the row lock above, but never let it surface as a 500).
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.alreadyOpen();
      }
      throw error;
    }

    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'CASH_SESSION_OPENED',
      entity: 'CashRegisterSession',
      entityId: sessionId,
      afterData: { branchId: dto.branchId, openingBalanceCents: dto.openingBalanceCents },
    });
    return this.findOne(user, sessionId);
  }

  async getCurrent(user: AuthenticatedRequestUser, branchId: string) {
    await this.branchAccess.assertAccess(user, branchId);
    const session = await this.prisma.cashRegisterSession.findFirst({
      where: { tenantId: user.tenantId, branchId, status: 'OPEN' },
      include: sessionDetailInclude,
    });
    return { session: session ? this.toDetail(session) : null };
  }

  async list(user: AuthenticatedRequestUser, query: ListCashSessionsQueryDto) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    let branchFilter: Prisma.CashRegisterSessionWhereInput;
    if (query.branchId) {
      await this.branchAccess.assertAccess(user, query.branchId);
      branchFilter = { branchId: query.branchId };
    } else {
      // No explicit branch: restrict to branches the caller may operate, so
      // a CASHIER linked to branch A never lists branch B's sessions.
      const accessible = await this.branchAccess.listAccessible(user);
      branchFilter = { branchId: { in: accessible.map((b) => b.id) } };
    }
    const where: Prisma.CashRegisterSessionWhereInput = {
      tenantId: user.tenantId,
      ...branchFilter,
      ...(query.status ? { status: query.status } : {}),
    };
    const [total, sessions] = await this.prisma.$transaction([
      this.prisma.cashRegisterSession.count({ where }),
      this.prisma.cashRegisterSession.findMany({
        where,
        orderBy: { openedAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { branch: { select: { name: true } }, openedBy: { select: { id: true, name: true } } },
      }),
    ]);
    return {
      data: sessions.map((s) => ({
        id: s.id,
        branchId: s.branchId,
        branchName: s.branch.name,
        status: s.status,
        openingBalanceCents: s.openingBalanceCents,
        expectedClosingBalanceCents: s.expectedClosingBalanceCents,
        countedClosingBalanceCents: s.countedClosingBalanceCents,
        differenceCents: s.differenceCents,
        openedBy: s.openedBy,
        openedAt: s.openedAt,
        closedAt: s.closedAt,
      })),
      meta: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async findOne(user: AuthenticatedRequestUser, id: string) {
    const session = await this.prisma.cashRegisterSession.findFirst({
      where: { id, tenantId: user.tenantId },
      include: sessionDetailInclude,
    });
    if (!session) throw this.notFound();
    await this.branchAccess.assertAccess(user, session.branchId);
    return this.toDetail(session);
  }

  async addMovement(user: AuthenticatedRequestUser, sessionId: string, dto: CreateCashMovementDto) {
    const session = await this.findSessionForWrite(user, sessionId);

    const movement = await this.prisma.$transaction(async (tx) => {
      await this.lockSessionAndAssertOpen(tx, session.id, 'CASH_SESSION_CLOSED');
      return tx.cashMovement.create({
        data: {
          sessionId: session.id,
          tenantId: user.tenantId,
          type: dto.type,
          amountCents: dto.amountCents,
          reason: dto.reason?.trim() || null,
          createdByUserId: user.userId,
        },
        select: { id: true },
      });
    });

    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'CASH_MOVEMENT_CREATED',
      entity: 'CashMovement',
      entityId: movement.id,
      afterData: { sessionId: session.id, type: dto.type, amountCents: dto.amountCents },
    });
    return this.findOne(user, session.id);
  }

  async close(user: AuthenticatedRequestUser, sessionId: string, dto: CloseCashSessionDto) {
    const session = await this.findSessionForWrite(user, sessionId);

    const result = await this.prisma.$transaction(async (tx) => {
      // Second concurrent close blocks here, then sees CLOSED and fails.
      await this.lockSessionAndAssertOpen(tx, session.id, 'CASH_SESSION_ALREADY_CLOSED');
      const fresh = await tx.cashRegisterSession.findUniqueOrThrow({
        where: { id: session.id },
        select: { openingBalanceCents: true },
      });
      const movements = await tx.cashMovement.findMany({
        where: { sessionId: session.id },
        select: { type: true, amountCents: true },
      });
      const totals = computeCashTotals(movements);
      const expected = computeExpectedBalanceCents(fresh.openingBalanceCents, totals);
      const difference = computeDifferenceCents(dto.countedClosingBalanceCents, expected);
      await tx.cashRegisterSession.update({
        where: { id: session.id },
        data: {
          status: 'CLOSED',
          closedByUserId: user.userId,
          closedAt: new Date(),
          expectedClosingBalanceCents: expected,
          countedClosingBalanceCents: dto.countedClosingBalanceCents,
          differenceCents: difference,
          ...(dto.notes?.trim() ? { notes: dto.notes.trim() } : {}),
        },
      });
      return { expected, difference };
    });

    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'CASH_SESSION_CLOSED',
      entity: 'CashRegisterSession',
      entityId: session.id,
      beforeData: { status: 'OPEN' },
      afterData: {
        status: 'CLOSED',
        expectedClosingBalanceCents: result.expected,
        countedClosingBalanceCents: dto.countedClosingBalanceCents,
        differenceCents: result.difference,
      },
    });
    return this.findOne(user, session.id);
  }

  // ---------------------------------------------------------------------
  // PDV integration — called INSIDE OrderCreationService's transaction, so
  // the Order and its SALE movement commit or roll back together.
  // ---------------------------------------------------------------------
  async lockOpenSessionForSale(tx: Tx, tenantId: string, branchId: string): Promise<string> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM "cash_register_sessions"
      WHERE "tenantId" = ${tenantId} AND "branchId" = ${branchId} AND "status" = 'OPEN'
      FOR UPDATE`;
    if (rows.length === 0) {
      throw new ConflictException({
        code: 'CASH_REGISTER_NOT_OPEN',
        message: 'Não há caixa aberto nesta unidade. Abra o caixa antes de vender em dinheiro.',
      });
    }
    return rows[0].id;
  }

  recordSale(
    tx: Tx,
    input: { sessionId: string; tenantId: string; orderId: string; amountCents: number; userId: string },
  ) {
    // CashMovement.orderId is UNIQUE: a second SALE for the same order is
    // rejected by the database itself (idempotency guarantee).
    return tx.cashMovement.create({
      data: {
        sessionId: input.sessionId,
        tenantId: input.tenantId,
        type: 'SALE',
        amountCents: input.amountCents,
        orderId: input.orderId,
        createdByUserId: input.userId,
      },
      select: { id: true },
    });
  }

  // ---------------------------------------------------------------------

  private async findSessionForWrite(user: AuthenticatedRequestUser, sessionId: string) {
    const session = await this.prisma.cashRegisterSession.findFirst({
      where: { id: sessionId, tenantId: user.tenantId },
      select: { id: true, branchId: true },
    });
    if (!session) throw this.notFound();
    await this.branchAccess.assertAccess(user, session.branchId);
    return session;
  }

  private async lockSessionAndAssertOpen(tx: Tx, sessionId: string, closedCode: string) {
    const rows = await tx.$queryRaw<{ status: string }[]>`
      SELECT "status" FROM "cash_register_sessions" WHERE id = ${sessionId} FOR UPDATE`;
    if (rows.length === 0) throw this.notFound();
    if (rows[0].status !== 'OPEN') {
      throw new ConflictException({
        code: closedCode,
        message: 'Este caixa já está fechado e não pode ser alterado.',
      });
    }
  }

  private toDetail(session: SessionWithDetail) {
    const totals = computeCashTotals(session.movements);
    const liveExpected = computeExpectedBalanceCents(session.openingBalanceCents, totals);
    return {
      id: session.id,
      branchId: session.branchId,
      branchName: session.branch.name,
      status: session.status,
      openingBalanceCents: session.openingBalanceCents,
      totals,
      // OPEN: live value; CLOSED: the value frozen at closing time.
      expectedBalanceCents:
        session.status === 'CLOSED' ? session.expectedClosingBalanceCents : liveExpected,
      countedClosingBalanceCents: session.countedClosingBalanceCents,
      differenceCents: session.differenceCents,
      openedBy: session.openedBy,
      closedBy: session.closedBy,
      openedAt: session.openedAt,
      closedAt: session.closedAt,
      notes: session.notes,
      movements: session.movements.map((m) => ({
        id: m.id,
        type: m.type,
        amountCents: m.amountCents,
        reason: m.reason,
        orderId: m.orderId,
        orderNumber: m.order?.orderNumber ?? null,
        createdBy: m.createdBy,
        createdAt: m.createdAt,
      })),
    };
  }

  private alreadyOpen() {
    return new ConflictException({
      code: 'CASH_SESSION_ALREADY_OPEN',
      message: 'Já existe um caixa aberto nesta unidade.',
    });
  }

  private notFound() {
    return new NotFoundException({ code: 'NOT_FOUND', message: 'Sessão de caixa não encontrada.' });
  }
}
