-- Cancelling an order that was paid in cash gives the money back from the drawer: a
-- SALE_REFUND movement in the open cash session of the order's branch, written in the same
-- transaction as the cancellation (OrdersService.updateStatus).
--
-- Additive only: one enum value, one nullable column, its unique index, its foreign key and
-- one CHECK. No existing row changes; every existing movement has "refundedOrderId" NULL and
-- a type other than SALE_REFUND, so the CHECK holds for all of them.

-- AlterEnum
ALTER TYPE "CashMovementType" ADD VALUE 'SALE_REFUND';

-- AlterTable
ALTER TABLE "cash_movements" ADD COLUMN "refundedOrderId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "cash_movements_refundedOrderId_key" ON "cash_movements"("refundedOrderId");

-- AddForeignKey
ALTER TABLE "cash_movements" ADD CONSTRAINT "cash_movements_refundedOrderId_fkey" FOREIGN KEY ("refundedOrderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A refund always names the order it gives back, and nothing else does. The type is compared
-- as text because a value added to an enum cannot be used in the transaction that adds it.
ALTER TABLE "cash_movements"
  ADD CONSTRAINT "cash_movements_refund_names_order" CHECK (("type"::text = 'SALE_REFUND') = ("refundedOrderId" IS NOT NULL));
