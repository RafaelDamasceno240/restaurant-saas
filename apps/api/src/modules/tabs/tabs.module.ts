import { Module } from '@nestjs/common';
import { TabsController } from './tabs.controller';
import { TabsService } from './tabs.service';
import { TabRoundsService } from './tab-rounds.service';
import { TabKitchenService } from './tab-kitchen.service';
import { TabKitchenController } from './tab-kitchen.controller';
import { AuditModule } from '../audit/audit.module';
import { BranchesModule } from '../branches/branches.module';
import { TablesModule } from '../tables/tables.module';
import { OrderCreationModule } from '../order-creation/order-creation.module';
import { PaymentsModule } from '../payments/payments.module';
import { CustomersModule } from '../customers/customers.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [AuditModule, BranchesModule, TablesModule, OrderCreationModule, PaymentsModule, CustomersModule, InventoryModule],
  controllers: [TabsController, TabKitchenController],
  providers: [TabsService, TabRoundsService, TabKitchenService],
})
export class TabsModule {}
