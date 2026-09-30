-- AlterEnum
ALTER TYPE "DeliveryStatus" ADD VALUE 'FAILED';

-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "attemptCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "notes" TEXT;


-- Text limits enforced by the database as well as by the API validation.
ALTER TABLE "deliveries"
  ADD CONSTRAINT "deliveries_attempt_count_non_negative" CHECK ("attemptCount" >= 0),
  ADD CONSTRAINT "deliveries_notes_length" CHECK ("notes" IS NULL OR char_length("notes") <= 300),
  ADD CONSTRAINT "deliveries_failure_reason_length" CHECK ("failureReason" IS NULL OR char_length("failureReason") <= 300);

-- Backfill: a delivery that was already dispatched has had one attempt. Rows with no
-- recorded dispatch (e.g. historical COMPLETED orders) stay at 0: nothing is invented.
UPDATE "deliveries" SET "attemptCount" = 1 WHERE "dispatchedAt" IS NOT NULL;
