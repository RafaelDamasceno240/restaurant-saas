-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED');

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "deliveryEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "deliveryMinOrderCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "deliveryFeeCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "deliveries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "dispatchedAt" TIMESTAMP(3),
    "dispatchedByUserId" TEXT,
    "deliveredAt" TIMESTAMP(3),
    "completedByUserId" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deliveries_orderId_key" ON "deliveries"("orderId");

-- CreateIndex
CREATE INDEX "deliveries_tenantId_branchId_status_idx" ON "deliveries"("tenantId", "branchId", "status");

-- CreateIndex
CREATE INDEX "deliveries_tenantId_createdAt_idx" ON "deliveries"("tenantId", "createdAt");

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_dispatchedByUserId_fkey" FOREIGN KEY ("dispatchedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_completedByUserId_fkey" FOREIGN KEY ("completedByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Money can never be negative (integer cents).
ALTER TABLE "branches"
  ADD CONSTRAINT "branches_delivery_settings_non_negative"
  CHECK ("deliveryFeeCents" >= 0 AND "deliveryMinOrderCents" >= 0);

ALTER TABLE "orders"
  ADD CONSTRAINT "orders_delivery_fee_non_negative"
  CHECK ("deliveryFeeCents" >= 0);

-- Backfill: every pre-existing DELIVERY order gets its operational record so the
-- new rule "a DELIVERY order always has a delivery" also holds for old data.
-- Status is derived from the order; dispatch/delivery timestamps and actors are
-- unknown for historical rows and are deliberately left NULL (nothing invented).
-- Orders created before this migration have deliveryFeeCents = 0 (no fee existed).
INSERT INTO "deliveries" ("id", "tenantId", "branchId", "orderId", "status", "createdAt", "updatedAt")
SELECT
  gen_random_uuid()::text,
  o."tenantId",
  o."branchId",
  o."id",
  CASE
    WHEN o."status" = 'CANCELLED' THEN 'CANCELLED'
    WHEN o."status" IN ('COMPLETED', 'DELIVERED') THEN 'DELIVERED'
    WHEN o."status" = 'OUT_FOR_DELIVERY' THEN 'OUT_FOR_DELIVERY'
    ELSE 'PENDING'
  END::"DeliveryStatus",
  o."createdAt",
  o."updatedAt"
FROM "orders" o
WHERE o."fulfillmentType" = 'DELIVERY';
