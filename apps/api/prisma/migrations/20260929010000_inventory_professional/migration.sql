CREATE TYPE "StockMovementOrigin" AS ENUM ('PURCHASE', 'MANUAL', 'ORDER', 'INVENTORY', 'REVERSAL');

CREATE TYPE "StockExitReason" AS ENUM ('CONSUMPTION', 'LOSS', 'DAMAGE', 'ADJUSTMENT', 'OTHER');

ALTER TYPE "StockMovementType" RENAME VALUE 'SALE_REVERSAL' TO 'REVERSAL';

ALTER TYPE "StockReferenceType" ADD VALUE 'INVENTORY_COUNT';

ALTER TABLE "inventory_items" ADD COLUMN "maxStock" DECIMAL(14,3),
ADD COLUMN "notes" TEXT,
ADD COLUMN "tracksExpiry" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "product_recipe_items" ADD COLUMN "inputUnit" "InventoryUnit";
UPDATE "product_recipe_items" pri
SET "inputUnit" = ii."unit"
FROM "inventory_items" ii
WHERE ii."id" = pri."inventoryItemId";
ALTER TABLE "product_recipe_items" ALTER COLUMN "inputUnit" SET NOT NULL;

ALTER TABLE "stock_movements" RENAME COLUMN "reason" TO "notes";
ALTER TABLE "stock_movements" ADD COLUMN "documentNumber" TEXT,
ADD COLUMN "exitReason" "StockExitReason",
ADD COLUMN "expiresAt" DATE,
ADD COLUMN "lotCode" TEXT,
ADD COLUMN "origin" "StockMovementOrigin",
ADD COLUMN "supplierName" TEXT;

ALTER TABLE "stock_movements" DISABLE TRIGGER "stock_movements_no_update_delete";
UPDATE "stock_movements" SET "origin" = CASE "type"
  WHEN 'SALE' THEN 'ORDER'::"StockMovementOrigin"
  WHEN 'REVERSAL' THEN 'REVERSAL'::"StockMovementOrigin"
  WHEN 'ADJUSTMENT' THEN 'INVENTORY'::"StockMovementOrigin"
  ELSE 'MANUAL'::"StockMovementOrigin"
END;
UPDATE "stock_movements" SET "exitReason" = 'OTHER' WHERE "type" = 'EXIT';
ALTER TABLE "stock_movements" ENABLE TRIGGER "stock_movements_no_update_delete";
ALTER TABLE "stock_movements" ALTER COLUMN "origin" SET NOT NULL;

CREATE TABLE "inventory_counts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_counts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "inventory_count_items" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "systemQuantity" DECIMAL(14,3) NOT NULL,
    "countedQuantity" DECIMAL(14,3) NOT NULL,
    "difference" DECIMAL(14,3) NOT NULL,
    "stockMovementId" TEXT,

    CONSTRAINT "inventory_count_items_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "inventory_counts_tenantId_branchId_createdAt_idx" ON "inventory_counts"("tenantId", "branchId", "createdAt");

CREATE UNIQUE INDEX "inventory_count_items_stockMovementId_key" ON "inventory_count_items"("stockMovementId");

CREATE UNIQUE INDEX "inventory_count_items_countId_inventoryItemId_key" ON "inventory_count_items"("countId", "inventoryItemId");

CREATE INDEX "stock_movements_branchId_inventoryItemId_expiresAt_idx" ON "stock_movements"("branchId", "inventoryItemId", "expiresAt");

ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_counts" ADD CONSTRAINT "inventory_counts_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_countId_fkey" FOREIGN KEY ("countId") REFERENCES "inventory_counts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_inventoryItemId_fkey" FOREIGN KEY ("inventoryItemId") REFERENCES "inventory_items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "inventory_count_items" ADD CONSTRAINT "inventory_count_items_stockMovementId_fkey" FOREIGN KEY ("stockMovementId") REFERENCES "stock_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
