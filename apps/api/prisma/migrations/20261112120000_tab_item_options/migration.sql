-- Add-ons on table tabs (comandas): the options chosen for ONE unit of a tab item, frozen when the
-- round is sent to the kitchen - the same snapshot rule as order_item_options. The tab item's
-- unitPriceCentsSnapshot already includes them:
--   unitPriceCentsSnapshot = product price + sum(option unitPriceCents * quantity).
-- The table checkout copies these rows into order_item_options of the sale it creates.
--
-- Additive only: one new table. No existing row changes: every tab item keeps its price and has
-- no options. Add-ons have no recipe, so nothing here touches the stock.

-- CreateTable
CREATE TABLE "tab_item_options" (
    "id" TEXT NOT NULL,
    "tabItemId" TEXT NOT NULL,
    "optionItemId" TEXT,
    "groupNameSnapshot" TEXT NOT NULL,
    "optionNameSnapshot" TEXT NOT NULL,
    "unitPriceCents" INTEGER NOT NULL,
    "quantity" INTEGER NOT NULL,

    CONSTRAINT "tab_item_options_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tab_item_options_tabItemId_idx" ON "tab_item_options"("tabItemId");

-- CreateIndex
CREATE INDEX "tab_item_options_optionItemId_idx" ON "tab_item_options"("optionItemId");

-- AddForeignKey
ALTER TABLE "tab_item_options" ADD CONSTRAINT "tab_item_options_tabItemId_fkey" FOREIGN KEY ("tabItemId") REFERENCES "tab_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tab_item_options" ADD CONSTRAINT "tab_item_options_optionItemId_fkey" FOREIGN KEY ("optionItemId") REFERENCES "option_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Same guarantees as order_item_options.
ALTER TABLE "tab_item_options"
  ADD CONSTRAINT "tab_item_options_price_nonneg" CHECK ("unitPriceCents" >= 0),
  ADD CONSTRAINT "tab_item_options_quantity_positive" CHECK ("quantity" >= 1);
