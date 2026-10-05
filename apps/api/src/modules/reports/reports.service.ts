import { BadRequestException, Injectable } from '@nestjs/common';
import { CashMovementType, Prisma } from '@prisma/client';
import { AuthenticatedRequestUser } from '../../common/types/authenticated-request-user';
import { DEFAULT_TIME_ZONE, isValidTimeZone, todayInTimeZone } from '../../common/util/timezone.util';
import { PrismaService } from '../../prisma/prisma.service';
import { BranchAccessService } from '../branches/branch-access.service';
import { CashTotals, computeCashTotals, computeExpectedBalanceCents } from '../cash/cash-calculations';
import {
  CustomersReportQueryDto,
  InventoryReportQueryDto,
  PagedReportQueryDto,
  ProductsReportQueryDto,
  ReportPeriodQueryDto,
} from './dto/reports.dto';
import { averageCents, averageMinutes, fillDays, fillHours, PeriodProblem, ReportPeriod, resolvePeriod } from './report-period';

const DEFAULT_PAGE_SIZE = 20;
const MAX_COURIER_ROWS = 100;

const PERIOD_MESSAGE: Record<PeriodProblem, string> = {
  DATE_INVALID: 'Informe datas válidas no formato AAAA-MM-DD.',
  RANGE_INVERTED: 'A data inicial não pode ser depois da final.',
  RANGE_TOO_LONG: 'O período máximo de um relatório é de 366 dias.',
};

type Count = bigint | number | string | null;
const num = (value: Count): number => (value === null ? 0 : Number(value));
// SUM(quantity * unitCostCents) is a decimal number of cents: rounded once, here.
const cents = (value: Count): number => Math.round(num(value));
// Stock quantities keep their three decimals.
const quantity = (value: Count): number => Number(num(value).toFixed(3));

// Timestamps are stored without a zone, in UTC; compared as zone-less literals.
const timestamp = (date: Date) => Prisma.sql`${date.toISOString().slice(0, 23)}::timestamp`;
const escapeLike = (value: string) => value.replace(/[\\%_]/g, (char) => '\\' + char);

interface Scope {
  tenantId: string;
  period: ReportPeriod;
  // null = every branch of the tenant; [] = the caller is linked to no branch (sees nothing).
  branchIds: string[] | null;
  branchId: string | null;
}

