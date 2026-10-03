-- Fase 11 (CRM), slice 2: coupons and discounts.
-- Additive only: two new tables, one new enum and three columns on "orders"
-- (discountCents DEFAULT 0, couponId NULL, couponCode NULL). No existing row is rewritten.
-- Every existing order satisfies the new "orders" CHECKs: totalCents = subtotalCents +
-- deliveryFeeCents with discountCents = 0 (verified on the DEV database before writing this).
-- Deploy note: adding the three "orders" CHECKs validates every existing "orders" row (a short scan under
-- an ACCESS EXCLUSIVE lock on that table).

-- CreateEnum
CREATE TYPE "CouponDiscountType" AS ENUM ('PERCENTAGE', 'FIXED');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "couponCode" TEXT,
ADD COLUMN     "couponId" TEXT,
ADD COLUMN     "discountCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "coupons" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT,
    "code" TEXT NOT NULL,
    "description" TEXT,
    "discountType" "CouponDiscountType" NOT NULL,
    "value" INTEGER NOT NULL,
    "minOrderCents" INTEGER NOT NULL DEFAULT 0,
    "maxDiscountCents" INTEGER,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "usageLimit" INTEGER,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "perCustomerLimit" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "coupons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "coupon_redemptions" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "couponId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "customerId" TEXT,
    "discountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "coupon_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "coupons_tenantId_active_createdAt_idx" ON "coupons"("tenantId", "active", "createdAt");

-- CreateIndex
CREATE INDEX "coupons_tenantId_code_idx" ON "coupons"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "coupon_redemptions_orderId_key" ON "coupon_redemptions"("orderId");

-- CreateIndex
CREATE INDEX "coupon_redemptions_couponId_customerId_idx" ON "coupon_redemptions"("couponId", "customerId");

-- CreateIndex
CREATE INDEX "coupon_redemptions_tenantId_createdAt_idx" ON "coupon_redemptions"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "orders_couponId_idx" ON "orders"("couponId");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupons" ADD CONSTRAINT "coupons_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "coupons"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "coupon_redemptions" ADD CONSTRAINT "coupon_redemptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------
-- What schema.prisma cannot express
-- ---------------------------------------------------------------------------------------

-- Never two ACTIVE coupons with the same code in a tenant. The code is stored canonical
-- (upper case, see coupons_code_canonical below), so a plain column index compares exactly
-- what the application compares. An INACTIVE coupon does not take part, so PROMO10 can be
-- deactivated and created again; reactivating an old one while another is active conflicts.
CREATE UNIQUE INDEX "coupons_tenantId_code_active_key"
  ON "coupons" ("tenantId", "code")
  WHERE "active" = true;

-- The database refuses any shape the domain rules would refuse (defence in depth).
ALTER TABLE "coupons"
  ADD CONSTRAINT "coupons_code_canonical" CHECK ("code" ~ '^[A-Z0-9_-]{3,32}$'),
  ADD CONSTRAINT "coupons_value_range" CHECK (
    ("discountType" = 'PERCENTAGE' AND "value" BETWEEN 1 AND 100)
    OR ("discountType" = 'FIXED' AND "value" >= 1)
  ),
  ADD CONSTRAINT "coupons_min_order_nonneg" CHECK ("minOrderCents" >= 0),
  ADD CONSTRAINT "coupons_max_discount_percentage_only" CHECK (
    "maxDiscountCents" IS NULL OR ("discountType" = 'PERCENTAGE' AND "maxDiscountCents" >= 1)
  ),
  ADD CONSTRAINT "coupons_window_order" CHECK (
    "startsAt" IS NULL OR "endsAt" IS NULL OR "endsAt" > "startsAt"
  ),
  ADD CONSTRAINT "coupons_usage_limit_positive" CHECK ("usageLimit" IS NULL OR "usageLimit" >= 1),
  ADD CONSTRAINT "coupons_per_customer_limit_positive" CHECK ("perCustomerLimit" IS NULL OR "perCustomerLimit" >= 1),
  -- the last barrier against over-use, independent of the application's locking
  ADD CONSTRAINT "coupons_usage_within_limit" CHECK (
    "usageCount" >= 0 AND ("usageLimit" IS NULL OR "usageCount" <= "usageLimit")
  ),
  ADD CONSTRAINT "coupons_description_length" CHECK ("description" IS NULL OR char_length("description") <= 200);

ALTER TABLE "coupon_redemptions"
  ADD CONSTRAINT "coupon_redemptions_discount_positive" CHECK ("discountCents" >= 1);

-- The order's money always adds up, whoever writes it.
ALTER TABLE "orders"
  ADD CONSTRAINT "orders_discount_range" CHECK ("discountCents" >= 0 AND "discountCents" <= "subtotalCents"),
  ADD CONSTRAINT "orders_total_formula" CHECK (
    "totalCents" = "subtotalCents" - "discountCents" + "deliveryFeeCents"
  ),
  ADD CONSTRAINT "orders_coupon_code_with_discount" CHECK ("discountCents" = 0 OR "couponCode" IS NOT NULL);
