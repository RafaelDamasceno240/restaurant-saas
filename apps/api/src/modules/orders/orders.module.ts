import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { AuditModule } from '../audit/audit.module';
import { InventoryModule } from '../inventory/inventory.module';
import { BranchesModule } from '../branches/branches.module';
import { CustomersModule } from '../customers/customers.module';
import { OrderEffectsModule } from '../order-effects/order-effects.module';
import { CashModule } from '../cash/cash.module';

@Module({
  imports: [AuditModule, InventoryModule, BranchesModule, CustomersModule, OrderEffectsModule, CashModule],
  controllers: [OrdersController],
  providers: [OrdersService],
  // Exported in fatia 07 so PosModule can reuse findOneForTenant() to build
  // its response after creating a COUNTER order — avoids a third copy of
  // the same DB-row-to-DTO mapping (public-orders has its own, order-scoped
  // to the public/anonymous shape; this one is the authenticated/staff shape).
  exports: [OrdersService],
})
export class OrdersModule {}
