-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('INTERNAL');

-- AlterEnum
ALTER TYPE "FulfillmentType" ADD VALUE 'DINE_IN';

-- AlterEnum
ALTER TYPE "OrderSource" ADD VALUE 'TABLE';

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "idempotencyKey" TEXT,
ADD COLUMN     "tabId" TEXT;

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL,
    "provider" "PaymentProvider" NOT NULL DEFAULT 'INTERNAL',
    "amountCents" INTEGER NOT NULL,
    "externalId" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_orderId_key" ON "payments"("orderId");

-- CreateIndex
CREATE INDEX "payments_tenantId_createdAt_idx" ON "payments"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tabId_key" ON "orders"("tabId");

-- CreateIndex
CREATE UNIQUE INDEX "orders_tenantId_idempotencyKey_key" ON "orders"("tenantId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_tabId_fkey" FOREIGN KEY ("tabId") REFERENCES "tabs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

