-- Fase 11, fatia 5: cashback.
-- Additive: three new tables, one enum and ONE column on "orders" (cashbackUsedCents DEFAULT 0).
-- No existing row is rewritten. The CHECK orders_total_formula is replaced at the end of this
-- file to include the new column.

-- CreateEnum
CREATE TYPE "CashbackEntryType" AS ENUM ('EARN', 'USE', 'ADJUSTMENT', 'REVERSAL', 'EXPIRATION');

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "cashbackUsedCents" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "cashback_programs" (
    "tenantId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "earnRateBps" INTEGER NOT NULL DEFAULT 500,
    "expireAfterDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cashback_programs_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "cashback_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "lastActivityAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cashback_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cashback_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "CashbackEntryType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "balanceAfterCents" INTEGER NOT NULL,
    "orderId" TEXT,
    "branchId" TEXT,
    "reversedEntryId" TEXT,
    "reason" TEXT,
    "idempotencyKey" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cashback_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cashback_accounts_customerId_key" ON "cashback_accounts"("customerId");

-- CreateIndex
CREATE INDEX "cashback_accounts_tenantId_idx" ON "cashback_accounts"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "cashback_entries_reversedEntryId_key" ON "cashback_entries"("reversedEntryId");

-- CreateIndex
CREATE INDEX "cashback_entries_accountId_createdAt_idx" ON "cashback_entries"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "cashback_entries_tenantId_createdAt_idx" ON "cashback_entries"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "cashback_entries_orderId_idx" ON "cashback_entries"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "cashback_entries_tenantId_idempotencyKey_key" ON "cashback_entries"("tenantId", "idempotencyKey");

-- AddForeignKey
ALTER TABLE "cashback_programs" ADD CONSTRAINT "cashback_programs_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashback_accounts" ADD CONSTRAINT "cashback_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashback_accounts" ADD CONSTRAINT "cashback_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashback_entries" ADD CONSTRAINT "cashback_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashback_entries" ADD CONSTRAINT "cashback_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "cashback_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashback_entries" ADD CONSTRAINT "cashback_entries_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashback_entries" ADD CONSTRAINT "cashback_entries_reversedEntryId_fkey" FOREIGN KEY ("reversedEntryId") REFERENCES "cashback_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cashback_entries" ADD CONSTRAINT "cashback_entries_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------
-- What schema.prisma cannot express
-- ---------------------------------------------------------------------------------------

-- An order earns cashback at most once and spends cashback at most once, whatever the
-- application does.
CREATE UNIQUE INDEX "cashback_entries_orderId_earn_key"
  ON "cashback_entries" ("orderId")
  WHERE "type" = 'EARN';

CREATE UNIQUE INDEX "cashback_entries_orderId_use_key"
  ON "cashback_entries" ("orderId")
  WHERE "type" = 'USE';

ALTER TABLE "cashback_programs"
  ADD CONSTRAINT "cashback_programs_earn_rate_range" CHECK ("earnRateBps" BETWEEN 1 AND 5000),
  ADD CONSTRAINT "cashback_programs_expiration_range" CHECK ("expireAfterDays" IS NULL OR "expireAfterDays" BETWEEN 1 AND 3650);

-- The balance can never go below zero, whoever writes it.
ALTER TABLE "cashback_accounts"
  ADD CONSTRAINT "cashback_accounts_balance_nonneg" CHECK ("balanceCents" >= 0);

ALTER TABLE "cashback_entries"
  ADD CONSTRAINT "cashback_entries_amount_nonzero" CHECK ("amountCents" <> 0),
  ADD CONSTRAINT "cashback_entries_balance_nonneg" CHECK ("balanceAfterCents" >= 0),
  -- the sign is part of the meaning of the type
  ADD CONSTRAINT "cashback_entries_sign_by_type" CHECK (
    ("type" = 'EARN' AND "amountCents" > 0)
    OR ("type" IN ('USE', 'EXPIRATION') AND "amountCents" < 0)
    OR "type" IN ('ADJUSTMENT', 'REVERSAL')
  ),
  -- every movement says where it came from
  ADD CONSTRAINT "cashback_entries_reference_by_type" CHECK (
    ("type" IN ('EARN', 'USE') AND "orderId" IS NOT NULL AND "reversedEntryId" IS NULL)
    OR ("type" IN ('ADJUSTMENT', 'EXPIRATION') AND "orderId" IS NULL AND "reversedEntryId" IS NULL)
    OR ("type" = 'REVERSAL' AND "reversedEntryId" IS NOT NULL)
  ),
  -- a manual correction or a reversal always says why
  ADD CONSTRAINT "cashback_entries_reason_required" CHECK (
    "type" NOT IN ('ADJUSTMENT', 'REVERSAL') OR char_length(btrim(coalesce("reason", ''))) >= 3
  ),
  ADD CONSTRAINT "cashback_entries_reason_length" CHECK ("reason" IS NULL OR char_length("reason") <= 200);

-- The ledger is append-only: a mistake is corrected by another entry, never by editing or
-- removing history (same rule as cash_movements and loyalty_entries).
CREATE OR REPLACE FUNCTION cashback_entries_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'cashback_entries is append-only (% not allowed)', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER cashback_entries_no_update_delete
  BEFORE UPDATE OR DELETE ON "cashback_entries"
  FOR EACH ROW EXECUTE FUNCTION cashback_entries_immutable();

-- The order's money still adds up, now with the cashback it spent. Every existing row has
-- cashbackUsedCents = 0 and already satisfies the previous formula (it was a CHECK), so the new
-- one holds for all of them; replacing the constraint re-validates the table under a short
-- ACCESS EXCLUSIVE lock, in this same statement.
ALTER TABLE "orders"
  DROP CONSTRAINT "orders_total_formula",
  ADD CONSTRAINT "orders_total_formula" CHECK (
    "totalCents" = "subtotalCents" - "discountCents" - "cashbackUsedCents" + "deliveryFeeCents"
  ),
  ADD CONSTRAINT "orders_cashback_range" CHECK (
    "cashbackUsedCents" >= 0 AND "cashbackUsedCents" <= "subtotalCents" - "discountCents"
  );
