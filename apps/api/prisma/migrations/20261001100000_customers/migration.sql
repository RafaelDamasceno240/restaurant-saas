-- Fase 11 (CRM), slice 1: customers.
-- Additive only: a new table and ONE nullable column on orders. No existing row is
-- rewritten, no backfill: every existing order keeps customerId = NULL and its
-- customerName/customerPhone snapshot exactly as it was.

-- AlterTable
ALTER TABLE "orders" ADD COLUMN     "customerId" TEXT;

-- CreateTable
CREATE TABLE "customers" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "cpf" TEXT,
    "notes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customers_tenantId_active_name_idx" ON "customers"("tenantId", "active", "name");

-- CreateIndex
CREATE INDEX "orders_tenantId_customerId_createdAt_idx" ON "orders"("tenantId", "customerId", "createdAt");

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Uniqueness is per tenant and partial, so it cannot be expressed in schema.prisma
-- (same approach as suppliers_tenantId_lower_name_active_key):
--   * one ACTIVE customer per phone (an inactive one may share it, reactivation re-checks);
--   * a CPF identifies one person: unique per tenant whenever it is informed.
CREATE UNIQUE INDEX "customers_tenantId_phone_active_key"
  ON "customers" ("tenantId", "phone")
  WHERE "active" = true;

CREATE UNIQUE INDEX "customers_tenantId_cpf_key"
  ON "customers" ("tenantId", "cpf")
  WHERE "cpf" IS NOT NULL;

-- Normalized shapes are guaranteed by the database too, not only by the API.
ALTER TABLE "customers"
  ADD CONSTRAINT "customers_phone_digits" CHECK ("phone" ~ '^[0-9]{8,15}$'),
  ADD CONSTRAINT "customers_cpf_digits" CHECK ("cpf" IS NULL OR "cpf" ~ '^[0-9]{11}$'),
  ADD CONSTRAINT "customers_email_lowercase" CHECK ("email" IS NULL OR "email" = lower("email")),
  ADD CONSTRAINT "customers_name_not_blank" CHECK (char_length(btrim("name")) >= 2),
  ADD CONSTRAINT "customers_notes_length" CHECK ("notes" IS NULL OR char_length("notes") <= 500);
