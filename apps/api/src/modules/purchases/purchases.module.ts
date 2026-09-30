import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BranchesModule } from '../branches/branches.module';
import { InventoryModule } from '../inventory/inventory.module';
import { PurchasesController, SuppliersController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { SuppliersService } from './suppliers.service';

@Module({
  imports: [AuditModule, BranchesModule, InventoryModule],
  controllers: [PurchasesController, SuppliersController],
  providers: [PurchasesService, SuppliersService],
})
export class PurchasesModule {}
