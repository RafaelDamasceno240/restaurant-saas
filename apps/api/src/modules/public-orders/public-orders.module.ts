import { Module } from '@nestjs/common';
import { PublicOrdersController } from './public-orders.controller';
import { PublicOrdersService } from './public-orders.service';
import { OrderCreationModule } from '../order-creation/order-creation.module';
import { BranchesModule } from '../branches/branches.module';

@Module({
  // AuditModule no longer imported directly here (fatia 07) — the shared
  // OrderCreationService owns the ORDER_CREATED audit write now.
  imports: [OrderCreationModule, BranchesModule],
  controllers: [PublicOrdersController],
  providers: [PublicOrdersService],
})
export class PublicOrdersModule {}
