-- Internal courier assignment (a User with the DELIVERY role). Nullable: every existing
-- delivery stays unassigned; nothing is backfilled or invented.
-- AlterTable
ALTER TABLE "deliveries" ADD COLUMN     "assignedAt" TIMESTAMP(3),
ADD COLUMN     "courierUserId" TEXT;

-- CreateIndex
CREATE INDEX "deliveries_tenantId_courierUserId_idx" ON "deliveries"("tenantId", "courierUserId");

-- AddForeignKey
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_courierUserId_fkey" FOREIGN KEY ("courierUserId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
