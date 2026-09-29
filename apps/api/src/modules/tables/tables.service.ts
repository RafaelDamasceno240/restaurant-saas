import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DiningTable, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { CreateTableDto } from './dto/create-table.dto';
import { UpdateTableDto } from './dto/update-table.dto';

const withOpenTab = {
  tabs: {
    where: { status: 'OPEN' as const },
    take: 1,
    select: {
      id: true,
      items: { select: { unitPriceCentsSnapshot: true, quantity: true } },
    },
  },
} satisfies Prisma.DiningTableInclude;

type TableWithOpenTab = Prisma.DiningTableGetPayload<{ include: typeof withOpenTab }>;

// ===========================================================================
// Fatia 09 (Mesas). Invariants enforced here:
//  - every table has an explicit tenantId + branchId; branch always
//    re-validated via BranchAccessService (same rule as cash/pos);
//  - table number is unique WITHIN a branch (@@unique([branchId, number])) —
//    the app-level catch below turns the DB's P2002 into a clean 409;
//  - a table with an OPEN tab can never be deleted (checked here; the FK
//    from Tab.table is Restrict as a backstop for closed/historical tabs).
// "status" (AVAILABLE/OCCUPIED) is DERIVED, never stored — it's just
// "does this table have an OPEN tab right now", computed straight off the
// same query that lists/reads the table (no separate round trip).
// ===========================================================================
@Injectable()
export class TablesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  async findAllForBranch(user: AuthenticatedRequestUser, branchId: string) {
    await this.branchAccess.assertAccess(user, branchId);
    const tables = await this.prisma.diningTable.findMany({
      where: { tenantId: user.tenantId, branchId },
      include: withOpenTab,
      orderBy: { number: 'asc' },
    });
    return tables.map((t) => this.toDto(t));
  }

  async findOneForTenant(user: AuthenticatedRequestUser, id: string) {
    const table = await this.prisma.diningTable.findFirst({
      where: { id, tenantId: user.tenantId },
      include: withOpenTab,
    });
    if (!table) throw this.notFound();
    await this.branchAccess.assertAccess(user, table.branchId);
    return this.toDto(table);
  }

  async create(user: AuthenticatedRequestUser, dto: CreateTableDto) {
    await this.branchAccess.assertAccess(user, dto.branchId);

    let table: DiningTable;
    try {
      table = await this.prisma.diningTable.create({
        data: {
          tenantId: user.tenantId,
          branchId: dto.branchId,
          number: dto.number,
          name: dto.name?.trim() || null,
          active: dto.active ?? true,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.numberTaken();
      }
      throw error;
    }

    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'TABLE_CREATED',
      entity: 'DiningTable',
      entityId: table.id,
      afterData: { branchId: dto.branchId, number: dto.number },
    });
    return this.toDto({ ...table, tabs: [] as never[] });
  }

  async update(user: AuthenticatedRequestUser, id: string, dto: UpdateTableDto) {
    const existing = await this.prisma.diningTable.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!existing) throw this.notFound();
    await this.branchAccess.assertAccess(user, existing.branchId);

    let table: DiningTable;
    try {
      table = await this.prisma.diningTable.update({
        where: { id },
        data: {
          ...(dto.number !== undefined ? { number: dto.number } : {}),
          ...(dto.name !== undefined ? { name: dto.name.trim() || null } : {}),
          ...(dto.active !== undefined ? { active: dto.active } : {}),
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw this.numberTaken();
      }
      throw error;
    }

    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'TABLE_UPDATED',
      entity: 'DiningTable',
      entityId: table.id,
      beforeData: { number: existing.number, name: existing.name, active: existing.active },
      afterData: { number: table.number, name: table.name, active: table.active },
    });
    return this.findOneForTenant(user, id);
  }

  async remove(user: AuthenticatedRequestUser, id: string): Promise<void> {
    const table = await this.prisma.diningTable.findFirst({
      where: { id, tenantId: user.tenantId },
    });
    if (!table) throw this.notFound();
    await this.branchAccess.assertAccess(user, table.branchId);

    const openTab = await this.prisma.tab.findFirst({
      where: { tableId: id, status: 'OPEN' },
      select: { id: true },
    });
    if (openTab) {
      throw new ConflictException({
        code: 'TABLE_HAS_OPEN_TAB',
        message: 'Não é possível excluir uma mesa com uma comanda aberta.',
      });
    }
    // Tab.table has onDelete: Restrict — a table that has EVER had a tab
    // (even a long-closed one) can never be hard-deleted, same permanence
    // rule as Product vs. OrderItem/TabItem: preserving history takes
    // priority over letting the floor plan be tidied up. Deactivate
    // (active: false) instead. Checked explicitly so this is a clean 409
    // instead of a raw Postgres foreign-key-violation error.
    const anyTabCount = await this.prisma.tab.count({ where: { tableId: id } });
    if (anyTabCount > 0) {
      throw new ConflictException({
        code: 'TABLE_HAS_TAB_HISTORY',
        message: 'Não é possível excluir uma mesa que já teve comandas. Desative-a em vez de excluir.',
      });
    }

    await this.prisma.diningTable.delete({ where: { id } });
    await this.audit.record({
      tenantId: user.tenantId,
      userId: user.userId,
      action: 'TABLE_DELETED',
      entity: 'DiningTable',
      entityId: id,
    });
  }

  // Used by TabsService.open() to validate that a tableId belongs to the
  // same tenant + the branch the tab is being opened for, and is active —
  // one place, reused instead of duplicating the lookup.
  async assertActiveTableForBranch(tenantId: string, branchId: string, tableId: string) {
    const table = await this.prisma.diningTable.findFirst({
      where: { id: tableId, tenantId, branchId, active: true },
    });
    if (!table) {
      throw new NotFoundException({
        code: 'TABLE_NOT_FOUND',
        message: 'Mesa não encontrada nesta unidade.',
      });
    }
    return table;
  }

  private toDto(table: TableWithOpenTab) {
    const openTab = table.tabs[0] ?? null;
    // Trivial sum, deliberately re-derived here rather than imported from
    // TabsService/tab-calculations.ts: TabsModule already imports
    // TablesModule (to validate a tableId when opening a tab), so importing
    // back would be circular. Same trade-off as web's lib/money.ts vs.
    // api's money.util.ts — a two-line calculation duplicated once rather
    // than a cross-module/app dependency for it.
    const openTabTotalCents = openTab
      ? openTab.items.reduce((sum, item) => sum + item.unitPriceCentsSnapshot * item.quantity, 0)
      : null;
    const openTabItemCount = openTab
      ? openTab.items.reduce((sum, item) => sum + item.quantity, 0)
      : null;
    return {
      id: table.id,
      tenantId: table.tenantId,
      branchId: table.branchId,
      number: table.number,
      name: table.name,
      active: table.active,
      status: openTab ? ('OCCUPIED' as const) : ('AVAILABLE' as const),
      openTabId: openTab?.id ?? null,
      openTabTotalCents,
      openTabItemCount,
      createdAt: table.createdAt,
      updatedAt: table.updatedAt,
    };
  }

  private numberTaken() {
    return new ConflictException({
      code: 'TABLE_NUMBER_TAKEN',
      message: 'Já existe uma mesa com este número nesta unidade.',
    });
  }

  private notFound() {
    return new NotFoundException({ code: 'TABLE_NOT_FOUND', message: 'Mesa não encontrada.' });
  }
}
