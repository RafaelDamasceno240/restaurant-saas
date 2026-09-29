-- CreateEnum
CREATE TYPE "TabStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateTable
CREATE TABLE "dining_tables" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "name" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dining_tables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tabs" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "tableId" TEXT NOT NULL,
    "status" "TabStatus" NOT NULL DEFAULT 'OPEN',
    "customerName" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tabs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tab_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "tabId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "productNameSnapshot" TEXT NOT NULL,
    "unitPriceCentsSnapshot" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tab_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dining_tables_tenantId_idx" ON "dining_tables"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "dining_tables_branchId_number_key" ON "dining_tables"("branchId", "number");

-- CreateIndex
CREATE INDEX "tabs_tenantId_branchId_status_idx" ON "tabs"("tenantId", "branchId", "status");

-- CreateIndex
CREATE INDEX "tabs_tableId_status_idx" ON "tabs"("tableId", "status");

-- CreateIndex
CREATE INDEX "tab_items_tabId_idx" ON "tab_items"("tabId");

-- CreateIndex
CREATE INDEX "tab_items_productId_idx" ON "tab_items"("productId");

-- AddForeignKey
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dining_tables" ADD CONSTRAINT "dining_tables_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tabs" ADD CONSTRAINT "tabs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tabs" ADD CONSTRAINT "tabs_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tabs" ADD CONSTRAINT "tabs_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "dining_tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tab_items" ADD CONSTRAINT "tab_items_tabId_fkey" FOREIGN KEY ("tabId") REFERENCES "tabs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tab_items" ADD CONSTRAINT "tab_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
