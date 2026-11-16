-- B9 (piloto 2026-10-23): tables become a real kitchen flow. A waiter sends ROUNDS of items to
-- the kitchen; each item has its own status; the recipes are consumed when the round is sent
-- (StockMovement referenceType TAB_ITEM); cancelled units are recorded one cancellation at a time
-- (tab_item_cancellations) and, when their ingredients go back, reversed against that row
-- (referenceType TAB_ITEM_CANCELLATION). The checkout bills quantity - cancelledQuantity of each
-- item, once (order_items.tabItemId UNIQUE), and consumes nothing more.
--
-- Existing rows: every tab item that exists before this migration was launched by the old flow,
-- never went to the kitchen and has consumed nothing. It becomes a legacy item: no round,
-- status SERVED (the food is taken as already at the table), nothing cancelled. A CLOSED tab
-- keeps it as history; an OPEN tab can still be checked out, and the checkout consumes the
-- recipes of its legacy items then (TabsService). Nothing else changes for existing rows: the new
-- columns are NULL or 0 and order_items.tabItemId is NULL.

-- CreateEnum
CREATE TYPE "TabItemStatus" AS ENUM ('SENT', 'PREPARING', 'READY', 'SERVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TabItemStockOutcome" AS ENUM ('RETURNED', 'WASTED', 'NONE');

-- AlterEnum (PostgreSQL 12+ accepts both in one transaction; neither value is used below)
ALTER TYPE "StockReferenceType" ADD VALUE 'TAB_ITEM';
ALTER TYPE "StockReferenceType" ADD VALUE 'TAB_ITEM_CANCELLATION';

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "tabItemId" TEXT;

-- AlterTable. "status" is added with DEFAULT 'SERVED' so every existing item becomes a legacy
-- item in the same statement; the default of NEW items is SENT, set right after.
ALTER TABLE "tab_items" ADD COLUMN     "cancelledAt" TIMESTAMP(3),
ADD COLUMN     "cancelledQuantity" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "preparingAt" TIMESTAMP(3),
ADD COLUMN     "readyAt" TIMESTAMP(3),
ADD COLUMN     "roundId" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "sentByUserId" TEXT,
ADD COLUMN     "servedAt" TIMESTAMP(3),
ADD COLUMN     "status" "TabItemStatus" NOT NULL DEFAULT 'SERVED';
ALTER TABLE "tab_items" ALTER COLUMN "status" SET DEFAULT 'SENT';

-- CreateTable
CREATE TABLE "tab_rounds" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tabId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "sentByUserId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tab_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tab_item_cancellations" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tabItemId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "statusAtCancel" "TabItemStatus" NOT NULL,
    "stockOutcome" "TabItemStockOutcome" NOT NULL,
    "cancelledByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tab_item_cancellations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tab_rounds_tenantId_branchId_sentAt_idx" ON "tab_rounds"("tenantId", "branchId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "tab_rounds_tabId_number_key" ON "tab_rounds"("tabId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "tab_rounds_tabId_idempotencyKey_key" ON "tab_rounds"("tabId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "tab_item_cancellations_tabItemId_idx" ON "tab_item_cancellations"("tabItemId");

-- CreateIndex
CREATE INDEX "tab_item_cancellations_tenantId_createdAt_idx" ON "tab_item_cancellations"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "order_items_tabItemId_key" ON "order_items"("tabItemId");

-- CreateIndex
CREATE INDEX "tab_items_roundId_idx" ON "tab_items"("roundId");

-- The kitchen board reads only the items still in production. Partial, so it stays small however
-- long the history grows (Prisma cannot express it; same as the other partial indexes).
CREATE INDEX "tab_items_kitchen_active_idx" ON "tab_items"("roundId")
  WHERE "status" IN ('SENT', 'PREPARING', 'READY');

-- AddForeignKey
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_tabItemId_fkey" FOREIGN KEY ("tabItemId") REFERENCES "tab_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tab_rounds" ADD CONSTRAINT "tab_rounds_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tab_rounds" ADD CONSTRAINT "tab_rounds_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tab_rounds" ADD CONSTRAINT "tab_rounds_tabId_fkey" FOREIGN KEY ("tabId") REFERENCES "tabs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tab_rounds" ADD CONSTRAINT "tab_rounds_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tab_items" ADD CONSTRAINT "tab_items_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "tab_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tab_items" ADD CONSTRAINT "tab_items_sentByUserId_fkey" FOREIGN KEY ("sentByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tab_item_cancellations" ADD CONSTRAINT "tab_item_cancellations_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tab_item_cancellations" ADD CONSTRAINT "tab_item_cancellations_tabItemId_fkey" FOREIGN KEY ("tabItemId") REFERENCES "tab_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tab_item_cancellations" ADD CONSTRAINT "tab_item_cancellations_cancelledByUserId_fkey" FOREIGN KEY ("cancelledByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Rules the database itself keeps (the service checks them too).
-- A round is numbered from 1.
ALTER TABLE "tab_rounds"
  ADD CONSTRAINT "tab_rounds_number_positive" CHECK ("number" >= 1);

-- An item has at least one unit, and no more units cancelled than it has.
ALTER TABLE "tab_items"
  ADD CONSTRAINT "tab_items_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "tab_items_cancelled_quantity_range" CHECK ("cancelledQuantity" >= 0 AND "cancelledQuantity" <= "quantity");

-- CANCELLED means exactly "every unit cancelled", in both directions.
ALTER TABLE "tab_items"
  ADD CONSTRAINT "tab_items_cancelled_status" CHECK (("status" = 'CANCELLED') = ("cancelledQuantity" = "quantity"));

-- A sent item names its round, when and by whom; a legacy item (no round) has none of the three
-- and was never in production: only SERVED or CANCELLED.
ALTER TABLE "tab_items"
  ADD CONSTRAINT "tab_items_round_sent" CHECK (
    ("roundId" IS NULL) = ("sentAt" IS NULL) AND ("roundId" IS NULL) = ("sentByUserId" IS NULL)
  ),
  ADD CONSTRAINT "tab_items_legacy_status" CHECK ("roundId" IS NOT NULL OR "status" IN ('SERVED', 'CANCELLED'));

-- A cancellation takes at least one unit and says why (3 to 300 characters, like the order
-- cancellation of B5). It happens to units still alive (never to CANCELLED ones), and units
-- already delivered to the table can only be lost or have consumed nothing - never returned.
ALTER TABLE "tab_item_cancellations"
  ADD CONSTRAINT "tab_item_cancellations_quantity_positive" CHECK ("quantity" > 0),
  ADD CONSTRAINT "tab_item_cancellations_reason_length" CHECK (char_length(btrim("reason")) BETWEEN 3 AND 300),
  ADD CONSTRAINT "tab_item_cancellations_status_alive" CHECK ("statusAtCancel" <> 'CANCELLED'),
  ADD CONSTRAINT "tab_item_cancellations_served_not_returned" CHECK (NOT ("statusAtCancel" = 'SERVED' AND "stockOutcome" = 'RETURNED'));
