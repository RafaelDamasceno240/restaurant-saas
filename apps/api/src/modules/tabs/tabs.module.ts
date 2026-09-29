import { Module } from '@nestjs/common';
import { TabsController } from './tabs.controller';
import { TabsService } from './tabs.service';
import { AuditModule } from '../audit/audit.module';
import { BranchesModule } from '../branches/branches.module';
import { TablesModule } from '../tables/tables.module';
import { OrderCreationModule } from '../order-creation/order-creation.module';
import { PaymentsModule } from '../payments/payments.module';

@Module({
  imports: [AuditModule, BranchesModule, TablesModule, OrderCreationModule, PaymentsModule],
  controllers: [TabsController],
  providers: [TabsService],
})
export class TabsModule {}
