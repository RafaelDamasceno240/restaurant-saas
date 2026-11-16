import { INestApplication } from '@nestjs/common';
import { getPrisma } from './test-app.util';

// Fiado is no longer sold (remocao-fiado, 2026-11-12): no route of the API opens a debt any more.
// The suites still need debts to exist, because the ones created before the change must keep
// being listed, received, reversed, cancelled and reported. This helper writes them straight to
// the DISPOSABLE test database, with exactly the rows the removed code wrote (receivable +
// installments + CHARGE entry + account balance + audit, in one transaction, under the same
// account lock). It is test code only: nothing in src/ can create a debt.

export interface LegacyReceivableInput {
  tenantId: string;
  branchId: string;
  customerId: string;
  totalCents: number;
  installments?: number;
  // 'YYYY-MM-DD'; the next installments fall on the same day of the following months.
  firstDueDate: string;
  description?: string;
  orderId?: string | null;
  createdByUserId?: string;
}

function addMonthsClamped(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, last));
  return target.toISOString().slice(0, 10);
}

// Equal parts in whole cents, the leftover cents on the first installments (as the old plan did).
function plan(totalCents: number, count: number, firstDueDate: string) {
  const base = Math.floor(totalCents / count);
  const remainder = totalCents - base * count;
  return Array.from({ length: count }, (_, index) => ({
    number: index + 1,
    dueDate: addMonthsClamped(firstDueDate, index),
    amountCents: base + (index < remainder ? 1 : 0),
  }));
}

export async function seedLegacyReceivableE2E(
  app: INestApplication,
  input: LegacyReceivableInput,
): Promise<string> {
  const prisma = getPrisma(app);
  const createdByUserId =
    input.createdByUserId ??
    (
      await prisma.user.findFirstOrThrow({
        where: { tenantId: input.tenantId },
        orderBy: { createdAt: 'asc' },
      })
    ).id;
  const installments = plan(input.totalCents, input.installments ?? 1, input.firstDueDate);

  return prisma.$transaction(async (tx) => {
    await tx.creditAccount.createMany({
      data: [{ tenantId: input.tenantId, customerId: input.customerId }],
      skipDuplicates: true,
    });
    const [account] = await tx.$queryRaw<{ id: string; balanceCents: number }[]>`
      SELECT "id", "balanceCents" FROM "credit_accounts"
       WHERE "customerId" = ${input.customerId} AND "tenantId" = ${input.tenantId}
         FOR UPDATE`;
    const receivable = await tx.receivable.create({
      data: {
        tenantId: input.tenantId,
        branchId: input.branchId,
        customerId: input.customerId,
        accountId: account.id,
        orderId: input.orderId ?? null,
        description: input.description ?? 'Saldo anterior do caderno',
        totalCents: input.totalCents,
        createdByUserId,
        installments: {
          create: installments.map((item) => ({
            tenantId: input.tenantId,
            number: item.number,
            dueDate: new Date(`${item.dueDate}T00:00:00.000Z`),
            amountCents: item.amountCents,
          })),
        },
      },
    });
    const balanceAfterCents = account.balanceCents + input.totalCents;
    await tx.receivableEntry.create({
      data: {
        tenantId: input.tenantId,
        accountId: account.id,
        customerId: input.customerId,
        receivableId: receivable.id,
        type: 'CHARGE',
        amountCents: input.totalCents,
        balanceAfterCents,
        branchId: input.branchId,
        createdByUserId,
      },
    });
    await tx.creditAccount.update({
      where: { id: account.id },
      data: { balanceCents: balanceAfterCents },
    });
    await tx.auditLog.create({
      data: {
        tenantId: input.tenantId,
        userId: createdByUserId,
        action: 'RECEIVABLE_CREATED',
        entity: 'Receivable',
        entityId: receivable.id,
        afterData: {
          legacyFixture: true,
          customerId: input.customerId,
          totalCents: input.totalCents,
        },
      },
    });
    return receivable.id;
  });
}

// A sale made "on account" before the change: an order created through the PDV today (paid by
// PIX, which touches no drawer and writes no payment row), then turned into what a fiado sale
// was - paymentMethod ON_ACCOUNT, the customer linked, and its receivable for the order total.
export async function makeLegacyFiadoSaleE2E(
  app: INestApplication,
  input: { orderId: string; customerId: string; installments?: number; firstDueDate: string },
): Promise<{ receivableId: string; totalCents: number }> {
  const prisma = getPrisma(app);
  const order = await prisma.order.update({
    where: { id: input.orderId },
    data: { paymentMethod: 'ON_ACCOUNT', customerId: input.customerId },
  });
  const receivableId = await seedLegacyReceivableE2E(app, {
    tenantId: order.tenantId,
    branchId: order.branchId,
    customerId: input.customerId,
    totalCents: order.totalCents,
    installments: input.installments,
    firstDueDate: input.firstDueDate,
    description: `Pedido ${order.orderNumber}`,
    orderId: order.id,
  });
  return { receivableId, totalCents: order.totalCents };
}
