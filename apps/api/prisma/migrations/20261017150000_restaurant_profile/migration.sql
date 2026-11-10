-- Public profile of the restaurant: description and Instagram of the brand (tenants), WhatsApp
-- and weekly opening hours of the branch that receives online orders (branches). Phone, e-mail
-- and address of the branch already existed and are now editable.
--
-- Additive only: four nullable columns. No existing row changes.

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "description" TEXT,
ADD COLUMN     "instagram" TEXT;

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "openingHours" JSONB,
ADD COLUMN     "whatsapp" TEXT;
