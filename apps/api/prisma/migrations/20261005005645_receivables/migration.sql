-- Fase 11, fatia 6: fiado / contas a receber.
-- Additive: five new tables, two new enums, three new enum VALUES (PaymentMethod.ON_ACCOUNT,
-- CashMovementType.RECEIVABLE_PAYMENT / RECEIVABLE_REFUND) and ONE column on "tenants"
-- (timezone, DEFAULT America/Sao_Paulo). No existing row is rewritten. Needs PostgreSQL 12+
-- (enum values added inside the migration transaction).

-- CreateEnum
CREATE TYPE "ReceivableStatus" AS ENUM ('OPEN', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ReceivableEntryType" AS ENUM ('CHARGE', 'PAYMENT', 'REVERSAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CashMovementType" ADD VALUE 'RECEIVABLE_PAYMENT';
ALTER TYPE "CashMovementType" ADD VALUE 'RECEIVABLE_REFUND';

-- AlterEnum
ALTER TYPE "PaymentMethod" ADD VALUE 'ON_ACCOUNT';

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'America/Sao_Paulo';

-- CreateTable
CREATE TABLE "credit_accounts" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "creditLimitCents" INTEGER NOT NULL DEFAULT 0,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivables" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "orderId" TEXT,
    "description" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL,
    "paidCents" INTEGER NOT NULL DEFAULT 0,
    "status" "ReceivableStatus" NOT NULL DEFAULT 'OPEN',
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "settledAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,

    CONSTRAINT "receivables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivable_installments" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "paidCents" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "receivable_installments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivable_entries" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "receivableId" TEXT NOT NULL,
    "type" "ReceivableEntryType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "balanceAfterCents" INTEGER NOT NULL,
    "paymentMethod" "PaymentMethod",
    "branchId" TEXT,
    "cashMovementId" TEXT,
    "reversedEntryId" TEXT,
    "reason" TEXT,
    "idempotencyKey" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "receivable_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "receivable_payment_allocations" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "installmentId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,

    CONSTRAINT "receivable_payment_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "credit_accounts_customerId_key" ON "credit_accounts"("customerId");

-- CreateIndex
CREATE INDEX "credit_accounts_tenantId_idx" ON "credit_accounts"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "receivables_orderId_key" ON "receivables"("orderId");

-- CreateIndex
CREATE INDEX "receivables_tenantId_status_createdAt_idx" ON "receivables"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "receivables_tenantId_customerId_status_idx" ON "receivables"("tenantId", "customerId", "status");

-- CreateIndex
CREATE INDEX "receivables_tenantId_branchId_status_idx" ON "receivables"("tenantId", "branchId", "status");

-- CreateIndex
CREATE INDEX "receivable_installments_tenantId_dueDate_idx" ON "receivable_installments"("tenantId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "receivable_installments_receivableId_number_key" ON "receivable_installments"("receivableId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "receivable_entries_cashMovementId_key" ON "receivable_entries"("cashMovementId");

-- CreateIndex
CREATE UNIQUE INDEX "receivable_entries_reversedEntryId_key" ON "receivable_entries"("reversedEntryId");

-- CreateIndex
CREATE INDEX "receivable_entries_accountId_createdAt_idx" ON "receivable_entries"("accountId", "createdAt");

-- CreateIndex
CREATE INDEX "receivable_entries_receivableId_createdAt_idx" ON "receivable_entries"("receivableId", "createdAt");

-- CreateIndex
CREATE INDEX "receivable_entries_tenantId_createdAt_idx" ON "receivable_entries"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "receivable_entries_tenantId_idempotencyKey_key" ON "receivable_entries"("tenantId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "receivable_payment_allocations_installmentId_idx" ON "receivable_payment_allocations"("installmentId");

-- CreateIndex
CREATE UNIQUE INDEX "receivable_payment_allocations_entryId_installmentId_key" ON "receivable_payment_allocations"("entryId", "installmentId");

-- AddForeignKey
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_accounts" ADD CONSTRAINT "credit_accounts_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "credit_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivables" ADD CONSTRAINT "receivables_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_installments" ADD CONSTRAINT "receivable_installments_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_entries" ADD CONSTRAINT "receivable_entries_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_entries" ADD CONSTRAINT "receivable_entries_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "credit_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_entries" ADD CONSTRAINT "receivable_entries_receivableId_fkey" FOREIGN KEY ("receivableId") REFERENCES "receivables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_entries" ADD CONSTRAINT "receivable_entries_cashMovementId_fkey" FOREIGN KEY ("cashMovementId") REFERENCES "cash_movements"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_entries" ADD CONSTRAINT "receivable_entries_reversedEntryId_fkey" FOREIGN KEY ("reversedEntryId") REFERENCES "receivable_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_entries" ADD CONSTRAINT "receivable_entries_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_payment_allocations" ADD CONSTRAINT "receivable_payment_allocations_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "receivable_entries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "receivable_payment_allocations" ADD CONSTRAINT "receivable_payment_allocations_installmentId_fkey" FOREIGN KEY ("installmentId") REFERENCES "receivable_installments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------
-- What schema.prisma cannot express
-- (None of the CHECKs below names the enum values added at the top of this file: PostgreSQL
-- does not let a value be used in the transaction that created it.)
-- ---------------------------------------------------------------------------------------

ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_timezone_shape" CHECK ("timezone" ~ '^[A-Za-z_]+(/[A-Za-z0-9_+-]+){0,2}$' AND char_length("timezone") <= 64);

-- A customer's debt and credit limit are never negative.
ALTER TABLE "credit_accounts"
  ADD CONSTRAINT "credit_accounts_limit_nonneg" CHECK ("creditLimitCents" >= 0),
  ADD CONSTRAINT "credit_accounts_balance_nonneg" CHECK ("balanceCents" >= 0);

-- A receivable is worth something, is never paid beyond its total, and its status says the
-- truth about what was paid.
ALTER TABLE "receivables"
  ADD CONSTRAINT "receivables_total_positive" CHECK ("totalCents" >= 1),
  ADD CONSTRAINT "receivables_paid_range" CHECK ("paidCents" >= 0 AND "paidCents" <= "totalCents"),
  ADD CONSTRAINT "receivables_status_matches_paid" CHECK (
    ("status" = 'PAID' AND "paidCents" = "totalCents")
    OR ("status" = 'OPEN' AND "paidCents" < "totalCents")
    OR ("status" = 'CANCELLED' AND "paidCents" = 0)
  ),
  ADD CONSTRAINT "receivables_description_length" CHECK (char_length(btrim("description")) BETWEEN 2 AND 200),
  ADD CONSTRAINT "receivables_cancel_reason" CHECK (
    "status" <> 'CANCELLED' OR char_length(btrim(coalesce("cancelReason", ''))) >= 3
  );

ALTER TABLE "receivable_installments"
  ADD CONSTRAINT "receivable_installments_number_positive" CHECK ("number" >= 1),
  ADD CONSTRAINT "receivable_installments_amount_positive" CHECK ("amountCents" >= 1),
  ADD CONSTRAINT "receivable_installments_paid_range" CHECK ("paidCents" >= 0 AND "paidCents" <= "amountCents");

ALTER TABLE "receivable_entries"
  ADD CONSTRAINT "receivable_entries_amount_nonzero" CHECK ("amountCents" <> 0),
  ADD CONSTRAINT "receivable_entries_balance_nonneg" CHECK ("balanceAfterCents" >= 0),
  -- from the debt's point of view: a charge adds, a payment subtracts
  ADD CONSTRAINT "receivable_entries_sign_by_type" CHECK (
    ("type" = 'CHARGE' AND "amountCents" > 0)
    OR ("type" = 'PAYMENT' AND "amountCents" < 0)
    OR "type" = 'REVERSAL'
  ),
  -- a payment says how it was received (real money only), and only a payment does.
  -- IS NOT NULL is not redundant: NULL IN (...) is NULL, and a CHECK accepts NULL.
  ADD CONSTRAINT "receivable_entries_payment_method" CHECK (
    ("type" = 'PAYMENT' AND "paymentMethod" IS NOT NULL AND "paymentMethod" IN ('CASH', 'PIX', 'CARD'))
    OR ("type" <> 'PAYMENT' AND "paymentMethod" IS NULL)
  ),
  ADD CONSTRAINT "receivable_entries_reference_by_type" CHECK (
    ("type" IN ('CHARGE', 'PAYMENT') AND "reversedEntryId" IS NULL)
    OR ("type" = 'REVERSAL' AND "reversedEntryId" IS NOT NULL)
  ),
  ADD CONSTRAINT "receivable_entries_reason_required" CHECK (
    "type" <> 'REVERSAL' OR char_length(btrim(coalesce("reason", ''))) >= 3
  ),
  ADD CONSTRAINT "receivable_entries_reason_length" CHECK ("reason" IS NULL OR char_length("reason") <= 200);

ALTER TABLE "receivable_payment_allocations"
  ADD CONSTRAINT "receivable_payment_allocations_amount_positive" CHECK ("amountCents" >= 1);

-- The ledger and its allocations are append-only: a mistake is corrected by a REVERSAL entry,
-- never by editing or removing history (same rule as cash_movements).
CREATE OR REPLACE FUNCTION receivable_ledger_immutable() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% not allowed)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER receivable_entries_no_update_delete
  BEFORE UPDATE OR DELETE ON "receivable_entries"
  FOR EACH ROW EXECUTE FUNCTION receivable_ledger_immutable();

CREATE TRIGGER receivable_payment_allocations_no_update_delete
  BEFORE UPDATE OR DELETE ON "receivable_payment_allocations"
  FOR EACH ROW EXECUTE FUNCTION receivable_ledger_immutable();
