import { Module } from '@nestjs/common';
import { PosOrdersController } from './pos-orders.controller';
import { PosOrdersService } from './pos-orders.service';
import { OrderCreationModule } from '../order-creation/order-creation.module';
import { OrdersModule } from '../orders/orders.module';
import { BranchesModule } from '../branches/branches.module';

@Module({
  imports: [OrderCreationModule, OrdersModule, BranchesModule],
  controllers: [PosOrdersController],
  providers: [PosOrdersService],
})
export class PosModule {}
