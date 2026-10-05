-- Fase 11, fatia 4: loyalty points.
-- Additive only: four new tables and one enum. No existing table or row is touched.

-- CreateEnum
CREATE TYPE "LoyaltyEntryType" AS ENUM ('EARN', 'REDEEM', 'ADJUSTMENT', 'REVERSAL');

-- CreateTable
CREATE TABLE "loyalty_programs" (
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "pointsPerReal" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_programs_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "loyalty_rewards" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "pointsCost" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_rewards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "balancePoints" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "LoyaltyEntryType" NOT NULL,
    "points" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "orderId" TEXT,
    "rewardId" TEXT,
    "branchId" TEXT,
    "reversedEntryId" TEXT,
    "reason" TEXT,
    "idempotencyKey" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "loyalty_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "loyalty_rewards_tenantId_active_name_idx" ON "loyalty_rewards"("tenantId", "active", "name");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_accounts_customerId_key" ON "loyalty_accounts"("customerId");

-- CreateIndex
CREATE INDEX "loyalty_accounts_tenantId_idx" ON "loyalty_accounts"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_entries_reversedEntryId_key" ON "loyalty_entries"("reversedEntryId");

-- CreateIndex
CREATE INDEX "loyalty_entries_accountId_createdAt_idx" ON "loyalty_entries"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "loyalty_entries_tenantId_createdAt_idx" ON "loyalty_entries"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "loyalty_entries_orderId_idx" ON "loyalty_entries"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_entries_tenantId_idempotencyKey_key" ON "loyalty_entries"("tenantId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "loyalty_programs" ADD CONSTRAINT "loyalty_programs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_rewards" ADD CONSTRAINT "loyalty_rewards_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_accounts" ADD CONSTRAINT "loyalty_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_entries" ADD CONSTRAINT "loyalty_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_entries" ADD CONSTRAINT "loyalty_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "loyalty_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_entries" ADD CONSTRAINT "loyalty_entries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_entries" ADD CONSTRAINT "loyalty_entries_rewardId_fkey" FOREIGN KEY ("rewardId") REFERENCES "loyalty_rewards"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_entries" ADD CONSTRAINT "loyalty_entries_reversedEntryId_fkey" FOREIGN KEY ("reversedEntryId") REFERENCES "loyalty_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "loyalty_entries" ADD CONSTRAINT "loyalty_entries_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------
-- What schema.prisma cannot express
-- ---------------------------------------------------------------------------------------

-- An order earns points at most once, whatever the application does (the service checks
-- first; this is the barrier when two requests conclude/link the same order at once).
CREATE UNIQUE INDEX "loyalty_entries_orderId_earn_key"
  ON "loyalty_entries" ("orderId")
  WHERE "type" = 'EARN';

ALTER TABLE "loyalty_programs"
  ADD CONSTRAINT "loyalty_programs_points_per_real_range" CHECK ("pointsPerReal" BETWEEN 1 AND 1000);

ALTER TABLE "loyalty_rewards"
  ADD CONSTRAINT "loyalty_rewards_points_cost_range" CHECK ("pointsCost" BETWEEN 1 AND 1000000),
  ADD CONSTRAINT "loyalty_rewards_name_length" CHECK (char_length(btrim("name")) BETWEEN 2 AND 80),
  ADD CONSTRAINT "loyalty_rewards_description_length" CHECK ("description" IS NULL OR char_length("description") <= 200);

-- The balance can never go below zero, whoever writes it.
ALTER TABLE "loyalty_accounts"
  ADD CONSTRAINT "loyalty_accounts_balance_nonneg" CHECK ("balancePoints" >= 0);

ALTER TABLE "loyalty_entries"
  ADD CONSTRAINT "loyalty_entries_points_nonzero" CHECK ("points" <> 0),
  ADD CONSTRAINT "loyalty_entries_balance_nonneg" CHECK ("balanceAfter" >= 0),
  -- the sign is part of the meaning of the type
  ADD CONSTRAINT "loyalty_entries_sign_by_type" CHECK (
    ("type" = 'EARN' AND "points" > 0)
    OR ("type" = 'REDEEM' AND "points" < 0)
    OR "type" IN ('ADJUSTMENT', 'REVERSAL')
  ),
  -- every movement says where it came from
  ADD CONSTRAINT "loyalty_entries_reference_by_type" CHECK (
    ("type" = 'EARN' AND "orderId" IS NOT NULL AND "rewardId" IS NULL AND "reversedEntryId" IS NULL)
    OR ("type" = 'REDEEM' AND "rewardId" IS NOT NULL AND "orderId" IS NULL AND "reversedEntryId" IS NULL)
    OR ("type" = 'ADJUSTMENT' AND "orderId" IS NULL AND "rewardId" IS NULL AND "reversedEntryId" IS NULL)
    OR ("type" = 'REVERSAL' AND "reversedEntryId" IS NOT NULL)
  ),
  -- a manual correction or a reversal always says why
  ADD CONSTRAINT "loyalty_entries_reason_required" CHECK (
    "type" NOT IN ('ADJUSTMENT', 'REVERSAL') OR char_length(btrim(coalesce("reason", ''))) >= 3
  ),
  ADD CONSTRAINT "loyalty_entries_reason_length" CHECK ("reason" IS NULL OR char_length("reason") <= 200);

-- The ledger is append-only: a mistake is corrected by a REVERSAL entry, never by editing or
-- removing history (same rule as cash_movements).
CREATE OR REPLACE FUNCTION loyalty_entries_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'loyalty_entries is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER loyalty_entries_no_update_delete
  BEFORE UPDATE OR DELETE ON "loyalty_entries"
  FOR EACH ROW EXECUTE FUNCTION loyalty_entries_immutable();