// ===========================================================================================
// Operational reports (Fase 11, fatia 8). Read-only: nothing here writes.
//
// Rules shared by every report (also in docs/REPORTS.md):
//   - tenant from the token, always; a branchId the caller cannot use is refused, and without
//     one the report covers exactly the branches the caller is linked to (all, for OWNER/ADMIN);
//   - the period is a range of CALENDAR DAYS in the restaurant's time zone, both inclusive, at
//     most 366 days; grouping "by day" and "by hour" uses that same zone;
//   - a SALE is an order that was not cancelled, counted on the day it was created;
//   - money is integer cents; everything is aggregated by the database in a fixed number of
//     queries per report (no query per row), and every list is paginated.
// ===========================================================================================
@Injectable()
export class ReportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly branchAccess: BranchAccessService,
  ) {}

  // ---- sales ---------------------------------------------------------------------------------

  async sales(user: AuthenticatedRequestUser, query: ReportPeriodQueryDto) {
    const scope = await this.scope(user, query);
    const orders = Prisma.sql`FROM "orders" o ${this.ordersWhere(scope)}`;
    const sold = Prisma.sql`${orders} AND o."status" <> 'CANCELLED'`;
    const local = Prisma.sql`(o."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${scope.period.timezone}`;

    const [totalsRows, dayRows, hourRows, groupRows] = await Promise.all([
      this.prisma.$queryRaw<
        {
          ordersCount: number;
          itemsCents: Count;
          discountCents: Count;
          cashbackUsedCents: Count;
          deliveryFeeCents: Count;
          totalCents: Count;
          cancelledCount: number;
          cancelledCents: Count;
          concludedCount: number;
          concludedCents: Count;
          onAccountCents: Count;
        }[]
      >`
        SELECT
          COUNT(*) FILTER (WHERE o."status" <> 'CANCELLED')::int AS "ordersCount",
          COALESCE(SUM(o."subtotalCents") FILTER (WHERE o."status" <> 'CANCELLED'), 0)::bigint AS "itemsCents",
          COALESCE(SUM(o."discountCents") FILTER (WHERE o."status" <> 'CANCELLED'), 0)::bigint AS "discountCents",
          COALESCE(SUM(o."cashbackUsedCents") FILTER (WHERE o."status" <> 'CANCELLED'), 0)::bigint AS "cashbackUsedCents",
          COALESCE(SUM(o."deliveryFeeCents") FILTER (WHERE o."status" <> 'CANCELLED'), 0)::bigint AS "deliveryFeeCents",
          COALESCE(SUM(o."totalCents") FILTER (WHERE o."status" <> 'CANCELLED'), 0)::bigint AS "totalCents",
          COUNT(*) FILTER (WHERE o."status" = 'CANCELLED')::int AS "cancelledCount",
          COALESCE(SUM(o."totalCents") FILTER (WHERE o."status" = 'CANCELLED'), 0)::bigint AS "cancelledCents",
          COUNT(*) FILTER (WHERE o."status" IN ('COMPLETED', 'DELIVERED'))::int AS "concludedCount",
          COALESCE(SUM(o."totalCents") FILTER (WHERE o."status" IN ('COMPLETED', 'DELIVERED')), 0)::bigint AS "concludedCents",
          COALESCE(SUM(o."totalCents") FILTER (WHERE o."status" <> 'CANCELLED' AND o."paymentMethod" = 'ON_ACCOUNT'), 0)::bigint AS "onAccountCents"
        ${orders}`,
      this.prisma.$queryRaw<{ day: string; ordersCount: number; totalCents: Count }[]>`
        SELECT to_char(${local}, 'YYYY-MM-DD') AS "day", COUNT(*)::int AS "ordersCount",
               COALESCE(SUM(o."totalCents"), 0)::bigint AS "totalCents"
        ${sold}
        GROUP BY 1
        ORDER BY 1`,
      this.prisma.$queryRaw<{ hour: number; ordersCount: number; totalCents: Count }[]>`
        SELECT EXTRACT(HOUR FROM ${local})::int AS "hour", COUNT(*)::int AS "ordersCount",
               COALESCE(SUM(o."totalCents"), 0)::bigint AS "totalCents"
        ${sold}
        GROUP BY 1
        ORDER BY 1`,
      // The three breakdowns in one pass: each row belongs to exactly one grouping set, told
      // apart by GROUPING() (0 = that column is the one the row is grouped by).
      this.prisma.$queryRaw<
        {
          paymentMethod: string | null;
          source: string | null;
          fulfillmentType: string | null;
          byPayment: number;
          bySource: number;
          byFulfillment: number;
          ordersCount: number;
          totalCents: Count;
        }[]
      >`
        SELECT o."paymentMethod"::text AS "paymentMethod", o."source"::text AS "source", o."fulfillmentType"::text AS "fulfillmentType",
               GROUPING(o."paymentMethod")::int AS "byPayment", GROUPING(o."source")::int AS "bySource",
               GROUPING(o."fulfillmentType")::int AS "byFulfillment",
               COUNT(*)::int AS "ordersCount", COALESCE(SUM(o."totalCents"), 0)::bigint AS "totalCents"
        ${sold}
        GROUP BY GROUPING SETS ((o."paymentMethod"), (o."source"), (o."fulfillmentType"))`,
    ]);

    const totals = totalsRows[0];
    const totalCents = num(totals.totalCents);
    const breakdown = (flag: 'byPayment' | 'bySource' | 'byFulfillment', column: 'paymentMethod' | 'source' | 'fulfillmentType') =>
      groupRows
        .filter((row) => row[flag] === 0)
        .map((row) => ({ key: row[column] as string, ordersCount: row.ordersCount, totalCents: num(row.totalCents) }))
        .sort((a, b) => b.totalCents - a.totalCents || a.key.localeCompare(b.key));

    return {
      ...this.header(scope),
      totals: {
        ordersCount: totals.ordersCount,
        itemsCents: num(totals.itemsCents),
        discountCents: num(totals.discountCents),
        cashbackUsedCents: num(totals.cashbackUsedCents),
        deliveryFeeCents: num(totals.deliveryFeeCents),
        totalCents,
        averageTicketCents: averageCents(totalCents, totals.ordersCount),
        // Already concluded (COMPLETED or DELIVERED), a subset of the sales above.
        concludedCount: totals.concludedCount,
        concludedCents: num(totals.concludedCents),
        // Sold on account (fiado): part of the sales, not yet received.
        onAccountCents: num(totals.onAccountCents),
        // Cancelled orders are NOT in the sales; shown apart.
        cancelledCount: totals.cancelledCount,
        cancelledCents: num(totals.cancelledCents),
      },
      byDay: fillDays(
        scope.period,
        dayRows.map((row) => ({ day: row.day, ordersCount: row.ordersCount, totalCents: num(row.totalCents) })),
        (day) => ({ day, ordersCount: 0, totalCents: 0 }),
      ),
      byHour: fillHours(
        hourRows.map((row) => ({ hour: row.hour, ordersCount: row.ordersCount, totalCents: num(row.totalCents) })),
        (hour) => ({ hour, ordersCount: 0, totalCents: 0 }),
      ),
      byPaymentMethod: breakdown('byPayment', 'paymentMethod'),
      bySource: breakdown('bySource', 'source'),
      byFulfillment: breakdown('byFulfillment', 'fulfillmentType'),
    };
  }

  // ---- products ------------------------------------------------------------------------------

  // What was sold, by product. Revenue here is the items' own value (quantity x unit price at
  // the time): coupons and cashback discount the ORDER, not a product, so they are not spread.
  async products(user: AuthenticatedRequestUser, query: ProductsReportQueryDto) {
    const scope = await this.scope(user, query);
    const { page, pageSize, offset } = paging(query);
    const search = query.search ? Prisma.sql`AND p."name" ILIKE ${`%${escapeLike(query.search)}%`} ESCAPE '\\'` : Prisma.empty;
    const category = query.categoryId ? Prisma.sql`AND p."categoryId" = ${query.categoryId}` : Prisma.empty;
    const from = Prisma.sql`
      FROM "order_items" i
      JOIN "orders" o ON o."id" = i."orderId"
      JOIN "products" p ON p."id" = i."productId" AND p."tenantId" = ${scope.tenantId}
      JOIN "categories" c ON c."id" = p."categoryId"
      ${this.ordersWhere(scope)} AND o."status" <> 'CANCELLED' ${search} ${category}`;
    const order =
      query.sort === 'quantity'
        ? Prisma.sql`ORDER BY "quantity" DESC, "revenueCents" DESC, p."name" ASC, p."id" ASC`
        : Prisma.sql`ORDER BY "revenueCents" DESC, "quantity" DESC, p."name" ASC, p."id" ASC`;

    const [rows, totalsRows] = await Promise.all([
      this.prisma.$queryRaw<
        { productId: string; name: string; categoryName: string; active: boolean; quantity: Count; revenueCents: Count; ordersCount: number }[]
      >`
        SELECT p."id" AS "productId", p."name" AS "name", c."name" AS "categoryName", p."active" AS "active",
               SUM(i."quantity")::bigint AS "quantity", SUM(i."subtotalCents")::bigint AS "revenueCents",
               COUNT(DISTINCT i."orderId")::int AS "ordersCount"
        ${from}
        GROUP BY p."id", p."name", c."name", p."active"
        ${order}
        LIMIT ${pageSize} OFFSET ${offset}`,
      this.prisma.$queryRaw<{ productsCount: number; quantity: Count; revenueCents: Count }[]>`
        SELECT COUNT(DISTINCT p."id")::int AS "productsCount", COALESCE(SUM(i."quantity"), 0)::bigint AS "quantity",
               COALESCE(SUM(i."subtotalCents"), 0)::bigint AS "revenueCents"
        ${from}`,
    ]);

    const totals = totalsRows[0];
    const revenueCents = num(totals.revenueCents);
    return {
      ...this.header(scope),
      totals: { productsCount: totals.productsCount, quantity: num(totals.quantity), revenueCents },
      data: rows.map((row) => ({
        productId: row.productId,
        name: row.name,
        categoryName: row.categoryName,
        active: row.active,
        quantity: num(row.quantity),
        revenueCents: num(row.revenueCents),
        ordersCount: row.ordersCount,
        // Share of the revenue of everything that matches the filters, in basis points.
        shareBps: revenueCents > 0 ? Math.round((num(row.revenueCents) * 10_000) / revenueCents) : 0,
      })),
      meta: meta(page, pageSize, totals.productsCount),
    };
  }

  // ---- customers -----------------------------------------------------------------------------

  async customers(user: AuthenticatedRequestUser, query: CustomersReportQueryDto) {
    const scope = await this.scope(user, query);
    const { page, pageSize, offset } = paging(query);
    const sold = Prisma.sql`FROM "orders" o ${this.ordersWhere(scope)} AND o."status" <> 'CANCELLED'`;
    // The ranking needs the registry (name, phone); the tenant is asserted on that side too.
    const ranked = Prisma.sql`
      FROM "orders" o
      JOIN "customers" c ON c."id" = o."customerId" AND c."tenantId" = ${scope.tenantId}
      ${this.ordersWhere(scope)} AND o."status" <> 'CANCELLED'`;
    const order =
      query.sort === 'orders'
        ? Prisma.sql`ORDER BY "ordersCount" DESC, "totalCents" DESC, c."name" ASC, c."id" ASC`
        : Prisma.sql`ORDER BY "totalCents" DESC, "ordersCount" DESC, c."name" ASC, c."id" ASC`;

    const [rows, summaryRows, newCustomers] = await Promise.all([
      this.prisma.$queryRaw<
        { customerId: string; name: string; phone: string; active: boolean; ordersCount: number; totalCents: Count; lastOrderAt: Date }[]
      >`
        SELECT c."id" AS "customerId", c."name" AS "name", c."phone" AS "phone", c."active" AS "active",
               COUNT(*)::int AS "ordersCount", SUM(o."totalCents")::bigint AS "totalCents", MAX(o."createdAt") AS "lastOrderAt"
        ${ranked}
        GROUP BY c."id", c."name", c."phone", c."active"
        ${order}
        LIMIT ${pageSize} OFFSET ${offset}`,
      this.prisma.$queryRaw<
        { identifiedOrders: number; identifiedCents: Count; anonymousOrders: number; anonymousCents: Count; customersCount: number }[]
      >`
        SELECT COUNT(*) FILTER (WHERE o."customerId" IS NOT NULL)::int AS "identifiedOrders",
               COALESCE(SUM(o."totalCents") FILTER (WHERE o."customerId" IS NOT NULL), 0)::bigint AS "identifiedCents",
               COUNT(*) FILTER (WHERE o."customerId" IS NULL)::int AS "anonymousOrders",
               COALESCE(SUM(o."totalCents") FILTER (WHERE o."customerId" IS NULL), 0)::bigint AS "anonymousCents",
               COUNT(DISTINCT o."customerId")::int AS "customersCount"
        ${sold}`,
      // The registry is the restaurant's, not a branch's: customers registered in the period.
      this.prisma.customer.count({
        where: { tenantId: scope.tenantId, createdAt: { gte: scope.period.fromInstant, lt: scope.period.toInstant } },
      }),
    ]);

    const summary = summaryRows[0];
    return {
      ...this.header(scope),
      totals: {
        customersCount: summary.customersCount,
        identifiedOrders: summary.identifiedOrders,
        identifiedCents: num(summary.identifiedCents),
        anonymousOrders: summary.anonymousOrders,
        anonymousCents: num(summary.anonymousCents),
        newCustomers,
      },
      data: rows.map((row) => {
        const totalCents = num(row.totalCents);
        return {
          customerId: row.customerId,
          name: row.name,
          phone: row.phone,
          active: row.active,
          ordersCount: row.ordersCount,
          totalCents,
          averageTicketCents: averageCents(totalCents, row.ordersCount),
          lastOrderAt: row.lastOrderAt,
        };
      }),
      meta: meta(page, pageSize, summary.customersCount),
    };
  }

  // ---- inventory -----------------------------------------------------------------------------

  // What moved in the stock ledger in the period, by ingredient. Complements the inventory
  // overview (GET /inventory/summary: position, alerts, totals of one branch): this is the
  // ranking of what was consumed and lost. Values use the cost recorded on each movement.
  async inventory(user: AuthenticatedRequestUser, query: InventoryReportQueryDto) {
    const scope = await this.scope(user, query);
    const { page, pageSize, offset } = paging(query);
    const search = query.search ? Prisma.sql`AND it."name" ILIKE ${`%${escapeLike(query.search)}%`} ESCAPE '\\'` : Prisma.empty;
    const from = Prisma.sql`
      FROM "stock_movements" m
      JOIN "inventory_items" it ON it."id" = m."inventoryItemId" AND it."tenantId" = ${scope.tenantId}
      WHERE m."tenantId" = ${scope.tenantId}
        AND m."createdAt" >= ${timestamp(scope.period.fromInstant)} AND m."createdAt" < ${timestamp(scope.period.toInstant)}
        ${this.inBranches(scope, Prisma.sql`m."branchId"`)} ${search}`;

    // quantity is the signed change of the balance: + in, - out. A cancelled purchase and a
    // cancelled order are REVERSAL rows that net against what they undo.
    const cost = Prisma.sql`m."quantity" * COALESCE(m."unitCostCents", 0)`;
    const purchased = Prisma.sql`(m."type" = 'ENTRY' OR (m."type" = 'REVERSAL' AND m."referenceType" = 'PURCHASE'))`;
    const sold = Prisma.sql`(m."type" = 'SALE' OR (m."type" = 'REVERSAL' AND m."referenceType" = 'ORDER'))`;
    const lost = Prisma.sql`(m."type" = 'EXIT' AND m."exitReason" IN ('LOSS', 'DAMAGE'))`;
    const otherExit = Prisma.sql`(m."type" = 'EXIT' AND (m."exitReason" IS NULL OR m."exitReason" NOT IN ('LOSS', 'DAMAGE')))`;
    const sums = Prisma.sql`
      COALESCE(SUM(m."quantity") FILTER (WHERE ${purchased}), 0)::text AS "purchasedQuantity",
      COALESCE(SUM(${cost}) FILTER (WHERE ${purchased}), 0)::text AS "purchasedCost",
      COALESCE(-SUM(m."quantity") FILTER (WHERE ${sold}), 0)::text AS "soldQuantity",
      COALESCE(-SUM(${cost}) FILTER (WHERE ${sold}), 0)::text AS "soldCost",
      COALESCE(-SUM(m."quantity") FILTER (WHERE ${otherExit}), 0)::text AS "otherExitQuantity",
      COALESCE(-SUM(${cost}) FILTER (WHERE ${otherExit}), 0)::text AS "otherExitCost",
      COALESCE(-SUM(m."quantity") FILTER (WHERE ${lost}), 0)::text AS "lossQuantity",
      COALESCE(-SUM(${cost}) FILTER (WHERE ${lost}), 0)::text AS "lossCost",
      COALESCE(SUM(m."quantity") FILTER (WHERE m."type" = 'ADJUSTMENT'), 0)::text AS "adjustmentQuantity"`;
    const order =
      query.sort === 'loss'
        ? Prisma.sql`ORDER BY -SUM(${cost}) FILTER (WHERE ${lost}) DESC NULLS LAST, it."name" ASC, it."id" ASC`
        : query.sort === 'name'
          ? Prisma.sql`ORDER BY it."name" ASC, it."id" ASC`
          : Prisma.sql`ORDER BY -SUM(${cost}) FILTER (WHERE ${sold} OR ${otherExit}) DESC NULLS LAST, it."name" ASC, it."id" ASC`;

    type Sums = {
      purchasedQuantity: string;
      purchasedCost: string;
      soldQuantity: string;
      soldCost: string;
      otherExitQuantity: string;
      otherExitCost: string;
      lossQuantity: string;
      lossCost: string;
      adjustmentQuantity: string;
    };
    const [rows, totalsRows] = await Promise.all([
      this.prisma.$queryRaw<({ inventoryItemId: string; name: string; unit: string; active: boolean } & Sums)[]>`
        SELECT it."id" AS "inventoryItemId", it."name" AS "name", it."unit"::text AS "unit", it."active" AS "active", ${sums}
        ${from}
        GROUP BY it."id", it."name", it."unit", it."active"
        ${order}
        LIMIT ${pageSize} OFFSET ${offset}`,
      this.prisma.$queryRaw<({ itemsCount: number } & Sums)[]>`
        SELECT COUNT(DISTINCT it."id")::int AS "itemsCount", ${sums}
        ${from}`,
    ]);

    // Current balance of the items on this page, in one query (never one per row).
    const itemIds = rows.map((row) => row.inventoryItemId);
    const balances = itemIds.length
      ? await this.prisma.$queryRaw<{ inventoryItemId: string; quantity: string }[]>`
          SELECT b."inventoryItemId" AS "inventoryItemId", SUM(b."quantity")::text AS "quantity"
          FROM "inventory_balances" b
          WHERE b."tenantId" = ${scope.tenantId} AND b."inventoryItemId" IN (${Prisma.join(itemIds)})
            ${this.inBranches(scope, Prisma.sql`b."branchId"`)}
          GROUP BY b."inventoryItemId"`
      : [];
    const balanceOf = new Map(balances.map((row) => [row.inventoryItemId, quantity(row.quantity)]));

    const view = (row: Sums) => ({
      purchasedQuantity: quantity(row.purchasedQuantity),
      purchasedCostCents: cents(row.purchasedCost),
      soldQuantity: quantity(row.soldQuantity),
      soldCostCents: cents(row.soldCost),
      otherExitQuantity: quantity(row.otherExitQuantity),
      otherExitCostCents: cents(row.otherExitCost),
      lossQuantity: quantity(row.lossQuantity),
      lossCostCents: cents(row.lossCost),
      adjustmentQuantity: quantity(row.adjustmentQuantity),
    });
    const totals = totalsRows[0];
    const totalsView = view(totals);
    return {
      ...this.header(scope),
      totals: {
        itemsCount: totals.itemsCount,
        purchasedCostCents: totalsView.purchasedCostCents,
        soldCostCents: totalsView.soldCostCents,
        otherExitCostCents: totalsView.otherExitCostCents,
        lossCostCents: totalsView.lossCostCents,
      },
      data: rows.map((row) => ({
        inventoryItemId: row.inventoryItemId,
        name: row.name,
        unit: row.unit,
        active: row.active,
        ...view(row),
        // What is in stock NOW in the same branches (not at the end of the period).
        currentQuantity: balanceOf.get(row.inventoryItemId) ?? 0,
      })),
      meta: meta(page, pageSize, totals.itemsCount),
    };
  }

  // ---- delivery ------------------------------------------------------------------------------

  // Deliveries CREATED in the period (one per delivery order), whatever became of them.
  async delivery(user: AuthenticatedRequestUser, query: ReportPeriodQueryDto) {
    const scope = await this.scope(user, query);
    const where = Prisma.sql`
      WHERE d."tenantId" = ${scope.tenantId}
        AND d."createdAt" >= ${timestamp(scope.period.fromInstant)} AND d."createdAt" < ${timestamp(scope.period.toInstant)}
        ${this.inBranches(scope, Prisma.sql`d."branchId"`)}`;
    const timed = Prisma.sql`d."status" = 'DELIVERED' AND d."dispatchedAt" IS NOT NULL AND d."deliveredAt" IS NOT NULL`;
    const local = Prisma.sql`(d."createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${scope.period.timezone}`;

    const [totalsRows, courierRows, dayRows] = await Promise.all([
      this.prisma.$queryRaw<
        {
          total: number;
          pending: number;
          outForDelivery: number;
          delivered: number;
          failed: number;
          cancelled: number;
          attempts: number;
          redelivered: number;
          timedCount: number;
          routeSeconds: number | null;
          doorSeconds: number | null;
          feeCents: Count;
          deliveredOrdersCents: Count;
        }[]
      >`
        SELECT COUNT(*)::int AS "total",
               COUNT(*) FILTER (WHERE d."status" = 'PENDING')::int AS "pending",
               COUNT(*) FILTER (WHERE d."status" = 'OUT_FOR_DELIVERY')::int AS "outForDelivery",
               COUNT(*) FILTER (WHERE d."status" = 'DELIVERED')::int AS "delivered",
               COUNT(*) FILTER (WHERE d."status" = 'FAILED')::int AS "failed",
               COUNT(*) FILTER (WHERE d."status" = 'CANCELLED')::int AS "cancelled",
               COALESCE(SUM(d."attemptCount"), 0)::int AS "attempts",
               COUNT(*) FILTER (WHERE d."attemptCount" > 1)::int AS "redelivered",
               COUNT(*) FILTER (WHERE ${timed})::int AS "timedCount",
               (SUM(EXTRACT(EPOCH FROM (d."deliveredAt" - d."dispatchedAt"))) FILTER (WHERE ${timed}))::float8 AS "routeSeconds",
               (SUM(EXTRACT(EPOCH FROM (d."deliveredAt" - o."createdAt"))) FILTER (WHERE ${timed}))::float8 AS "doorSeconds",
               COALESCE(SUM(o."deliveryFeeCents") FILTER (WHERE o."status" <> 'CANCELLED'), 0)::bigint AS "feeCents",
               COALESCE(SUM(o."totalCents") FILTER (WHERE d."status" = 'DELIVERED'), 0)::bigint AS "deliveredOrdersCents"
        FROM "deliveries" d
        JOIN "orders" o ON o."id" = d."orderId"
        ${where}`,
      this.prisma.$queryRaw<
        { courierId: string | null; courierName: string | null; total: number; delivered: number; failed: number; timedCount: number; routeSeconds: number | null }[]
      >`
        SELECT u."id" AS "courierId", u."name" AS "courierName", COUNT(*)::int AS "total",
               COUNT(*) FILTER (WHERE d."status" = 'DELIVERED')::int AS "delivered",
               COUNT(*) FILTER (WHERE d."status" = 'FAILED')::int AS "failed",
               COUNT(*) FILTER (WHERE ${timed})::int AS "timedCount",
               (SUM(EXTRACT(EPOCH FROM (d."deliveredAt" - d."dispatchedAt"))) FILTER (WHERE ${timed}))::float8 AS "routeSeconds"
        FROM "deliveries" d
        LEFT JOIN "users" u ON u."id" = d."courierUserId"
        ${where}
        GROUP BY u."id", u."name"
        ORDER BY "delivered" DESC, "total" DESC, u."name" ASC NULLS LAST
        LIMIT ${MAX_COURIER_ROWS}`,
      this.prisma.$queryRaw<{ day: string; total: number; delivered: number }[]>`
        SELECT to_char(${local}, 'YYYY-MM-DD') AS "day", COUNT(*)::int AS "total",
               COUNT(*) FILTER (WHERE d."status" = 'DELIVERED')::int AS "delivered"
        FROM "deliveries" d
        ${where}
        GROUP BY 1
        ORDER BY 1`,
    ]);

    const totals = totalsRows[0];
    return {
      ...this.header(scope),
      totals: {
        total: totals.total,
        pending: totals.pending,
        outForDelivery: totals.outForDelivery,
        delivered: totals.delivered,
        failed: totals.failed,
        cancelled: totals.cancelled,
        attempts: totals.attempts,
        // Deliveries that needed more than one dispatch.
        redelivered: totals.redelivered,
        // Of what was created in the period and is no longer waiting, how much arrived (basis points).
        successRateBps:
          totals.delivered + totals.failed + totals.cancelled > 0
            ? Math.round((totals.delivered * 10_000) / (totals.delivered + totals.failed + totals.cancelled))
            : null,
        // Dispatch -> delivered, and order placed -> delivered; null when nothing was delivered.
        averageRouteMinutes: averageMinutes(totals.routeSeconds, totals.timedCount),
        averageDoorMinutes: averageMinutes(totals.doorSeconds, totals.timedCount),
        feeCents: num(totals.feeCents),
        deliveredOrdersCents: num(totals.deliveredOrdersCents),
      },
      byCourier: courierRows.map((row) => ({
        // null = deliveries nobody was assigned to.
        courierId: row.courierId,
        courierName: row.courierName,
        total: row.total,
        delivered: row.delivered,
        failed: row.failed,
        averageRouteMinutes: averageMinutes(row.routeSeconds, row.timedCount),
      })),
      byDay: fillDays(scope.period, dayRows, (day) => ({ day, total: 0, delivered: 0 })),
    };
  }

  // ---- cash ----------------------------------------------------------------------------------

  // Cash sessions OPENED in the period, newest first, with what went through each drawer.
  async cash(user: AuthenticatedRequestUser, query: PagedReportQueryDto) {
    const scope = await this.scope(user, query);
    const { page, pageSize, offset } = paging(query);
    const where: Prisma.CashRegisterSessionWhereInput = {
      tenantId: scope.tenantId,
      openedAt: { gte: scope.period.fromInstant, lt: scope.period.toInstant },
      ...(scope.branchIds ? { branchId: { in: scope.branchIds } } : {}),
    };

    const [summaryRows, movementRows, sessions] = await Promise.all([
      this.prisma.$queryRaw<{ sessions: number; closed: number; shortageCents: Count; surplusCents: Count; withDifference: number }[]>`
        SELECT COUNT(*)::int AS "sessions",
               COUNT(*) FILTER (WHERE s."status" = 'CLOSED')::int AS "closed",
               COALESCE(SUM(s."differenceCents") FILTER (WHERE s."differenceCents" < 0), 0)::bigint AS "shortageCents",
               COALESCE(SUM(s."differenceCents") FILTER (WHERE s."differenceCents" > 0), 0)::bigint AS "surplusCents",
               COUNT(*) FILTER (WHERE s."differenceCents" <> 0)::int AS "withDifference"
        FROM "cash_register_sessions" s
        ${this.sessionsWhere(scope)}`,
      this.prisma.$queryRaw<{ type: CashMovementType; totalCents: Count }[]>`
        SELECT m."type" AS "type", COALESCE(SUM(m."amountCents"), 0)::bigint AS "totalCents"
        FROM "cash_movements" m
        JOIN "cash_register_sessions" s ON s."id" = m."sessionId"
        ${this.sessionsWhere(scope)}
        GROUP BY m."type"`,
      this.prisma.cashRegisterSession.findMany({
        where,
        // Newest first; the id breaks ties so pages never overlap.
        orderBy: [{ openedAt: 'desc' }, { id: 'desc' }],
        skip: offset,
        take: pageSize,
        select: {
          id: true,
          status: true,
          openingBalanceCents: true,
          expectedClosingBalanceCents: true,
          countedClosingBalanceCents: true,
          differenceCents: true,
          openedAt: true,
          closedAt: true,
          branch: { select: { id: true, name: true } },
          openedBy: { select: { id: true, name: true } },
          closedBy: { select: { id: true, name: true } },
        },
      }),
    ]);

    // Movements of the sessions on this page, grouped by the database in one query.
    const sessionIds = sessions.map((session) => session.id);
    const grouped = sessionIds.length
      ? await this.prisma.cashMovement.groupBy({
          by: ['sessionId', 'type'],
          where: { sessionId: { in: sessionIds }, tenantId: scope.tenantId },
          _sum: { amountCents: true },
        })
      : [];
    const totalsOf = (sessionId: string): CashTotals =>
      computeCashTotals(grouped.filter((row) => row.sessionId === sessionId).map((row) => ({ type: row.type, amountCents: row._sum.amountCents ?? 0 })));

    const summary = summaryRows[0];
    return {
      ...this.header(scope),
      totals: {
        sessions: summary.sessions,
        closed: summary.closed,
        open: summary.sessions - summary.closed,
        ...computeCashTotals(movementRows.map((row) => ({ type: row.type, amountCents: num(row.totalCents) }))),
        // Closed sessions only (an open one has no counted balance yet). Shortage is negative.
        shortageCents: num(summary.shortageCents),
        surplusCents: num(summary.surplusCents),
        sessionsWithDifference: summary.withDifference,
      },
      data: sessions.map((session) => {
        const totals = totalsOf(session.id);
        return {
          id: session.id,
          status: session.status,
          branch: session.branch,
          openedBy: session.openedBy,
          closedBy: session.closedBy,
          openedAt: session.openedAt,
          closedAt: session.closedAt,
          openingBalanceCents: session.openingBalanceCents,
          totals,
          // Stored when the session was closed; computed from its movements while it is open.
          expectedBalanceCents: session.expectedClosingBalanceCents ?? computeExpectedBalanceCents(session.openingBalanceCents, totals),
          countedClosingBalanceCents: session.countedClosingBalanceCents,
          differenceCents: session.differenceCents,
        };
      }),
      meta: meta(page, pageSize, summary.sessions),
    };
  }

  // ---- internals -----------------------------------------------------------------------------

  // Who is asking, for which days, over which branches. Everything a report filters by.
  private async scope(user: AuthenticatedRequestUser, query: ReportPeriodQueryDto): Promise<Scope> {
    const tenant = await this.prisma.tenant.findUnique({ where: { id: user.tenantId }, select: { timezone: true } });
    const timezone = tenant && isValidTimeZone(tenant.timezone) ? tenant.timezone : DEFAULT_TIME_ZONE;
    const period = resolvePeriod(query, todayInTimeZone(timezone), timezone);
    if (typeof period === 'string') {
      throw new BadRequestException({ code: `REPORT_${period}`, message: PERIOD_MESSAGE[period] });
    }
    if (query.branchId) {
      // 404 for a branch of another restaurant, 403 for one the caller is not linked to.
      await this.branchAccess.assertAccess(user, query.branchId);
      return { tenantId: user.tenantId, period, branchIds: [query.branchId], branchId: query.branchId };
    }
    return { tenantId: user.tenantId, period, branchIds: await this.branchAccess.accessibleBranchIds(user), branchId: null };
  }

  private header(scope: Scope) {
    const { from, to, timezone, days } = scope.period;
    return { period: { from, to, timezone, days }, branchId: scope.branchId };
  }

  private inBranches(scope: Scope, column: Prisma.Sql): Prisma.Sql {
    if (scope.branchIds === null) return Prisma.empty;
    if (scope.branchIds.length === 0) return Prisma.sql`AND FALSE`;
    return Prisma.sql`AND ${column} IN (${Prisma.join(scope.branchIds)})`;
  }

  // WHERE for orders created in the period, in scope (alias o).
  private ordersWhere(scope: Scope): Prisma.Sql {
    return Prisma.sql`
      WHERE o."tenantId" = ${scope.tenantId}
        AND o."createdAt" >= ${timestamp(scope.period.fromInstant)} AND o."createdAt" < ${timestamp(scope.period.toInstant)}
        ${this.inBranches(scope, Prisma.sql`o."branchId"`)}`;
  }

  private sessionsWhere(scope: Scope): Prisma.Sql {
    return Prisma.sql`
      WHERE s."tenantId" = ${scope.tenantId}
        AND s."openedAt" >= ${timestamp(scope.period.fromInstant)} AND s."openedAt" < ${timestamp(scope.period.toInstant)}
        ${this.inBranches(scope, Prisma.sql`s."branchId"`)}`;
  }
}

function paging(query: { page?: number; pageSize?: number }) {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? DEFAULT_PAGE_SIZE;
  return { page, pageSize, offset: (page - 1) * pageSize };
}

function meta(page: number, pageSize: number, total: number) {
  return { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) };
}
