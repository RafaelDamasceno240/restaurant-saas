-- Public menu with add-ons (option groups), per-line notes, promotions, "sold out", the look of
-- the menu (logo, cover, brand color), images kept in the database (media_assets) and free
-- delivery from a subtotal on (branches.deliveryFreeAboveCents).
--
-- Additive only: new tables, nullable columns or columns with a default. No existing row changes
-- meaning: every product keeps its price, no product gets add-ons, every order line keeps its
-- price and gets no options. The CHECKs below hold for every existing row (all new columns are
-- NULL/default there).

-- CreateEnum
CREATE TYPE "ProductBadge" AS ENUM ('NEW', 'VEGETARIAN');

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "deliveryFreeAboveCents" INTEGER;

-- AlterTable
ALTER TABLE "categories" ADD COLUMN     "externalId" TEXT;

-- AlterTable
ALTER TABLE "order_items" ADD COLUMN     "notes" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "badges" "ProductBadge"[] DEFAULT ARRAY[]::"ProductBadge"[],
ADD COLUMN     "compareAtPriceCents" INTEGER,
ADD COLUMN     "externalId" TEXT,
ADD COLUMN     "featured" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "imageMediaId" TEXT,
ADD COLUMN     "soldOut" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "tenants" ADD COLUMN     "brandColor" TEXT,
ADD COLUMN     "coverMediaId" TEXT,
ADD COLUMN     "logoMediaId" TEXT;

-- CreateTable
CREATE TABLE "option_groups" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    "maxSelect" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "option_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "option_items" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "maxQuantity" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "soldOut" BOOLEAN NOT NULL DEFAULT false,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "imageMediaId" TEXT,
    "externalId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "option_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_option_groups" (
    "tenantId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_option_groups_pkey" PRIMARY KEY ("productId","groupId")
);

-- CreateTable
CREATE TABLE "media_assets" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "media_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "order_item_options" (
    "id" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "optionItemId" TEXT,
    "groupNameSnapshot" TEXT NOT NULL,
    "optionNameSnapshot" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "order_item_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "option_groups_tenantId_idx" ON "option_groups"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "option_groups_tenantId_externalId_key" ON "option_groups"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX "option_items_groupId_idx" ON "option_items"("groupId");

-- CreateIndex
CREATE UNIQUE INDEX "option_items_tenantId_externalId_key" ON "option_items"("tenantId", "externalId");

-- CreateIndex
CREATE INDEX "product_option_groups_groupId_idx" ON "product_option_groups"("groupId");

-- CreateIndex
CREATE INDEX "product_option_groups_tenantId_idx" ON "product_option_groups"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "media_assets_tenantId_sha256_key" ON "media_assets"("tenantId", "sha256");

-- CreateIndex
CREATE INDEX "order_item_options_orderItemId_idx" ON "order_item_options"("orderItemId");

-- CreateIndex
CREATE INDEX "order_item_options_optionItemId_idx" ON "order_item_options"("optionItemId");

-- CreateIndex
CREATE UNIQUE INDEX "categories_tenantId_externalId_key" ON "categories"("tenantId", "externalId");

-- CreateIndex
CREATE UNIQUE INDEX "products_tenantId_externalId_key" ON "products"("tenantId", "externalId");

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_logoMediaId_fkey" FOREIGN KEY ("logoMediaId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenants" ADD CONSTRAINT "tenants_coverMediaId_fkey" FOREIGN KEY ("coverMediaId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "products" ADD CONSTRAINT "products_imageMediaId_fkey" FOREIGN KEY ("imageMediaId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_groups" ADD CONSTRAINT "option_groups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_items" ADD CONSTRAINT "option_items_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_items" ADD CONSTRAINT "option_items_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "option_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "option_items" ADD CONSTRAINT "option_items_imageMediaId_fkey" FOREIGN KEY ("imageMediaId") REFERENCES "media_assets"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_option_groups" ADD CONSTRAINT "product_option_groups_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "option_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "media_assets" ADD CONSTRAINT "media_assets_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_options" ADD CONSTRAINT "order_item_options_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "order_item_options" ADD CONSTRAINT "order_item_options_optionItemId_fkey" FOREIGN KEY ("optionItemId") REFERENCES "option_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Integrity rules the API also enforces (the database is the last line).
ALTER TABLE "branches"
  ADD CONSTRAINT "branches_delivery_free_above_positive" CHECK ("deliveryFreeAboveCents" IS NULL OR "deliveryFreeAboveCents" > 0);

ALTER TABLE "tenants"
  ADD CONSTRAINT "tenants_brand_color_hex" CHECK ("brandColor" IS NULL OR "brandColor" ~ '^#[0-9A-F]{6}$');

ALTER TABLE "products"
  ADD CONSTRAINT "products_compare_at_above_price" CHECK ("compareAtPriceCents" IS NULL OR "compareAtPriceCents" > "priceCents"),
  ADD CONSTRAINT "products_badges_not_null" CHECK ("badges" IS NOT NULL);

ALTER TABLE "option_groups"
  ADD CONSTRAINT "option_groups_name_not_blank" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "option_groups_select_range" CHECK ("minSelect" >= 0 AND "maxSelect" BETWEEN 1 AND 50 AND "minSelect" <= "maxSelect");

ALTER TABLE "option_items"
  ADD CONSTRAINT "option_items_name_not_blank" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "option_items_price_nonneg" CHECK ("priceCents" >= 0),
  ADD CONSTRAINT "option_items_max_quantity_range" CHECK ("maxQuantity" BETWEEN 1 AND 50);

ALTER TABLE "media_assets"
  ADD CONSTRAINT "media_assets_content_type" CHECK ("contentType" IN ('image/jpeg', 'image/png', 'image/webp')),
  ADD CONSTRAINT "media_assets_size" CHECK ("sizeBytes" > 0 AND "sizeBytes" <= 3145728 AND octet_length("data") = "sizeBytes"),
  ADD CONSTRAINT "media_assets_sha256_hex" CHECK ("sha256" ~ '^[0-9a-f]{64}$');

ALTER TABLE "order_item_options"
  ADD CONSTRAINT "order_item_options_price_nonneg" CHECK ("unitPriceCents" >= 0),
  ADD CONSTRAINT "order_item_options_quantity_positive" CHECK ("quantity" >= 1);
