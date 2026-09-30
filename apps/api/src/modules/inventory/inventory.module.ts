import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BranchesModule } from '../branches/branches.module';
import {
  InventoryCountsController,
  InventoryItemsController,
  InventoryOverviewController,
  RecipesController,
  StockMovementsController,
} from './inventory.controllers';
import { InventoryService } from './inventory.service';
import { StockLedgerService } from './stock-ledger.service';
import { InventoryItemsService } from './inventory-items.service';
import { StockMovementsService } from './stock-movements.service';
import { RecipesService } from './recipes.service';
import { InventoryCountsService } from './inventory-counts.service';
import { InventoryOverviewService } from './inventory-overview.service';

@Module({
  imports: [AuditModule, BranchesModule],
  controllers: [
    InventoryOverviewController,
    InventoryItemsController,
    StockMovementsController,
    RecipesController,
    InventoryCountsController,
  ],
  providers: [
    StockLedgerService,
    InventoryService,
    InventoryItemsService,
    StockMovementsService,
    RecipesService,
    InventoryCountsService,
    InventoryOverviewService,
  ],
  exports: [InventoryService, StockLedgerService],
})
export class InventoryModule {}
